// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Commit filtering, file pruning, and per-commit touch assembly.
// Takes parsed raw commits and returns the set of surviving files + commits with
// stable numeric file ids, dropping bulk-rewrite commits and rarely-touched files.

import type { Commit, FileMeta } from "../schema/v1.js";
import type { RawCommit } from "./walker.js";

export interface DeltaConfig {
  /** Drop commits that touch more than this many files. */
  maxFilesPerCommit: number;
  /** Drop files that were touched fewer than this many times. */
  minFileTotalTouches: number;
  /** Path regexes — matching files are excluded entirely. */
  exclude: RegExp[];
}

export const DEFAULT_EXCLUDE: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.svelte-kit(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|mov|webm|woff2?|ttf|eot|pdf|zip|gz|tgz|wasm)$/i,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/,
  /(^|\/)\.DS_Store$/,
];

export const DEFAULT_DELTA_CONFIG: DeltaConfig = {
  maxFilesPerCommit: 80,
  minFileTotalTouches: 2,
  exclude: DEFAULT_EXCLUDE,
};

export interface DeltaResult {
  files: FileMeta[];
  commits: Commit[];
}

export function isExcluded(path: string, exclude: RegExp[]): boolean {
  for (const re of exclude) if (re.test(path)) return true;
  return false;
}

/**
 * Heuristic bucket for a file into a cluster by its top-level directory — or
 * two levels when the top level is a known monorepo grouping (`apps/`, `packages/`, …).
 */
export function clusterOf(path: string): string {
  const parts = path.split("/");
  const head = parts[0];
  const GROUPS = new Set(["apps", "packages", "tools", "ops", "scripts", "services", "libs"]);
  if (GROUPS.has(head) && parts.length > 1) return `${head}/${parts[1]}`;
  return head || "(root)";
}

interface InternalFile {
  id: number;
  path: string;
  cluster: string;
  firstCommitIdx: number;
  totalTouches: number;
  allPaths: Set<string>;
}

/**
 * Walk raw commits in order and assemble the final Dataset-compatible
 * `files` and `commits` arrays, with stable numeric ids and pruning.
 */
export function computeDeltas(rawCommits: RawCommit[], config: DeltaConfig): DeltaResult {
  const pathToId = new Map<string, number>();
  const files: InternalFile[] = [];

  function ensureFile(path: string, commitIdx: number): number {
    let id = pathToId.get(path);
    if (id === undefined) {
      id = files.length;
      files.push({
        id,
        path,
        cluster: clusterOf(path),
        firstCommitIdx: commitIdx,
        totalTouches: 0,
        allPaths: new Set([path]),
      });
      pathToId.set(path, id);
    }
    return id;
  }

  function renameFile(from: string, to: string): void {
    if (from === to) return;
    const id = pathToId.get(from);
    if (id === undefined) return;
    pathToId.delete(from);
    pathToId.set(to, id);
    const f = files[id];
    f.path = to;
    f.cluster = clusterOf(to);
    f.allPaths.add(to);
  }

  const commitsOut: Commit[] = [];

  for (let ci = 0; ci < rawCommits.length; ci++) {
    const c = rawCommits[ci];
    const effective = c.changes.filter(
      (ch) => !isExcluded(ch.from, config.exclude) && !isExcluded(ch.to, config.exclude),
    );
    if (effective.length === 0) continue;
    if (effective.length > config.maxFilesPerCommit) continue;

    const touches: Array<[number, number, number]> = [];
    const seen = new Set<number>();
    for (const ch of effective) {
      if (ch.from !== ch.to) {
        if (!pathToId.has(ch.from) && !pathToId.has(ch.to)) {
          ensureFile(ch.from, ci);
        }
        if (pathToId.has(ch.from)) renameFile(ch.from, ch.to);
      }
      const id = ensureFile(ch.to, ci);
      if (seen.has(id)) continue;
      seen.add(id);
      files[id].totalTouches += 1;
      touches.push([id, ch.added, ch.removed]);
    }

    commitsOut.push({
      sha: c.hash,
      short: c.hash.slice(0, 7),
      ts: c.ts,
      date: new Date(c.ts).toISOString().slice(0, 10),
      author: c.author,
      msg: c.subject.slice(0, 200),
      touches,
    });
  }

  // Prune files below the touch threshold, remap ids.
  const remap = new Map<number, number>();
  const keptFiles: FileMeta[] = [];
  for (const f of files) {
    if (f.totalTouches < config.minFileTotalTouches) continue;
    const newId = keptFiles.length;
    remap.set(f.id, newId);
    keptFiles.push({
      id: newId,
      path: f.path,
      cluster: f.cluster,
      firstCommitIdx: -1, // fixed up below
      totalTouches: f.totalTouches,
      aliases: f.allPaths.size > 1 ? Array.from(f.allPaths) : undefined,
    });
  }

  // Filter touches against remap and track each file's post-filter first-appearance index.
  for (let ci = 0; ci < commitsOut.length; ci++) {
    const c = commitsOut[ci];
    const filtered: Array<[number, number, number]> = [];
    for (const [oldId, added, removed] of c.touches) {
      const nid = remap.get(oldId);
      if (nid === undefined) continue;
      filtered.push([nid, added, removed]);
      if (keptFiles[nid].firstCommitIdx === -1) {
        keptFiles[nid].firstCommitIdx = ci;
      }
    }
    c.touches = filtered;
  }

  // Drop commits that ended up empty after pruning.
  const commitsFinal: Commit[] = [];
  const commitIdxRemap = new Map<number, number>();
  for (let ci = 0; ci < commitsOut.length; ci++) {
    const c = commitsOut[ci];
    if (c.touches.length === 0) continue;
    commitIdxRemap.set(ci, commitsFinal.length);
    commitsFinal.push(c);
  }

  for (const f of keptFiles) {
    f.firstCommitIdx = commitIdxRemap.get(f.firstCommitIdx) ?? 0;
  }

  return { files: keptFiles, commits: commitsFinal };
}
