import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import open from "open";

import {
  findPackageRoot,
  pathExists,
  projectGraphDir,
  projectGraphPath
} from "../project/paths.js";
import { loadGraph } from "./query.js";
import type { CodexGraph } from "./types.js";

const DEFAULT_PORT = 3842;
const CYTOSCAPE_CDN = "https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js";
const WATCH_DEBOUNCE_MS = 100;

export interface VisualizationLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface WriteVisualizationOptions {
  inline?: boolean;
  logger?: VisualizationLogger;
}

export interface ServeVisualizationOptions {
  port?: number;
  logger?: VisualizationLogger;
  openBrowser?: (url: string) => Promise<unknown>;
}

export interface VisualizationServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function writeVisualization(
  graph: CodexGraph,
  cwd: string,
  options: WriteVisualizationOptions = {}
): Promise<string> {
  const outPath = path.join(projectGraphDir(cwd), "graph.html");
  await fs.writeFile(outPath, await renderHtml(graph, options));
  return outPath;
}

export async function serveVisualization(
  graph: CodexGraph,
  cwd: string,
  options: ServeVisualizationOptions = {}
): Promise<VisualizationServer> {
  const logger = options.logger ?? console;
  const graphPath = projectGraphPath(cwd);
  const htmlPath = await writeVisualization(graph, cwd, { inline: true, logger });
  logger.log(`Wrote ${htmlPath}`);

  const server = createVisualizationHttpServer(htmlPath);
  const port = await listenOnAvailablePort(server, options.port ?? DEFAULT_PORT, logger);
  const url = `http://localhost:${port}`;
  logger.log(`Serving graph at ${url}`);

  try {
    logger.log("Opening browser...");
    await (options.openBrowser ?? open)(url);
  } catch {
    logger.warn(`Could not open browser. Visit ${url} manually.`);
  }

  let pendingUpdate: NodeJS.Timeout | undefined;
  const regenerate = async () => {
    try {
      if (!(await pathExists(graphPath))) {
        logger.warn("graph.json removed. Rebuild to update.");
        return;
      }
      await writeVisualization(await loadGraph(cwd), cwd, { inline: true, logger });
      logger.log("Graph updated. Refresh your browser to see changes.");
    } catch (error) {
      logger.warn(`Could not update graph visualization: ${errorMessage(error)}`);
    }
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(graphPath, { persistent: true }, () => {
      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
      }
      pendingUpdate = setTimeout(() => {
        pendingUpdate = undefined;
        void regenerate();
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on("error", (error) => {
      logger.warn(`Could not watch graph.json: ${errorMessage(error)}`);
    });
  } catch (error) {
    logger.warn(`Could not watch graph.json: ${errorMessage(error)}`);
  }

  logger.log("Watching graph.json for changes. Press Ctrl+C to stop.");

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate);
      pendingUpdate = undefined;
    }
    watcher?.close();
    process.off("SIGINT", shutdown);
    await closeServer(server);
  };
  const shutdown = () => {
    void close().finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);

  return { url, port, close };
}

async function renderHtml(graph: CodexGraph, options: WriteVisualizationOptions): Promise<string> {
  const data = JSON.stringify({
    nodes: graph.nodes.map((node) => ({ data: node })),
    edges: graph.edges.map((edge) => ({ data: edge }))
  });
  const cytoscapeScript = await renderCytoscapeScript(options);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codex-graph</title>
    ${cytoscapeScript}
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172026; background: #f7f8f8; }
      header { height: 52px; display: flex; gap: 12px; align-items: center; padding: 0 16px; border-bottom: 1px solid #d7dddf; background: #ffffff; }
      input, select { height: 32px; border: 1px solid #b8c2c7; border-radius: 6px; padding: 0 10px; background: #ffffff; }
      main { display: grid; grid-template-columns: 1fr 320px; height: calc(100vh - 53px); }
      #cy { min-width: 0; min-height: 0; }
      aside { border-left: 1px solid #d7dddf; background: #ffffff; padding: 16px; overflow: auto; }
      h1 { font-size: 16px; margin: 0; }
      h2 { font-size: 14px; margin: 0 0 8px; }
      pre { white-space: pre-wrap; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <h1>codex-graph</h1>
      <input id="search" placeholder="Search nodes" />
      <select id="type"><option value="">All node types</option></select>
      <select id="edge"><option value="">All edge types</option></select>
    </header>
    <main>
      <div id="cy"></div>
      <aside><h2>Selection</h2><pre id="details">Select a node or edge.</pre></aside>
    </main>
    <script>
      const data = ${data};
      const cy = cytoscape({
        container: document.getElementById("cy"),
        elements: data,
        style: [
          { selector: "node", style: { label: "data(name)", "font-size": 9, "text-wrap": "wrap", "text-max-width": 110, "background-color": "#2f7d7e", color: "#172026" } },
          { selector: "node[type = 'file']", style: { "background-color": "#4869a8" } },
          { selector: "node[type = 'class'], node[type = 'function'], node[type = 'method']", style: { "background-color": "#c56f45" } },
          { selector: "edge", style: { label: "data(type)", "font-size": 7, width: 1, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#9aa6ac", "target-arrow-color": "#9aa6ac" } },
          { selector: ":selected", style: { "background-color": "#111827", "line-color": "#111827", "target-arrow-color": "#111827" } }
        ],
        layout: { name: "cose", animate: false, fit: true, padding: 40 }
      });
      const typeSelect = document.getElementById("type");
      const edgeSelect = document.getElementById("edge");
      [...new Set(data.nodes.map(n => n.data.type))].sort().forEach(type => typeSelect.append(new Option(type, type)));
      [...new Set(data.edges.map(e => e.data.type))].sort().forEach(type => edgeSelect.append(new Option(type, type)));
      function applyFilters() {
        const q = document.getElementById("search").value.toLowerCase();
        const type = typeSelect.value;
        const edge = edgeSelect.value;
        cy.nodes().forEach(n => {
          const matchesText = !q || [n.data("name"), n.data("filePath"), n.data("type")].join(" ").toLowerCase().includes(q);
          const matchesType = !type || n.data("type") === type;
          n.style("display", matchesText && matchesType ? "element" : "none");
        });
        cy.edges().forEach(e => e.style("display", !edge || e.data("type") === edge ? "element" : "none"));
      }
      document.getElementById("search").addEventListener("input", applyFilters);
      typeSelect.addEventListener("change", applyFilters);
      edgeSelect.addEventListener("change", applyFilters);
      cy.on("select", "node, edge", evt => {
        document.getElementById("details").textContent = JSON.stringify(evt.target.data(), null, 2);
      });
    </script>
  </body>
</html>
`;
}

async function renderCytoscapeScript(options: WriteVisualizationOptions): Promise<string> {
  if (!options.inline) {
    return `<script src="${CYTOSCAPE_CDN}"></script>`;
  }

  const source = await readVendoredCytoscape();
  if (!source) {
    (options.logger ?? console).warn(
      `Could not find vendored Cytoscape.js. Falling back to ${CYTOSCAPE_CDN}.`
    );
    return `<script src="${CYTOSCAPE_CDN}"></script>`;
  }

  return `<script>${source.replaceAll("</script", "<\\/script")}</script>`;
}

async function readVendoredCytoscape(): Promise<string | undefined> {
  const packageRoot = await findPackageRoot();
  const vendorPath = path.join(packageRoot, "dist", "vendor", "cytoscape.min.js");
  try {
    return await fs.readFile(vendorPath, "utf8");
  } catch {
    return undefined;
  }
}

function createVisualizationHttpServer(htmlPath: string): Server {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (request.method !== "GET" || requestUrl.pathname !== "/") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    try {
      const html = await fs.readFile(htmlPath, "utf8");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Could not read graph.html: ${errorMessage(error)}`);
    }
  });
}

async function listenOnAvailablePort(
  server: Server,
  preferredPort: number,
  logger: VisualizationLogger
): Promise<number> {
  let port = preferredPort;
  while (true) {
    try {
      await listen(server, port);
      const address = server.address() as AddressInfo | null;
      return address?.port ?? port;
    } catch (error) {
      if (!isPortInUse(error)) {
        throw error;
      }
      logger.log(`Port ${port} in use, trying ${port + 1}...`);
      port += 1;
    }
  }
}

async function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "localhost");
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function isPortInUse(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
