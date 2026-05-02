import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { installPlatform, uninstallPlatform } from "../src/commands/install.js";
import { initProject } from "../src/commands/project.js";
import { buildGraph, updateGraph } from "../src/graph/build.js";
import { deps, explain, impact, queryGraph, shortestPath } from "../src/graph/query.js";
import { serveVisualization, writeVisualization } from "../src/graph/visualize.js";
import { installMcp } from "../src/mcp/server.js";

describe("codex-graph", () => {
  it("has a smoke test", () => {
    expect("codex-graph").toBe("codex-graph");
  });

  it("installs and uninstalls the Codex skill", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-graph-test-"));
    const oldHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmp, "codex-home");
    try {
      const target = await installPlatform("codex");
      await expect(fs.readFile(path.join(target, "SKILL.md"), "utf8")).resolves.toContain(
        "codex-graph"
      );
      await expect(fs.readFile(path.join(target, "agents", "openai.yaml"), "utf8")).resolves.toContain(
        "query"
      );
      await uninstallPlatform("codex");
      await expect(fs.access(target)).rejects.toThrow();
    } finally {
      if (oldHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = oldHome;
      }
    }
  });

  it("initializes a project and answers graph queries", async () => {
    const app = await copyFixture();
    await initProject(app);

    const graph = await buildGraph({ root: app, write: true });
    expect(graph.stats.files).toBeGreaterThanOrEqual(4);
    expect(graph.nodes.some((node) => node.name === "UserService")).toBe(true);
    expect(graph.nodes.some((node) => node.name === "GET /users/:id")).toBe(true);

    const query = await queryGraph("where is the user service?", {
      cwd: app,
      limit: 5,
      depth: 1
    });
    expect(query).toContain("UserService");
    expect(query).toContain("src/services/user-service.ts");

    await expect(explain("UserService", { cwd: app, limit: 5, depth: 1 })).resolves.toContain(
      "UserService"
    );
    await expect(deps("src/main.ts", { cwd: app, limit: 5, depth: 1 })).resolves.toContain(
      "src/routes/users.ts"
    );
    await expect(impact("UserService", { cwd: app, limit: 5, depth: 2 })).resolves.toContain(
      "src/main.ts"
    );
    await expect(shortestPath("src/main.ts", "UserService", { cwd: app, limit: 5, depth: 1 }))
      .resolves.toContain("UserService");

    const html = await writeVisualization(graph, app);
    await expect(fs.readFile(html, "utf8")).resolves.toContain("cytoscape");
  });

  it("serves the visualization over local HTTP without launching a browser", async () => {
    const app = await copyFixture();
    const graph = await buildGraph({ root: app, write: true });
    const logs: string[] = [];
    const warnings: string[] = [];
    let openedUrl: string | undefined;

    const server = await serveVisualization(graph, app, {
      port: 0,
      logger: {
        log: (message) => logs.push(message),
        warn: (message) => warnings.push(message)
      },
      openBrowser: async (url) => {
        openedUrl = url;
      }
    });

    try {
      expect(openedUrl).toBe(server.url);
      expect(logs).toContain(`Serving graph at ${server.url}`);

      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("codex-graph");

      const missing = await fetch(`${server.url}/missing`);
      expect(missing.status).toBe(404);

      const firstNode = graph.nodes[0];
      expect(firstNode).toBeDefined();
      if (!firstNode) {
        throw new Error("Expected sample graph to include at least one node.");
      }
      const updatedName = `${firstNode.name} updated`;
      await fs.writeFile(
        path.join(app, ".codex-graph", "graph.json"),
        `${JSON.stringify(
          {
            ...graph,
            nodes: [{ ...firstNode, name: updatedName }, ...graph.nodes.slice(1)]
          },
          null,
          2
        )}\n`
      );
      await waitForCondition(() =>
        logs.some((message) => message === "Graph updated. Refresh your browser to see changes.")
      );

      const refreshed = await fetch(server.url);
      expect(await refreshed.text()).toContain(updatedName);
      expect(warnings.every((message) => !message.includes("Could not open browser"))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("tracks incremental update cache state", async () => {
    const app = await copyFixture();

    const first = await updateGraph(app);
    expect(first.stats.cache?.mode).toBe("full");
    expect(first.stats.cache?.changedFiles).toBeGreaterThan(0);

    const second = await updateGraph(app);
    expect(second.stats.cache?.mode).toBe("skipped");
    expect(second.stats.cache?.changedFiles).toBe(0);

    await fs.appendFile(
      path.join(app, "src", "services", "user-service.ts"),
      "\nexport const userServiceVersion = \"test\";\n"
    );
    const third = await updateGraph(app);
    expect(third.stats.cache?.mode).toBe("incremental");
    expect(third.stats.cache?.changedFiles).toBe(1);

    await fs.rm(path.join(app, "src", "routes", "users.ts"));
    const fourth = await updateGraph(app);
    expect(fourth.stats.cache?.mode).toBe("incremental");
    expect(fourth.stats.cache?.deletedFiles).toBe(1);
    expect(fourth.nodes.some((node) => node.filePath === "src/routes/users.ts")).toBe(false);
  });

  it("installs MCP config into Codex config.toml with a backup-safe block", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-graph-mcp-"));
    const oldHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmp, "codex-home");
    try {
      await fs.mkdir(process.env.CODEX_HOME, { recursive: true });
      await fs.writeFile(path.join(process.env.CODEX_HOME, "config.toml"), 'model = "gpt-5.5"\n');
      const target = await installMcp("/repo/example");
      const config = await fs.readFile(target, "utf8");
      expect(config).toContain("[mcp_servers.codex-graph]");
      expect(config).toContain('args = ["serve", "--cwd", "/repo/example"]');

      await installMcp("/repo/next");
      const updated = await fs.readFile(target, "utf8");
      expect(updated.match(/\[mcp_servers\.codex-graph\]/g)?.length).toBe(1);
      expect(updated).toContain('args = ["serve", "--cwd", "/repo/next"]');
      expect((await fs.readdir(process.env.CODEX_HOME)).some((name) => name.startsWith("config.toml.bak."))).toBe(
        true
      );
    } finally {
      if (oldHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = oldHome;
      }
    }
  });
});

async function copyFixture(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-graph-fixture-"));
  const target = path.join(tmp, "sample-app");
  await fs.cp(path.resolve("tests/fixtures/sample-app"), target, { recursive: true });
  return target;
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}
