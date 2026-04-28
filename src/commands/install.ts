import fs from "node:fs/promises";
import path from "node:path";

import { copyDir, writeJson } from "../project/files.js";
import { findPackageRoot, pathExists, skillInstallDir } from "../project/paths.js";

export async function installPlatform(platform: string): Promise<string> {
  assertCodexPlatform(platform);
  const root = await findPackageRoot();
  const source = path.join(root, "skill-template");
  if (!(await pathExists(source))) {
    throw new Error(`Missing skill template at ${source}`);
  }
  const target = skillInstallDir();
  await copyDir(source, target);
  await writeJson(path.join(target, "references", "install.json"), {
    package: "codex-graph",
    platform: "codex",
    installedAt: new Date().toISOString(),
    skillPath: target
  });
  return target;
}

export async function uninstallPlatform(platform: string): Promise<string> {
  assertCodexPlatform(platform);
  const target = skillInstallDir();
  if (await pathExists(target)) {
    await fs.rm(target, { recursive: true, force: true });
  }
  return target;
}

export async function doctor(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  const requiredMajor = 24;
  const actualMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  lines.push(
    `node: ${process.versions.node} (${actualMajor >= requiredMajor ? "ok" : `requires >=${requiredMajor}`})`
  );

  const skillDir = skillInstallDir();
  const skillOk = await pathExists(path.join(skillDir, "SKILL.md"));
  lines.push(`codex skill: ${skillOk ? "installed" : "missing"} (${skillDir})`);

  const graphPath = path.join(cwd, ".codex-graph", "graph.json");
  const graphOk = await pathExists(graphPath);
  lines.push(`project graph: ${graphOk ? "present" : "missing"} (${graphPath})`);

  const configPath = path.join(cwd, ".codex-graph", "config.json");
  const configOk = await pathExists(configPath);
  lines.push(`project config: ${configOk ? "present" : "missing"} (${configPath})`);

  const cachePath = path.join(cwd, ".codex-graph", "cache", "files.json");
  const cacheOk = await pathExists(cachePath);
  lines.push(`file cache: ${cacheOk ? "present" : "missing"} (${cachePath})`);

  return lines;
}

function assertCodexPlatform(platform: string): void {
  if (platform !== "codex") {
    throw new Error(`Unsupported platform "${platform}". Expected --platform codex.`);
  }
}
