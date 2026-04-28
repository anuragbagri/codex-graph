#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { doctor, installPlatform, uninstallPlatform } from "./commands/install.js";
import {
  initProject,
  installProjectCodex,
  projectCodexStatus,
  uninstallProjectCodex
} from "./commands/project.js";
import { buildGraph, updateGraph } from "./graph/build.js";
import { deps, explain, impact, queryGraph, shortestPath, loadGraph } from "./graph/query.js";
import { writeVisualization } from "./graph/visualize.js";
import { installMcp, serveMcp } from "./mcp/server.js";

const program = new Command();

program
  .name("codex-graph")
  .description("Codex skill and local JS/TS knowledge graph engine")
  .version("0.1.0");

program
  .command("install")
  .description("Install codex-graph into a supported AI platform")
  .requiredOption("--platform <platform>", "target platform, currently codex")
  .action(async (options: { platform: string }) => {
    const target = await installPlatform(options.platform);
    console.log(`Installed codex-graph skill to ${target}`);
    console.log("Restart Codex so it can discover the skill.");
  });

program
  .command("uninstall")
  .description("Uninstall codex-graph from a supported AI platform")
  .requiredOption("--platform <platform>", "target platform, currently codex")
  .action(async (options: { platform: string }) => {
    const target = await uninstallPlatform(options.platform);
    console.log(`Removed codex-graph skill from ${target}`);
  });

program
  .command("doctor")
  .description("Check codex-graph installation and project state")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log((await doctor(path.resolve(options.cwd))).join("\n"));
  });

program
  .command("init")
  .description("Initialize codex-graph in the current project")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log((await initProject(path.resolve(options.cwd))).join("\n"));
  });

const codex = program.command("codex").description("Manage project-level Codex wiring");

codex
  .command("install")
  .description("Install project AGENTS.md guidance for codex-graph")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log(`Updated ${await installProjectCodex(path.resolve(options.cwd))}`);
  });

codex
  .command("status")
  .description("Show project Codex wiring status")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log((await projectCodexStatus(path.resolve(options.cwd))).join("\n"));
  });

codex
  .command("uninstall")
  .description("Remove project AGENTS.md codex-graph guidance")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log(`Updated ${await uninstallProjectCodex(path.resolve(options.cwd))}`);
  });

program
  .command("build")
  .description("Build the local JS/TS graph")
  .argument("[path]", "project path", ".")
  .action(async (targetPath: string) => {
    const graph = await buildGraph({ root: path.resolve(targetPath), write: true });
    console.log(
      `Built graph: ${graph.stats.files} files, ${graph.stats.symbols} symbols, ${graph.stats.edges} edges`
    );
  });

program
  .command("update")
  .description("Update the local graph")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    const graph = await updateGraph(path.resolve(options.cwd));
    const cache = graph.stats.cache;
    console.log(
      [
        `Updated graph: ${graph.stats.files} files, ${graph.stats.symbols} symbols, ${graph.stats.edges} edges`,
        cache
          ? `cache: ${cache.mode}, changed ${cache.changedFiles}, deleted ${cache.deletedFiles}, unchanged ${cache.unchangedFiles}`
          : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  });

program
  .command("query")
  .description("Search the graph with deterministic ranking")
  .argument("<question>", "question to answer from the graph")
  .option("--json", "emit JSON")
  .option("--limit <number>", "result limit", parseInteger, 8)
  .option("--depth <number>", "neighbor depth", parseInteger, 1)
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (question: string, options: QueryCliOptions) => {
    printResult(
      await queryGraph(
        question,
        queryOptions(path.resolve(options.cwd), options.limit, options.depth, options.json)
      ),
      options.json
    );
  });

program
  .command("explain")
  .description("Explain a symbol or file")
  .argument("<symbol-or-file>")
  .option("--json", "emit JSON")
  .option("--depth <number>", "neighbor depth", parseInteger, 1)
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (target: string, options: QueryCliOptions) => {
    printResult(
      await explain(
        target,
        queryOptions(path.resolve(options.cwd), options.limit ?? 8, options.depth, options.json)
      ),
      options.json
    );
  });

program
  .command("deps")
  .description("Show outgoing dependencies for a file or symbol")
  .argument("<file-or-symbol>")
  .option("--json", "emit JSON")
  .option("--depth <number>", "neighbor depth", parseInteger, 1)
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (target: string, options: QueryCliOptions) => {
    printResult(
      await deps(target, queryOptions(path.resolve(options.cwd), options.limit ?? 8, options.depth, options.json)),
      options.json
    );
  });

program
  .command("impact")
  .description("Show incoming dependents for a file or symbol")
  .argument("<file-or-symbol>")
  .option("--json", "emit JSON")
  .option("--depth <number>", "neighbor depth", parseInteger, 1)
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (target: string, options: QueryCliOptions) => {
    printResult(
      await impact(
        target,
        queryOptions(path.resolve(options.cwd), options.limit ?? 8, options.depth, options.json)
      ),
      options.json
    );
  });

program
  .command("path")
  .description("Find a shortest path between two graph targets")
  .argument("<from>")
  .argument("<to>")
  .option("--json", "emit JSON")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (from: string, to: string, options: QueryCliOptions) => {
    printResult(
      await shortestPath(
        from,
        to,
        queryOptions(path.resolve(options.cwd), options.limit ?? 8, options.depth ?? 1, options.json)
      ),
      options.json
    );
  });

program
  .command("visualize")
  .description("Generate .codex-graph/graph.html")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    const cwd = path.resolve(options.cwd);
    const outPath = await writeVisualization(await loadGraph(cwd), cwd);
    console.log(`Wrote ${outPath}`);
  });

program
  .command("serve")
  .description("Start the codex-graph MCP server over stdio")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    await serveMcp(path.resolve(options.cwd));
  });

const mcp = program.command("mcp").description("Manage MCP integration");

mcp
  .command("install")
  .description("Write a safe MCP launcher config")
  .option("--cwd <path>", "project cwd", process.cwd())
  .action(async (options: { cwd: string }) => {
    console.log(`Wrote ${await installMcp(path.resolve(options.cwd))}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

interface QueryCliOptions {
  cwd: string;
  limit: number;
  depth: number;
  json?: boolean;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer, received ${value}`);
  }
  return parsed;
}

function queryOptions(cwd: string, limit: number, depth: number, json?: boolean) {
  return {
    cwd,
    limit,
    depth,
    ...(json === undefined ? {} : { json })
  };
}

function printResult(result: unknown, json = false): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(String(result));
  }
}
