import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, from source (tsx, ESM) or from the production bundle (dist/server.cjs,
 * where import.meta.url does not exist): walk up from this module to the nearest package.json.
 */
function findRepoRoot(): string {
  let dir = typeof import.meta.url === "string" ? path.dirname(fileURLToPath(import.meta.url)) : __dirname;
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

export const REPO_ROOT = findRepoRoot();
