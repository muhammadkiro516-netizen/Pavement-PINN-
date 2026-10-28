import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { RuntimeIdentity } from "../../src/types";
import { codeVersion } from "./codeVersion";

/**
 * Identity of this server process, so a page or a script can tell whether two ports reach the
 * same runtime (same runtimeId, same data store) or different ones. Paths are reported as
 * hashes (rootId, storeId) plus a repo-relative location — never secrets or credentials.
 */
import { REPO_ROOT } from "./repoRoot";
const RUNTIME_ID = randomUUID();
const STARTED_AT = new Date().toISOString();

const hash = (value: string) => createHash("sha256").update(path.resolve(value).toLowerCase()).digest("hex").slice(0, 12);
export const PROJECT_ROOT = REPO_ROOT;
export const projectRootId = () => hash(REPO_ROOT);
export const storeIdFor = (location: string) => hash(location);

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 }).trim();
  } catch {
    return null;
  }
}

let ports = { primary: 0, aliases: [] as number[] };
let store: { kind: "file" | "memory"; location: string | null } = { kind: "memory", location: null };
let sharedSecret = false;

export function setRuntimePorts(primary: number, aliases: number[]): void {
  ports = { primary, aliases };
}
export function setRuntimeStore(kind: "file" | "memory", location: string | null, sessionSecretSet: boolean): void {
  store = { kind, location };
  sharedSecret = sessionSecretSet;
}
export const runtimeId = () => RUNTIME_ID;

/** Repo-relative path, or "outside-project": an absolute path (user names, drives) is never sent. */
function insideProject(location: string): string {
  const rel = path.relative(REPO_ROOT, path.resolve(location));
  return rel.startsWith("..") || path.isAbsolute(rel) ? "outside-project" : rel.split(path.sep).join("/");
}

export function runtimeIdentity(requestPort: number | null): RuntimeIdentity {
  const code = codeVersion();
  const status = git(["status", "--porcelain"]);
  const worktrees = git(["worktree", "list", "--porcelain"]);
  return {
    app: "pavement-pinn",
    status: "ok",
    runtimeId: RUNTIME_ID,
    pid: process.pid,
    startedAt: STARTED_AT,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    ports,
    requestPort,
    project: {
      name: path.basename(REPO_ROOT),
      rootId: projectRootId(),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: code.currentCommit,
      dirtyFiles: status === null ? null : status.split("\n").filter(Boolean).length,
      worktrees: worktrees === null ? null : worktrees.split("\n").filter((l) => l.startsWith("worktree ")).length
    },
    code: { commit: code.commit, syncStatus: code.syncStatus, stale: code.stale, changedFiles: code.changedFiles, fingerprint: code.fingerprint },
    dataStore: {
      kind: store.kind,
      storeId: store.location ? storeIdFor(store.location) : "memory",
      relativeLocation: store.location ? insideProject(store.location) : null
    },
    api: { baseUrl: "/api (same origin)" },
    sessions: sharedSecret ? "shared-secret" : "per-process"
  };
}
