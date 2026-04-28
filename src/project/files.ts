import fs from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./paths.js";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function copyDir(source: string, target: string): Promise<void> {
  await ensureDir(target);
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(to));
      await fs.copyFile(from, to);
    }
  }
}

export function markedSection(name: string, body: string): string {
  return [
    `<!-- codex-graph:${name}:start -->`,
    body.trim(),
    `<!-- codex-graph:${name}:end -->`
  ].join("\n");
}

export function upsertMarkedSection(existing: string, name: string, body: string): string {
  const start = `<!-- codex-graph:${name}:start -->`;
  const end = `<!-- codex-graph:${name}:end -->`;
  const section = markedSection(name, body);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(existing)) {
    return existing.replace(pattern, section);
  }
  return `${existing.trimEnd()}\n\n${section}\n`;
}

export function removeMarkedSection(existing: string, name: string): string {
  const start = `<!-- codex-graph:${name}:start -->`;
  const end = `<!-- codex-graph:${name}:end -->`;
  const pattern = new RegExp(`\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g");
  return existing.replace(pattern, "\n").trimEnd() + "\n";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
