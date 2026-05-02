import fs from "node:fs/promises";
import path from "node:path";

const packageRoot = process.cwd();
const source = path.join(packageRoot, "node_modules", "cytoscape", "dist", "cytoscape.min.js");
const targetDir = path.join(packageRoot, "dist", "vendor");
const target = path.join(targetDir, "cytoscape.min.js");

await fs.mkdir(targetDir, { recursive: true });
await fs.copyFile(source, target);

console.log(`Copied ${path.relative(packageRoot, target)}`);
