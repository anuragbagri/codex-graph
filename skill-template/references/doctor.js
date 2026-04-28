#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const graph = join(cwd, ".codex-graph", "graph.json");
console.log(existsSync(graph) ? `graph present: ${graph}` : `graph missing: ${graph}`);
