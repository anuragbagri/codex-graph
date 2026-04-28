import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import ignore from "ignore";
import {
  ClassDeclaration,
  ExportDeclaration,
  Node,
  ObjectLiteralExpression,
  Project,
  SourceFile,
  SyntaxKind,
  ts
} from "ts-morph";

import { ensureDir, writeJson } from "../project/files.js";
import { projectGraphDir } from "../project/paths.js";
import { hashFiles, readGraphCache, summarizeCacheChange, writeGraphCache } from "./cache.js";
import type {
  BuildOptions,
  CodexGraph,
  GraphCacheSummary,
  GraphNode,
  GraphStats,
  GraphWarning,
  NodeType
} from "./types.js";
import { GraphBuilder, nodeId, relativePath, toPosixPath } from "./utils.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const GRAPH_SCHEMA_VERSION = 1;

export async function buildGraph(options: BuildOptions): Promise<CodexGraph> {
  const root = path.resolve(options.root);
  const files = await listSourceFiles(root);
  const fileHashes = await hashFiles(root, files);
  const cacheSummary: GraphCacheSummary = {
    mode: "full",
    changedFiles: files.length,
    deletedFiles: 0,
    unchangedFiles: 0,
    reason: "build command"
  };
  const graph = await buildGraphFromFiles(root, files, cacheSummary);
  if (options.write ?? true) {
    await writeGraphArtifacts(root, graph);
    await writeGraphCache(root, fileHashes);
  }
  return graph;
}

export async function updateGraph(root: string): Promise<CodexGraph> {
  const resolvedRoot = path.resolve(root);
  const files = await listSourceFiles(resolvedRoot);
  const fileHashes = await hashFiles(resolvedRoot, files);
  const cacheSummary = summarizeCacheChange(await readGraphCache(resolvedRoot), fileHashes);

  if (cacheSummary.mode === "skipped") {
    const existing = await readExistingGraph(resolvedRoot).catch(async () => {
      const graph = await buildGraphFromFiles(resolvedRoot, files, {
        mode: "full",
        changedFiles: files.length,
        deletedFiles: 0,
        unchangedFiles: 0,
        reason: "missing graph"
      });
      await writeGraphArtifacts(resolvedRoot, graph);
      await writeGraphCache(resolvedRoot, fileHashes);
      return graph;
    });
    existing.generatedAt = new Date().toISOString();
    if (existing.stats.cache?.reason !== "missing graph") {
      existing.stats.cache = cacheSummary;
    }
    await writeGraphArtifacts(resolvedRoot, existing);
    await writeGraphCache(resolvedRoot, fileHashes);
    return existing;
  }

  const graph = await buildGraphFromFiles(resolvedRoot, files, cacheSummary);
  await writeGraphArtifacts(resolvedRoot, graph);
  await writeGraphCache(resolvedRoot, fileHashes);
  return graph;
}

async function buildGraphFromFiles(
  root: string,
  files: string[],
  cacheSummary: GraphCacheSummary
): Promise<CodexGraph> {
  const warnings: GraphWarning[] = [];
  const builder = new GraphBuilder();
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });
  const sourceFiles = project.addSourceFilesAtPaths(files.map((file) => path.join(root, file)));
  const sourceByPath = new Map(sourceFiles.map((source) => [relativePath(root, source.getFilePath()), source]));
  const fileNodeByPath = new Map<string, GraphNode>();
  const symbolNodesByName = new Map<string, GraphNode[]>();

  await addPackageAndConfigs(root, builder, warnings);

  for (const relPath of files) {
    const fileNode = builder.addNode({
      id: fileNodeId(relPath),
      type: isTestFile(relPath) ? "file" : "file",
      name: relPath,
      filePath: relPath,
      metadata: { isTest: isTestFile(relPath), extension: path.extname(relPath) }
    });
    fileNodeByPath.set(relPath, fileNode);
  }

  for (const [relPath, source] of sourceByPath.entries()) {
    const fileNode = fileNodeByPath.get(relPath);
    if (!fileNode) {
      continue;
    }

    try {
      addSymbols(relPath, source, builder, fileNode, symbolNodesByName);
      addRoutes(relPath, source, builder, fileNode);
    } catch (error) {
      warnings.push({
        filePath: relPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const [relPath, source] of sourceByPath.entries()) {
    try {
      addImports(root, relPath, source, builder, fileNodeByPath, symbolNodesByName, warnings);
    } catch (error) {
      warnings.push({
        filePath: relPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  addSymbolCallEdges(sourceByPath, builder, fileNodeByPath, symbolNodesByName);
  addTestEdges(builder, fileNodeByPath);

  const nodes = builder.getNodes();
  const edges = builder.getEdges();
  const stats = makeStats(nodes, edges, warnings, cacheSummary);
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root,
    nodes,
    edges,
    warnings,
    stats
  };
}

async function listSourceFiles(root: string): Promise<string[]> {
  const ig = ignore();
  for (const fileName of [".gitignore", ".codexgraphignore"]) {
    try {
      ig.add(await fs.readFile(path.join(root, fileName), "utf8"));
    } catch {
      // Optional ignore files.
    }
  }

  const entries = await fg(["**/*.{ts,tsx,js,jsx,mjs,cjs}"], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ["node_modules/**", "dist/**", "coverage/**", ".git/**", ".codex-graph/**"]
  });

  return entries.map(toPosixPath).filter((entry) => !ig.ignores(entry)).sort();
}

async function addPackageAndConfigs(
  root: string,
  builder: GraphBuilder,
  warnings: GraphWarning[]
): Promise<void> {
  const packagePath = path.join(root, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    const pkg = JSON.parse(raw) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const pkgNode = builder.addNode({
      id: nodeId("package", [pkg.name ?? "package.json"]),
      type: "package",
      name: pkg.name ?? "package.json",
      filePath: "package.json",
      metadata: {
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {})
      }
    });
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      const script = builder.addNode({
        id: nodeId("script", ["package.json", name]),
        type: "script",
        name,
        filePath: "package.json",
        metadata: { command }
      });
      builder.addEdge("CONTAINS", pkgNode.id, script.id);
    }
  } catch (error) {
    warnings.push({
      filePath: "package.json",
      message: error instanceof Error ? error.message : "package.json could not be parsed"
    });
  }

  for (const name of ["tsconfig.json", "vite.config.ts", "next.config.js", "eslint.config.js"]) {
    try {
      await fs.access(path.join(root, name));
      builder.addNode({
        id: nodeId("config", [name]),
        type: "config",
        name,
        filePath: name
      });
    } catch {
      // Not every project has every config.
    }
  }
}

function addImports(
  root: string,
  relPath: string,
  source: SourceFile,
  builder: GraphBuilder,
  fileNodeByPath: Map<string, GraphNode>,
  symbolNodesByName: Map<string, GraphNode[]>,
  warnings: GraphWarning[]
): void {
  const fileNode = fileNodeByPath.get(relPath);
  if (!fileNode) {
    return;
  }

  for (const importDecl of source.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const resolved = resolveImport(root, relPath, specifier, fileNodeByPath);
    if (resolved) {
      builder.addEdge("IMPORTS", fileNode.id, resolved.id, "EXTRACTED", { specifier });
      builder.addEdge("DEPENDS_ON", fileNode.id, resolved.id, "EXTRACTED", { via: "import" });
    } else if (specifier.startsWith(".")) {
      warnings.push({ filePath: relPath, message: `Could not resolve import ${specifier}` });
    }

    for (const named of importDecl.getNamedImports()) {
      const name = named.getName();
      const importedNodes = symbolNodesByName.get(name) ?? [];
      for (const imported of importedNodes) {
        builder.addEdge("DEPENDS_ON", fileNode.id, imported.id, "INFERRED", { imported: name });
      }
    }
  }

  for (const exportDecl of source.getExportDeclarations()) {
    addExportDependency(root, relPath, exportDecl, builder, fileNodeByPath);
  }
}

function addExportDependency(
  root: string,
  relPath: string,
  exportDecl: ExportDeclaration,
  builder: GraphBuilder,
  fileNodeByPath: Map<string, GraphNode>
): void {
  const specifier = exportDecl.getModuleSpecifierValue();
  if (!specifier) {
    return;
  }
  const from = fileNodeByPath.get(relPath);
  const to = resolveImport(root, relPath, specifier, fileNodeByPath);
  if (from && to) {
    builder.addEdge("EXPORTS", from.id, to.id, "EXTRACTED", { specifier });
  }
}

function addSymbols(
  relPath: string,
  source: SourceFile,
  builder: GraphBuilder,
  fileNode: GraphNode,
  symbolNodesByName: Map<string, GraphNode[]>
): void {
  const addSymbol = (type: NodeType, name: string, metadata?: Record<string, unknown>): GraphNode => {
    const symbol = builder.addNode({
      id: nodeId(type, [relPath, name]),
      type,
      name,
      filePath: relPath,
      ...(metadata ? { metadata } : {})
    });
    builder.addEdge("CONTAINS", fileNode.id, symbol.id);
    if (isExportedName(source, name)) {
      builder.addEdge("EXPORTS", fileNode.id, symbol.id);
    }
    const existing = symbolNodesByName.get(name) ?? [];
    existing.push(symbol);
    symbolNodesByName.set(name, existing);
    return symbol;
  };

  for (const fn of source.getFunctions()) {
    const name = fn.getName();
    if (name) {
      addSymbol("function", name, { async: fn.isAsync() });
    }
  }

  for (const cls of source.getClasses()) {
    const name = cls.getName();
    if (!name) {
      continue;
    }
    const classNode = addSymbol("class", name, {
      extends: cls.getExtends()?.getText(),
      implements: cls.getImplements().map((item) => item.getText())
    });
    addClassMembers(relPath, cls, builder, classNode, symbolNodesByName);
  }

  for (const iface of source.getInterfaces()) {
    addSymbol("interface", iface.getName());
  }

  for (const alias of source.getTypeAliases()) {
    addSymbol("type", alias.getName());
  }

  for (const enm of source.getEnums()) {
    addSymbol("enum", enm.getName());
  }

  for (const variable of source.getVariableDeclarations()) {
    const name = variable.getName();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) {
      addSymbol("variable", name);
    }
  }
}

function addClassMembers(
  relPath: string,
  cls: ClassDeclaration,
  builder: GraphBuilder,
  classNode: GraphNode,
  symbolNodesByName: Map<string, GraphNode[]>
): void {
  for (const method of cls.getMethods()) {
    const name = `${classNode.name}.${method.getName()}`;
    const node = builder.addNode({
      id: nodeId("method", [relPath, name]),
      type: "method",
      name,
      filePath: relPath,
      metadata: { static: method.isStatic(), async: method.isAsync() }
    });
    builder.addEdge("CONTAINS", classNode.id, node.id);
    const existing = symbolNodesByName.get(method.getName()) ?? [];
    existing.push(node);
    symbolNodesByName.set(method.getName(), existing);
    const qualified = symbolNodesByName.get(name) ?? [];
    qualified.push(node);
    symbolNodesByName.set(name, qualified);
  }
}

function addRoutes(
  relPath: string,
  source: SourceFile,
  builder: GraphBuilder,
  fileNode: GraphNode
): void {
  const objects = source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
  for (const obj of objects) {
    const routePath = getStringProperty(obj, "path");
    if (!routePath || !routePath.startsWith("/")) {
      continue;
    }
    const method = getStringProperty(obj, "method") ?? "UNKNOWN";
    const route = builder.addNode({
      id: nodeId("route", [relPath, method, routePath]),
      type: "route",
      name: `${method} ${routePath}`,
      filePath: relPath,
      metadata: { method, path: routePath }
    });
    builder.addEdge("ROUTE", fileNode.id, route.id);
    builder.addEdge("CONTAINS", fileNode.id, route.id);
  }
}

function addSymbolCallEdges(
  sourceByPath: Map<string, SourceFile>,
  builder: GraphBuilder,
  fileNodeByPath: Map<string, GraphNode>,
  symbolNodesByName: Map<string, GraphNode[]>
): void {
  for (const [relPath, source] of sourceByPath.entries()) {
    const fileNode = fileNodeByPath.get(relPath);
    if (!fileNode) {
      continue;
    }
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const names = callExpressionNames(expression);
      for (const name of names) {
        const targets = symbolNodesByName.get(name) ?? [];
        for (const target of targets) {
          if (target.filePath !== relPath || target.type === "method") {
            builder.addEdge("CALLS", fileNode.id, target.id, "INFERRED", { expression: expression.getText() });
            builder.addEdge("DEPENDS_ON", fileNode.id, target.id, "INFERRED", { via: "call" });
          }
        }
      }
    }
  }
}

function addTestEdges(builder: GraphBuilder, fileNodeByPath: Map<string, GraphNode>): void {
  for (const [relPath, fileNode] of fileNodeByPath.entries()) {
    if (!isTestFile(relPath)) {
      continue;
    }
    const normalized = relPath
      .replace(/^tests?\//, "src/")
      .replace(/(^|\/)__tests__\//, "$1")
      .replace(/\.(test|spec)\.[^.]+$/, "");
    for (const [candidatePath, candidateNode] of fileNodeByPath.entries()) {
      const candidateBase = candidatePath.replace(/\.[^.]+$/, "");
      if (normalized.includes(path.posix.basename(candidateBase)) || candidateBase.includes(path.posix.basename(normalized))) {
        builder.addEdge("TESTS", fileNode.id, candidateNode.id, "INFERRED");
      }
    }
  }
}

function resolveImport(
  root: string,
  importerPath: string,
  specifier: string,
  fileNodeByPath: Map<string, GraphNode>
): GraphNode | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const importerDir = path.posix.dirname(importerPath);
  const base = toPosixPath(path.normalize(path.posix.join(importerDir, specifier)));
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => withSourceExtension(base, ext)),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`)
  ];

  for (const candidate of candidates) {
    const withoutJs = candidate.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx");
    const node = fileNodeByPath.get(candidate) ?? fileNodeByPath.get(withoutJs);
    if (node) {
      return node;
    }
    const absolute = path.join(root, candidate);
    if (fileNodeByPath.has(relativePath(root, absolute))) {
      return fileNodeByPath.get(relativePath(root, absolute));
    }
  }
  return undefined;
}

function withSourceExtension(value: string, extension: string): string {
  return SOURCE_EXTENSIONS.some((ext) => value.endsWith(ext)) ? value : `${value}${extension}`;
}

function getStringProperty(obj: ObjectLiteralExpression, name: string): string | undefined {
  const property = obj.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = property.getInitializer();
  return initializer && Node.isStringLiteral(initializer) ? initializer.getLiteralText() : undefined;
}

function callExpressionNames(expression: Node): string[] {
  if (Node.isIdentifier(expression)) {
    return [expression.getText()];
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return [expression.getName(), expression.getText()];
  }
  return [];
}

function isExportedName(source: SourceFile, name: string): boolean {
  const exported = source.getExportedDeclarations();
  return exported.has(name);
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(filePath) || /\.(test|spec)\.[tj]sx?$/.test(filePath);
}

function fileNodeId(filePath: string): string {
  return nodeId("file", [filePath]);
}

async function writeGraphArtifacts(root: string, graph: CodexGraph): Promise<void> {
  const dir = projectGraphDir(root);
  await ensureDir(dir);
  await writeJson(path.join(dir, "graph.json"), graph);
  await writeJson(path.join(dir, "stats.json"), graph.stats);
  await writeJson(path.join(dir, "warnings.json"), graph.warnings);
  await fs.writeFile(path.join(dir, "CODEX_GRAPH_REPORT.md"), renderReport(graph));
}

async function readExistingGraph(root: string): Promise<CodexGraph> {
  const graphPath = path.join(projectGraphDir(root), "graph.json");
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8")) as CodexGraph;
  if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new Error("schema mismatch");
  }
  return graph;
}

function makeStats(
  nodes: GraphNode[],
  edges: ReturnType<GraphBuilder["getEdges"]>,
  warnings: GraphWarning[],
  cacheSummary: GraphCacheSummary
): GraphStats {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }
  const hotspots = nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      ...(node.filePath ? { filePath: node.filePath } : {}),
      score: (incoming.get(node.id) ?? 0) + (outgoing.get(node.id) ?? 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    files: nodes.filter((node) => node.type === "file").length,
    symbols: nodes.filter((node) => !["file", "package", "config", "script"].includes(node.type)).length,
    edges: edges.length,
    warnings: warnings.length,
    tests: nodes.filter((node) => node.metadata?.isTest === true).length,
    routes: nodes.filter((node) => node.type === "route").length,
    cache: cacheSummary,
    hotspots
  };
}

function renderReport(graph: CodexGraph): string {
  const hotspotRows = graph.stats.hotspots
    .map((item) => `- ${item.name}${item.filePath ? ` (${item.filePath})` : ""}: ${item.score}`)
    .join("\n");
  return `# CODEX_GRAPH_REPORT

Generated: ${graph.generatedAt}
Root: ${graph.root}

## Stats

- Files: ${graph.stats.files}
- Symbols: ${graph.stats.symbols}
- Edges: ${graph.stats.edges}
- Routes: ${graph.stats.routes}
- Tests: ${graph.stats.tests}
- Warnings: ${graph.stats.warnings}

## Hotspots

${hotspotRows || "- No hotspots yet."}
`;
}
