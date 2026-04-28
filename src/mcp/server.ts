import fs from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ensureDir } from "../project/files.js";
import { codexHome } from "../project/paths.js";
import { deps, explain, impact, loadGraph, queryGraph, shortestPath } from "../graph/query.js";

const TextResult = z.object({
  cwd: z.string().optional()
});

function text(content: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof content === "string" ? content : JSON.stringify(content, null, 2)
      }
    ]
  };
}

export async function serveMcp(cwd: string): Promise<void> {
  const server = new McpServer({ name: "codex-graph", version: "0.1.0" });

  server.registerTool(
    "query_graph",
    {
      description: "Search the local codex-graph graph.",
      inputSchema: {
        question: z.string(),
        cwd: z.string().optional(),
        limit: z.number().int().positive().optional(),
        depth: z.number().int().nonnegative().optional()
      }
    },
    async ({ question, cwd: toolCwd, limit, depth }) =>
      text(
        await queryGraph(question, {
          cwd: path.resolve(toolCwd ?? cwd),
          limit: limit ?? 8,
          depth: depth ?? 1
        })
      )
  );

  server.registerTool(
    "get_node",
    {
      description: "Return a graph node by id, name, or file.",
      inputSchema: { target: z.string(), cwd: z.string().optional() }
    },
    async ({ target, cwd: toolCwd }) => text(await explain(target, mcpOptions(toolCwd ?? cwd)))
  );

  server.registerTool(
    "get_neighbors",
    {
      description: "Return dependencies and impact neighbors for a graph target.",
      inputSchema: { target: z.string(), cwd: z.string().optional(), depth: z.number().int().positive().optional() }
    },
    async ({ target, cwd: toolCwd, depth }) => {
      const options = mcpOptions(toolCwd ?? cwd, depth);
      return text({
        dependencies: await deps(target, { ...options, json: true }),
        impact: await impact(target, { ...options, json: true })
      });
    }
  );

  server.registerTool(
    "explain_symbol",
    {
      description: "Explain a symbol or file from the local graph.",
      inputSchema: { target: z.string(), cwd: z.string().optional() }
    },
    async ({ target, cwd: toolCwd }) => text(await explain(target, mcpOptions(toolCwd ?? cwd)))
  );

  server.registerTool(
    "dependency_trace",
    {
      description: "Trace outgoing dependencies for a symbol or file.",
      inputSchema: { target: z.string(), cwd: z.string().optional(), depth: z.number().int().positive().optional() }
    },
    async ({ target, cwd: toolCwd, depth }) => text(await deps(target, mcpOptions(toolCwd ?? cwd, depth)))
  );

  server.registerTool(
    "impact_analysis",
    {
      description: "Trace incoming dependents for a symbol or file.",
      inputSchema: { target: z.string(), cwd: z.string().optional(), depth: z.number().int().positive().optional() }
    },
    async ({ target, cwd: toolCwd, depth }) => text(await impact(target, mcpOptions(toolCwd ?? cwd, depth)))
  );

  server.registerTool(
    "shortest_path",
    {
      description: "Find a shortest graph path between two targets.",
      inputSchema: { from: z.string(), to: z.string(), cwd: z.string().optional() }
    },
    async ({ from, to, cwd: toolCwd }) => text(await shortestPath(from, to, mcpOptions(toolCwd ?? cwd)))
  );

  server.registerTool(
    "get_graph_stats",
    {
      description: "Return graph stats for the current project.",
      inputSchema: TextResult.shape
    },
    async ({ cwd: toolCwd }) => text((await loadGraph(path.resolve(toolCwd ?? cwd))).stats)
  );

  await server.connect(new StdioServerTransport());
}

export async function installMcp(cwd: string): Promise<string> {
  const home = codexHome();
  await ensureDir(home);
  const target = path.join(home, "config.toml");
  const existing = (await exists(target)) ? await fs.readFile(target, "utf8") : "";
  if (await exists(target)) {
    const backup = `${target}.bak.${Date.now()}`;
    await fs.copyFile(target, backup);
  }
  const block = [
    "[mcp_servers.codex-graph]",
    'command = "codex-graph"',
    `args = ["serve", "--cwd", ${tomlString(cwd)}]`,
    "startup_timeout_ms = 20_000",
    "default_tools_approval_mode = \"approve\""
  ].join("\n");
  await fs.writeFile(target, upsertTomlBlock(existing, "codex-graph:mcp", block));

  const sidecarDir = path.join(home, "mcp");
  await ensureDir(sidecarDir);
  await fs.writeFile(
    path.join(sidecarDir, "codex-graph.json"),
    `${JSON.stringify({ name: "codex-graph", command: "codex-graph", args: ["serve", "--cwd", cwd], cwd }, null, 2)}\n`
  );
  return target;
}

function mcpOptions(cwd: string, depth = 1) {
  return {
    cwd: path.resolve(cwd),
    limit: 8,
    depth
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function upsertTomlBlock(existing: string, name: string, body: string): string {
  const start = `# ${name}:start`;
  const end = `# ${name}:end`;
  const block = `${start}\n${body}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(existing)) {
    return `${existing.replace(pattern, block).trimEnd()}\n`;
  }
  return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
