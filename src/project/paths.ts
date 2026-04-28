import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GRAPH_DIR = ".codex-graph";
export const GRAPH_FILE = "graph.json";

export function codexHome(): string {
  return process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
}

export function skillInstallDir(): string {
  return path.join(codexHome(), "skills", "codex-graph");
}

export function projectGraphDir(cwd: string): string {
  return path.join(cwd, GRAPH_DIR);
}

export function projectGraphPath(cwd: string): string {
  return path.join(projectGraphDir(cwd), GRAPH_FILE);
}

export async function findPackageRoot(start = fileURLToPath(import.meta.url)): Promise<string> {
  let current = path.dirname(start);
  while (true) {
    try {
      const packagePath = path.join(current, "package.json");
      const raw = await fs.readFile(packagePath, "utf8");
      const parsed = JSON.parse(raw) as { name?: string };
      if (parsed.name === "codex-graph") {
        return current;
      }
    } catch {
      // Keep walking upward.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
