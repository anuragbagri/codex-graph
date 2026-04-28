import fs from "node:fs/promises";
import path from "node:path";

import { ensureDir, removeMarkedSection, upsertMarkedSection, writeJson } from "../project/files.js";
import { pathExists, projectGraphDir } from "../project/paths.js";

const AGENTS_SECTION = `## codex-graph

For architecture, dependency, symbol, route, test, or impact questions, query the
local graph before reading raw files:

\`\`\`bash
codex-graph query "<question>"
codex-graph explain <symbol-or-file>
codex-graph deps <file-or-symbol>
codex-graph path <from> <to>
codex-graph impact <file-or-symbol>
\`\`\`

Use graph output as a map, then inspect the suggested files directly.`;

export async function initProject(cwd: string): Promise<string[]> {
  const graphDir = projectGraphDir(cwd);
  await ensureDir(path.join(graphDir, "cache"));
  await writeJson(path.join(graphDir, "config.json"), {
    schemaVersion: 1,
    language: "js-ts",
    graphFile: ".codex-graph/graph.json",
    cacheDir: ".codex-graph/cache",
    deterministic: true
  });

  const ignorePath = path.join(cwd, ".codexgraphignore");
  if (!(await pathExists(ignorePath))) {
    await fs.writeFile(ignorePath, ["node_modules/", "dist/", "coverage/", ".git/"].join("\n") + "\n");
  }

  await installProjectCodex(cwd);
  return [`initialized ${graphDir}`, "updated AGENTS.md"];
}

export async function installProjectCodex(cwd: string): Promise<string> {
  const agentsPath = path.join(cwd, "AGENTS.md");
  const existing = (await pathExists(agentsPath)) ? await fs.readFile(agentsPath, "utf8") : "# AGENTS\n";
  await fs.writeFile(agentsPath, upsertMarkedSection(existing, "agents", AGENTS_SECTION));
  await bestEffortHooks(cwd);
  return agentsPath;
}

export async function uninstallProjectCodex(cwd: string): Promise<string> {
  const agentsPath = path.join(cwd, "AGENTS.md");
  if (await pathExists(agentsPath)) {
    await fs.writeFile(agentsPath, removeMarkedSection(await fs.readFile(agentsPath, "utf8"), "agents"));
  }
  return agentsPath;
}

export async function projectCodexStatus(cwd: string): Promise<string[]> {
  const agentsPath = path.join(cwd, "AGENTS.md");
  const graphDir = projectGraphDir(cwd);
  return [
    `AGENTS.md: ${(await pathExists(agentsPath)) ? "present" : "missing"}`,
    `.codex-graph/config.json: ${(await pathExists(path.join(graphDir, "config.json"))) ? "present" : "missing"}`,
    `.codex-graph/graph.json: ${(await pathExists(path.join(graphDir, "graph.json"))) ? "present" : "missing"}`
  ];
}

async function bestEffortHooks(cwd: string): Promise<void> {
  const codexDir = path.join(cwd, ".codex");
  try {
    await ensureDir(codexDir);
    const hooksPath = path.join(codexDir, "hooks.json");
    if (!(await pathExists(hooksPath))) {
      await fs.writeFile(
        hooksPath,
        `${JSON.stringify(
          {
            codexGraph: {
              note: "Best-effort placeholder for Codex clients that support project hooks.",
              build: "codex-graph build ."
            }
          },
          null,
          2
        )}\n`
      );
    }
  } catch {
    // Hooks are optional and client-specific; project install should still succeed.
  }
}
