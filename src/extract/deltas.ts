// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

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

/**
 * Checks whether a candidate path matches any compiled exclusion regex pattern.
 *
 * @complexity $\mathcal{O}(E \cdot L)$ where $E = |\text{exclude}|$ and $L = |\text{path}|$.
 */
export function isExcluded(path: string, exclude: RegExp[]): boolean {
  for (const re of exclude) if (re.test(path)) return true;
  return false;
}

const MONOREPO_GROUPS = new Set(["apps", "packages", "tools", "ops", "scripts", "services", "libs", "modules"]);
const CODE_ROOTS = new Set(["src", "lib", "source"]);

/**
 * Partitions file paths into architectural domain clusters using structural directory heuristics.
 *
 * ### Partitioning Invariants
 * 1. **Monorepo Packages**: If the top-level segment is a recognized monorepo container
 *    (`apps`, `packages`, `tools`, etc.), clusters by the 2-level path `head/pkg` (e.g. `packages/core`).
 * 2. **Standard Code Roots**: If the top-level segment is a code root (`src`, `lib`, `source`)
 *    with subdirectories, clusters by functional subsystem `src/cli`, `src/renderer` rather than
 *    collapsing the entire repository into a monolithic `src` cluster.
 * 3. **Fallback**: Default to root directory segment or `"(root)"`.
 *
 * @complexity $\mathcal{O}(L)$ time, $\mathcal{O}(L)$ space where $L = |\text{path}|$.
 */
export function clusterOf(path: string): string {
  const parts = path.split("/");
  const head = parts[0];
  if (MONOREPO_GROUPS.has(head) && parts.length > 1) return `${head}/${parts[1]}`;
  if (CODE_ROOTS.has(head) && parts.length > 2) return `${head}/${parts[1]}`;
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
 * Compiles chronological raw commits into compacted, indexed datasets with stable numeric file IDs.
 *
 * ### Algorithmic Phases
 * 1. **Pass 1: Evolutionary Graph Construction & Rename Tracking**:
 *    - Assigns monotonic stable integer IDs $0, 1, \dots, F-1$.
 *    - Resolves renames ($A \implies B$): preserves file identity $\text{id}(B) = \text{id}(A)$,
 *      updates current path to $B$, and records $A$ in the file's historical alias set.
 *    - Enforces noise filtering: drops commits touching $> M$ files ($\text{maxFilesPerCommit}$).
 * 2. **Pass 2: Activity Pruning & ID Compaction**:
 *    - Prunes ephemeral files with $\text{totalTouches} < T_{\min}$ ($\text{minFileTotalTouches}$).
 *    - Compacts surviving file IDs into a continuous zero-indexed sequence $[0, \dots, F'-1]$
 *      via an `oldToNew` direct array lookup.
 *    - Rewrites commit touch tuples $[id, added, removed]$ and discards empty commits.
 *
 * ### Computational Complexity
 * - **Time Complexity**: $\mathcal{O}(C \cdot T_{\text{avg}} + F \log F)$
 *   where $C = |\text{rawCommits}|$, $T_{\text{avg}}$ is average touches per commit,
 *   and $F$ is unique historical file count.
 * - **Auxiliary Space**: $\mathcal{O}(F + C \cdot T_{\text{avg}})$ heap residency for file registry
 *   and compacted commit sequence.
 *
 * @param rawCommits Chronological commits parsed from Git log.
 * @param config Delta extraction tunables (bulk limit, min touches, exclusions).
 * @returns Clean, compacted file registry and commit delta stream.
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
  const seen = new Set<number>();

  for (let ci = 0; ci < rawCommits.length; ci++) {
    const c = rawCommits[ci];
    const effective = c.changes.filter((ch) => {
      if (isExcluded(ch.from, config.exclude)) return false;
      return ch.from === ch.to ? true : !isExcluded(ch.to, config.exclude);
    });
    if (effective.length === 0) continue;
    if (effective.length > config.maxFilesPerCommit) continue;

    const touches: Array<[number, number, number]> = [];
    seen.clear();
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

  // Prune files with fewer than min touches
  const surviving = files.filter((f) => f.totalTouches >= config.minFileTotalTouches);
  const oldToNew = new Map<number, number>();
  for (let i = 0; i < surviving.length; i++) {
    oldToNew.set(surviving[i].id, i);
  }

  const finalFiles: FileMeta[] = surviving.map((f, newId): FileMeta => {
    const out: FileMeta = {
      id: newId,
      path: f.path,
      cluster: f.cluster,
      firstCommitIdx: f.firstCommitIdx,
      totalTouches: f.totalTouches,
    };
    if (f.allPaths.size > 1) out.aliases = Array.from(f.allPaths);
    return out;
  });

  // Rewrite commit touches to point at compacted file IDs
  const finalCommits: Commit[] = [];
  for (const c of commitsOut) {
    const remapTouches: Array<[number, number, number]> = [];
    for (const [oldId, a, r] of c.touches) {
      const newId = oldToNew.get(oldId);
      if (newId !== undefined) {
        remapTouches.push([newId, a, r]);
      }
    }
    if (remapTouches.length === 0) continue;
    finalCommits.push({ ...c, touches: remapTouches });
  }

  return { files: finalFiles, commits: finalCommits };
}
