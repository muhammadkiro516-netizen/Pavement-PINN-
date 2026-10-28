import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Which code this server process runs. Node does not reload server code, so a process
 * started before an edit to server/domain code keeps the old rules and storage logic while
 * the browser already gets the new frontend. The health endpoint reports this so the UI can
 * warn instead of looking "in sync".
 *
 * The verdict comes from the content fingerprint of the sources the process loads, not from
 * git: committing code the process already runs does not make it stale, and an edit that is
 * not committed yet does.
 */
import { REPO_ROOT } from "./repoRoot";
/** Loaded by the server process: server code and the domain rules it imports. */
export const WATCHED_DIRS = ["server", "src/domain"];

/** Sources the server process imports; tests and type declarations are never loaded. */
export const isRuntimeSource = (name: string) => /\.(ts|tsx|js|mjs)$/.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name) && !name.endsWith(".d.ts");

function gitHead(): string | null {
  if (process.env.SIMULATE_COMMIT_MISMATCH) {
    return process.env.SIMULATE_COMMIT_MISMATCH;
  }
  try {
    return (
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2500
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export interface Fingerprint {
  /** Repo-relative path with "/" separators (same key on Windows and POSIX) → sha1 of the content. */
  files: Map<string, string>;
  /** Files that could not be read; a fingerprint with any is not trustworthy. */
  unreadable: string[];
}

/** Content fingerprint (not mtime: a file saved again unchanged is not "modified"). */
export function fingerprint(root: string, dirs: string[] = WATCHED_DIRS): Fingerprint {
  const files = new Map<string, string>();
  const unreadable: string[] = [];
  const key = (full: string) => path.relative(root, full).split(path.sep).join("/");
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable.push(key(dir));
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (isRuntimeSource(entry.name)) {
        try {
          files.set(key(full), createHash("sha1").update(readFileSync(full)).digest("hex"));
        } catch {
          unreadable.push(key(full));
        }
      }
    }
  };
  for (const dir of dirs) walk(path.resolve(root, dir));
  return { files, unreadable };
}

/** Files added, changed or removed between two fingerprints, sorted. */
export function changedFiles(start: Fingerprint, now: Fingerprint): string[] {
  const changed = [...now.files].filter(([file, hash]) => start.files.get(file) !== hash).map(([file]) => file);
  const removed = [...start.files.keys()].filter((file) => !now.files.has(file));
  return [...changed, ...removed].sort();
}

export type SyncStatus = "SYNCED" | "COMMIT_MISMATCH" | "SOURCE_MODIFIED" | "UNKNOWN";

/**
 * - UNKNOWN: a fingerprint could not be taken completely, so nothing can be claimed.
 * - SOURCE_MODIFIED / COMMIT_MISMATCH: loaded sources differ from disk (a restart is needed);
 *   COMMIT_MISMATCH when HEAD also moved (checkout, pull), which usually explains why.
 * - SYNCED: the process runs exactly what is on disk, whatever the commit says.
 */
export function classify(start: Fingerprint, now: Fingerprint, startCommit: string | null, currentCommit: string | null): { syncStatus: SyncStatus; changed: string[] } {
  if (start.unreadable.length || now.unreadable.length || start.files.size === 0) {
    return { syncStatus: "UNKNOWN", changed: [...new Set([...start.unreadable, ...now.unreadable])].sort() };
  }
  const changed = changedFiles(start, now);
  if (changed.length === 0) return { syncStatus: "SYNCED", changed };
  const headMoved = Boolean(startCommit && currentCommit && startCommit !== currentCommit);
  return { syncStatus: headMoved ? "COMMIT_MISMATCH" : "SOURCE_MODIFIED", changed };
}

const started = { at: new Date().toISOString(), commit: gitHead(), fingerprint: fingerprint(REPO_ROOT) };
/** Short content hash of the loaded sources, so two reports can be compared at a glance. */
const digest = (fp: Fingerprint) =>
  createHash("sha1").update([...fp.files].sort(([a], [b]) => a.localeCompare(b)).map(([f, h]) => `${f}:${h}`).join("\n")).digest("hex").slice(0, 12);
const startedDigest = digest(started.fingerprint);

export interface CodeVersion {
  pid: number;
  startedAt: string;
  /** Commit checked out when this process started. */
  commit: string | null;
  /** Commit checked out now in the repository. */
  currentCommit: string | null;
  /** True unless the loaded sources are verified identical to disk. */
  stale: boolean;
  /** Synchronisation status between running server and repository. */
  syncStatus: SyncStatus;
  /** Timestamp when the check was performed. */
  checkedAt: string;
  /** Server/domain files changed since start (first 10), so the warning says what to reload. */
  changedFiles: string[];
  /** Fingerprint of the sources this process loaded, and of the same sources on disk now. */
  fingerprint?: { loaded: string; disk: string; files: number };
}

export function codeVersion(): CodeVersion {
  const currentCommit = gitHead();
  const now = fingerprint(REPO_ROOT);
  const { syncStatus, changed } = classify(started.fingerprint, now, started.commit, currentCommit);
  return {
    pid: process.pid,
    startedAt: started.at,
    commit: started.commit,
    currentCommit,
    stale: syncStatus !== "SYNCED",
    syncStatus,
    checkedAt: new Date().toISOString(),
    changedFiles: changed.slice(0, 10),
    fingerprint: { loaded: startedDigest, disk: digest(now), files: now.files.size }
  };
}
