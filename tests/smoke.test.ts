import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { installPlatform, uninstallPlatform } from "../src/commands/install.js";
import { initProject } from "../src/commands/project.js";
import { buildGraph } from "../src/graph/build.js";
import { deps, explain, impact, queryGraph, shortestPath } from "../src/graph/query.js";
import { writeVisualization } from "../src/graph/visualize.js";

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
});

async function copyFixture(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-graph-fixture-"));
  const target = path.join(tmp, "sample-app");
  await fs.cp(path.resolve("tests/fixtures/sample-app"), target, { recursive: true });
  return target;
}
