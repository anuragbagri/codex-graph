import fs from "node:fs/promises";
import path from "node:path";

import { projectGraphDir } from "../project/paths.js";
import type { CodexGraph } from "./types.js";

export async function writeVisualization(graph: CodexGraph, cwd: string): Promise<string> {
  const outPath = path.join(projectGraphDir(cwd), "graph.html");
  await fs.writeFile(outPath, renderHtml(graph));
  return outPath;
}

function renderHtml(graph: CodexGraph): string {
  const data = JSON.stringify({
    nodes: graph.nodes.map((node) => ({ data: node })),
    edges: graph.edges.map((edge) => ({ data: edge }))
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codex-graph</title>
    <script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
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
