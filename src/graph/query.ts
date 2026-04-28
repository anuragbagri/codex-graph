import fs from "node:fs/promises";
import path from "node:path";

import { projectGraphPath } from "../project/paths.js";
import type { CodexGraph, EdgeType, GraphEdge, GraphNode, QueryOptions, QueryResult } from "./types.js";

const DEPENDENCY_EDGES = new Set<EdgeType>(["IMPORTS", "DEPENDS_ON", "CALLS", "TESTS", "ROUTE"]);

export async function loadGraph(cwd: string): Promise<CodexGraph> {
  const graphPath = projectGraphPath(cwd);
  try {
    return JSON.parse(await fs.readFile(graphPath, "utf8")) as CodexGraph;
  } catch {
    throw new Error(`No graph found at ${graphPath}. Run codex-graph build first.`);
  }
}

export async function queryGraph(question: string, options: QueryOptions): Promise<string | QueryResult[]> {
  const graph = await loadGraph(options.cwd);
  const results = searchGraph(graph, question, options.limit, options.depth);
  return options.json ? results : formatQueryResults(results);
}

export async function explain(target: string, options: QueryOptions): Promise<string | Record<string, unknown>> {
  const graph = await loadGraph(options.cwd);
  const node = findBestNode(graph, target);
  if (!node) {
    throw new Error(`No graph node matched "${target}".`);
  }
  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const payload = {
    node,
    incoming: incoming.map((edge) => edgeSummary(graph, edge, "from")),
    outgoing: outgoing.map((edge) => edgeSummary(graph, edge, "to")),
    suggestedFiles: suggestedFiles([node, ...neighbors(graph, node.id)])
  };
  return options.json ? payload : formatExplain(payload);
}

export async function deps(target: string, options: QueryOptions): Promise<string | Record<string, unknown>> {
  const graph = await loadGraph(options.cwd);
  const node = findBestNode(graph, target);
  if (!node) {
    throw new Error(`No graph node matched "${target}".`);
  }
  const reached = traverse(graph, [node.id], options.depth, "out", DEPENDENCY_EDGES);
  const payload = {
    target: node,
    dependencies: reached.map((id) => graph.nodes.find((item) => item.id === id)).filter(isGraphNode),
    suggestedFiles: suggestedFiles(reached.map((id) => graph.nodes.find((item) => item.id === id)).filter(isGraphNode))
  };
  return options.json ? payload : formatNodeList("Dependencies", payload.dependencies, payload.suggestedFiles);
}

export async function impact(target: string, options: QueryOptions): Promise<string | Record<string, unknown>> {
  const graph = await loadGraph(options.cwd);
  const node = findBestNode(graph, target);
  if (!node) {
    throw new Error(`No graph node matched "${target}".`);
  }
  const reached = traverse(graph, [node.id], options.depth, "in", DEPENDENCY_EDGES);
  const impacted = reached.map((id) => graph.nodes.find((item) => item.id === id)).filter(isGraphNode);
  const payload = {
    target: node,
    impacted,
    suggestedFiles: suggestedFiles(impacted)
  };
  return options.json ? payload : formatNodeList("Impact", impacted, payload.suggestedFiles);
}

export async function shortestPath(
  from: string,
  to: string,
  options: QueryOptions
): Promise<string | Record<string, unknown>> {
  const graph = await loadGraph(options.cwd);
  const fromNode = findBestNode(graph, from);
  const toNode = findBestNode(graph, to);
  if (!fromNode || !toNode) {
    throw new Error(`Could not match ${!fromNode ? from : to}.`);
  }
  const pathIds = bfsPath(graph, fromNode.id, toNode.id);
  const nodes = pathIds.map((id) => graph.nodes.find((node) => node.id === id)).filter(isGraphNode);
  const payload = {
    from: fromNode,
    to: toNode,
    path: nodes,
    suggestedFiles: suggestedFiles(nodes)
  };
  return options.json ? payload : formatPath(nodes, payload.suggestedFiles);
}

export function searchGraph(
  graph: CodexGraph,
  question: string,
  limit: number,
  depth: number
): QueryResult[] {
  const tokens = tokenize(question);
  const scored = graph.nodes
    .map((node) => {
      const haystack = [node.name, node.filePath, node.type, JSON.stringify(node.metadata ?? {})]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const reasons: string[] = [];
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += token.length >= 4 ? 3 : 1;
          reasons.push(`matches "${token}"`);
        }
      }
      if (node.name.toLowerCase() === question.toLowerCase()) {
        score += 10;
        reasons.push("exact name match");
      }
      if (node.filePath?.toLowerCase() === question.toLowerCase()) {
        score += 10;
        reasons.push("exact file match");
      }
      return { node, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
    .slice(0, limit);

  return scored.map((item) => ({
    ...item,
    neighbors: Array.from(new Set(traverse(graph, [item.node.id], Math.max(1, depth), "both")))
      .map((id) => graph.nodes.find((node) => node.id === id))
      .filter(isGraphNode)
      .slice(0, 8)
  }));
}

export function findBestNode(graph: CodexGraph, target: string): GraphNode | undefined {
  const normalized = normalize(target);
  const looksLikePath = normalized.includes("/") || /\.[a-z0-9]+$/.test(normalized);
  return (
    graph.nodes.find((node) => node.id === target) ??
    (looksLikePath
      ? graph.nodes.find((node) => node.type === "file" && normalize(node.filePath ?? "") === normalized)
      : undefined) ??
    graph.nodes.find((node) => normalize(node.filePath ?? "") === normalized) ??
    graph.nodes.find((node) => normalize(node.name) === normalized) ??
    (looksLikePath
      ? graph.nodes.find((node) => node.type === "file" && normalize(node.filePath ?? "").endsWith(normalized))
      : undefined) ??
    graph.nodes.find((node) => normalize(node.filePath ?? "").endsWith(normalized)) ??
    graph.nodes.find((node) => normalize(node.name).includes(normalized))
  );
}

function traverse(
  graph: CodexGraph,
  startIds: string[],
  depth: number,
  direction: "in" | "out" | "both",
  edgeTypes?: Set<EdgeType>
): string[] {
  const seen = new Set(startIds);
  let frontier = startIds;
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.edges) {
        if (edgeTypes && !edgeTypes.has(edge.type)) {
          continue;
        }
        if ((direction === "out" || direction === "both") && edge.from === id && !seen.has(edge.to)) {
          seen.add(edge.to);
          next.push(edge.to);
        }
        if ((direction === "in" || direction === "both") && edge.to === id && !seen.has(edge.from)) {
          seen.add(edge.from);
          next.push(edge.from);
        }
      }
    }
    frontier = next;
  }
  return [...seen].filter((id) => !startIds.includes(id));
}

function bfsPath(graph: CodexGraph, from: string, to: string): string[] {
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const last = current[current.length - 1];
    if (last === to) {
      return current;
    }
    for (const edge of graph.edges) {
      const neighbor = edge.from === last ? edge.to : edge.to === last ? edge.from : undefined;
      if (neighbor && !seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push([...current, neighbor]);
      }
    }
  }
  return [];
}

function neighbors(graph: CodexGraph, id: string): GraphNode[] {
  return graph.edges
    .filter((edge) => edge.from === id || edge.to === id)
    .flatMap((edge) => [edge.from, edge.to])
    .filter((candidate) => candidate !== id)
    .map((candidate) => graph.nodes.find((node) => node.id === candidate))
    .filter(isGraphNode);
}

function edgeSummary(graph: CodexGraph, edge: GraphEdge, endpoint: "from" | "to"): Record<string, unknown> {
  const node = graph.nodes.find((item) => item.id === edge[endpoint]);
  return {
    type: edge.type,
    confidence: edge.confidence,
    node: node ? nodeLabel(node) : edge[endpoint],
    metadata: edge.metadata
  };
}

function formatQueryResults(results: QueryResult[]): string {
  if (results.length === 0) {
    return "No graph matches found.";
  }
  return results
    .map((result, index) => {
      const files = suggestedFiles([result.node, ...result.neighbors]);
      const neighborText = result.neighbors.slice(0, 4).map(nodeLabel).join(", ");
      return [
        `${index + 1}. ${nodeLabel(result.node)} (score ${result.score})`,
        `   reasons: ${result.reasons.join(", ")}`,
        neighborText ? `   nearby: ${neighborText}` : undefined,
        files.length ? `   suggested files: ${files.join(", ")}` : undefined
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function formatExplain(payload: {
  node: GraphNode;
  incoming: Record<string, unknown>[];
  outgoing: Record<string, unknown>[];
  suggestedFiles: string[];
}): string {
  return [
    nodeLabel(payload.node),
    payload.node.metadata ? `metadata: ${JSON.stringify(payload.node.metadata)}` : undefined,
    `incoming: ${payload.incoming.length}`,
    ...payload.incoming.slice(0, 8).map((edge) => `  <- ${edge.type} ${edge.node}`),
    `outgoing: ${payload.outgoing.length}`,
    ...payload.outgoing.slice(0, 8).map((edge) => `  -> ${edge.type} ${edge.node}`),
    payload.suggestedFiles.length ? `suggested files: ${payload.suggestedFiles.join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNodeList(title: string, nodes: GraphNode[], files: string[]): string {
  return [
    `${title}: ${nodes.length}`,
    ...nodes.slice(0, 50).map((node) => `- ${nodeLabel(node)}`),
    files.length ? `suggested files: ${files.join(", ")}` : undefined
  ].join("\n");
}

function formatPath(nodes: GraphNode[], files: string[]): string {
  if (nodes.length === 0) {
    return "No path found.";
  }
  return [
    nodes.map(nodeLabel).join(" -> "),
    files.length ? `suggested files: ${files.join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function suggestedFiles(nodes: GraphNode[]): string[] {
  return [...new Set(nodes.map((node) => node.filePath).filter(isString))].sort();
}

function nodeLabel(node: GraphNode): string {
  return `${node.type}:${node.name}${node.filePath ? ` (${node.filePath})` : ""}`;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_$/.:-]+/)
    .map((token) => token.trim())
    .filter(
      (token) => token.length >= 2 && !["the", "and", "for", "where", "what", "with", "is"].includes(token)
    );
}

function normalize(value: string): string {
  return value.toLowerCase().replaceAll(path.sep, "/");
}

function isGraphNode(value: GraphNode | undefined): value is GraphNode {
  return Boolean(value);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
