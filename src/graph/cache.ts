import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readJson, writeJson } from "../project/files.js";
import { projectGraphDir } from "../project/paths.js";
import type { FileCacheEntry, GraphCache, GraphCacheSummary } from "./types.js";

const CACHE_SCHEMA_VERSION = 1;
const GRAPH_SCHEMA_VERSION = 1;

export function graphCachePath(root: string): string {
  return path.join(projectGraphDir(root), "cache", "files.json");
}

export async function readGraphCache(root: string): Promise<GraphCache | undefined> {
  return readJson<GraphCache>(graphCachePath(root));
}

export async function writeGraphCache(root: string, files: Record<string, FileCacheEntry>): Promise<void> {
  await writeJson(graphCachePath(root), {
    schemaVersion: CACHE_SCHEMA_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    files
  } satisfies GraphCache);
}

export async function hashFiles(root: string, files: string[]): Promise<Record<string, FileCacheEntry>> {
  const entries: Record<string, FileCacheEntry> = {};
  for (const file of files) {
    const absolute = path.join(root, file);
    const [buffer, stat] = await Promise.all([fs.readFile(absolute), fs.stat(absolute)]);
    entries[file] = {
      sha256: createHash("sha256").update(buffer).digest("hex"),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  }
  return entries;
}

export function summarizeCacheChange(
  previous: GraphCache | undefined,
  nextFiles: Record<string, FileCacheEntry>
): GraphCacheSummary {
  if (!previous) {
    return {
      mode: "full",
      changedFiles: Object.keys(nextFiles).length,
      deletedFiles: 0,
      unchangedFiles: 0,
      reason: "missing cache"
    };
  }

  if (previous.schemaVersion !== CACHE_SCHEMA_VERSION || previous.graphSchemaVersion !== GRAPH_SCHEMA_VERSION) {
    return {
      mode: "full",
      changedFiles: Object.keys(nextFiles).length,
      deletedFiles: 0,
      unchangedFiles: 0,
      reason: "schema mismatch"
    };
  }

  const previousPaths = new Set(Object.keys(previous.files));
  const nextPaths = new Set(Object.keys(nextFiles));
  let changedFiles = 0;
  let unchangedFiles = 0;
  let deletedFiles = 0;

  for (const file of nextPaths) {
    const previousEntry = previous.files[file];
    const nextEntry = nextFiles[file];
    if (previousEntry?.sha256 === nextEntry?.sha256) {
      unchangedFiles += 1;
    } else {
      changedFiles += 1;
    }
  }

  for (const file of previousPaths) {
    if (!nextPaths.has(file)) {
      deletedFiles += 1;
    }
  }

  return {
    mode: changedFiles === 0 && deletedFiles === 0 ? "skipped" : "incremental",
    changedFiles,
    deletedFiles,
    unchangedFiles
  };
}
