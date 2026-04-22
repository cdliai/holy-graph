// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Extract a commit-indexed semantic graph from a git repository.
//
// Output (public/data.json):
//   {
//     meta: { repo, firstCommit, lastCommit, totalCommits, generatedAt, config },
//     clusters: [{ id, label, color, size, position: [x, z] }],
//     files:    [{ id, path, cluster, firstCommitIdx, totalTouches, aliases? }],
//     commits:  [{
//       sha, short, ts, date, author, msg,
//       touches: [[fileId, added, removed], ...]
//     }]
//   }
//
// The client replays commits forward, applying per-file activity EMA and per-edge
// co-change EMA with time-based decay. No per-frame snapshots are baked in —
// the animation truly grows from zero as each commit is applied.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../schema/version.mjs";
import type { Commit, FileMeta, ClusterEdge } from "../schema/v1.js";

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const REPO = process.env.REPO ?? resolve(ROOT, "../monorepo");
const OUT = resolve(ROOT, "public/data.json");

// Drop commits that touch more than this many files — usually bulk rewrites
// that would drown the co-change signal.
const MAX_FILES_PER_COMMIT = 80;

// Only keep files that were meaningfully touched at least this many times.
const MIN_FILE_TOTAL_TOUCHES = 2;

// Skip paths matching any of these
const EXCLUDE = [
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

// Cluster colors — assigned by size rank (largest clusters get the more vivid hues)
const CLUSTER_PALETTE = [
  "#7cc7ff", "#ffb86b", "#b78bff", "#66e6a9", "#ff7aa5",
  "#f1d86b", "#5ed8d0", "#ff8e5a", "#9fb7ff", "#c7f06b",
  "#ff6b8e", "#7ee2c4", "#d48bff", "#ffc07a", "#6bf0c3",
  "#ff9eb5", "#8bd4ff", "#e5ff6b", "#ffb38b", "#a0a8ff",
];

// Disk parameters: cluster anchors are laid out on a 2D disk (XZ plane).
// Radius scales with the number of clusters so they never overlap.
const DISK_MIN_RADIUS = 90;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512, // 512MB
  });
}

function isExcluded(path: string): boolean {
  for (const re of EXCLUDE) if (re.test(path)) return true;
  return false;
}

function clusterOf(path: string): string {
  const parts = path.split("/");
  const head = parts[0];
  const GROUPS = new Set(["apps", "packages", "tools", "ops", "scripts", "services", "libs"]);
  if (GROUPS.has(head) && parts.length > 1) return `${head}/${parts[1]}`;
  return head || "(root)";
}

// Lay clusters out on two concentric rings, sorted by size:
//   • The top `MAJOR_RING_COUNT` clusters share the outer ring.
//   • Remaining clusters share an inner ring at half the radius.
// Each cluster gets equal angular spacing on its ring — this guarantees strong
// visual separation between neighbours.
const MAJOR_RING_COUNT = 22;
function twoRingLayout(count: number, radius: number): [number, number][] {
  const pts = new Array<[number, number]>(count);
  const outer = Math.min(count, MAJOR_RING_COUNT);
  const inner = count - outer;
  // Outer ring: evenly distributed, start at -90° so the biggest cluster sits at the top.
  for (let i = 0; i < outer; i++) {
    const angle = -Math.PI / 2 + (i / outer) * Math.PI * 2;
    pts[i] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }
  // Inner ring: slightly rotated so inner/outer clusters don't radially align.
  const innerRadius = radius * 0.48;
  const rotate = Math.PI / Math.max(1, inner); // half-step offset
  for (let i = 0; i < inner; i++) {
    const angle = -Math.PI / 2 + rotate + (i / inner) * Math.PI * 2;
    pts[outer + i] = [Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius];
  }
  return pts;
}

// ────────────────────────────────────────────────────────────────
// Parse git log
// ────────────────────────────────────────────────────────────────

console.log(`[extract] repo: ${REPO}`);

const raw = git([
  "log",
  "--reverse",
  "--no-merges",
  "-M70%",
  "--numstat",
  "--pretty=format:C\t%H\t%at\t%aN\t%s",
]);

// ── rename-aware path splitter ──────────────────────────────────
//   "a\tb\tpath"                      -> regular change
//   "-\t-\tpath"                      -> binary
//   "a\tb\told => new"                -> rename collapsed
//   "a\tb\tprefix/{old => new}/suffix"-> rename with common prefix/suffix
function splitRename(field: string): { from: string; to: string } {
  const braceIdx = field.indexOf("{");
  if (braceIdx !== -1) {
    const closeIdx = field.indexOf("}", braceIdx);
    if (closeIdx === -1) return { from: field, to: field };
    const prefix = field.slice(0, braceIdx);
    const suffix = field.slice(closeIdx + 1);
    const inner = field.slice(braceIdx + 1, closeIdx);
    const [fromInner, toInner] = inner.split(" => ");
    const from = (prefix + (fromInner ?? "") + suffix).replace(/\/\//g, "/");
    const to = (prefix + (toInner ?? "") + suffix).replace(/\/\//g, "/");
    return { from, to };
  }
  const arrowIdx = field.indexOf(" => ");
  if (arrowIdx !== -1) {
    return { from: field.slice(0, arrowIdx), to: field.slice(arrowIdx + 4) };
  }
  return { from: field, to: field };
}

interface RawChange {
  from: string;
  to: string;
  added: number;
  removed: number;
}

interface RawCommit {
  hash: string;
  ts: number;
  author: string;
  subject: string;
  changes: RawChange[];
}

const commitsRaw: RawCommit[] = [];
let cur: RawCommit | null = null;

for (const line of raw.split("\n")) {
  if (!line) continue;
  if (line.startsWith("C\t")) {
    if (cur) commitsRaw.push(cur);
    const [, hash, ts, author, ...rest] = line.split("\t");
    cur = {
      hash,
      ts: Number(ts) * 1000,
      author: author || "unknown",
      subject: rest.join("\t") || "",
      changes: [],
    };
    continue;
  }
  if (!cur) continue;
  const parts = line.split("\t");
  if (parts.length < 3) continue;
  const added = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
  const removed = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
  const pathField = parts.slice(2).join("\t");
  const { from, to } = splitRename(pathField);
  cur.changes.push({ from, to, added, removed });
}
if (cur) commitsRaw.push(cur);

console.log(`[extract] parsed ${commitsRaw.length} commits`);

// ────────────────────────────────────────────────────────────────
// Walk commits chronologically. Per-commit:
//  - resolve renames into canonical file ids
//  - emit the per-commit touch list
// ────────────────────────────────────────────────────────────────

// current path -> id
const pathToId: Map<string, number> = new Map();

interface InternalFile {
  id: number;
  path: string;
  cluster: string;
  firstCommitIdx: number;
  totalTouches: number;
  allPaths: Set<string>;
}

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

let kept = 0;
let dropped = 0;
for (let ci = 0; ci < commitsRaw.length; ci++) {
  const c = commitsRaw[ci];
  const effective = c.changes.filter(
    (ch) => !isExcluded(ch.from) && !isExcluded(ch.to),
  );
  if (effective.length === 0) {
    dropped++;
    continue;
  }
  if (effective.length > MAX_FILES_PER_COMMIT) {
    dropped++;
    continue;
  }

  const touches: Array<[number, number, number]> = [];
  const seen: Set<number> = new Set();
  for (const ch of effective) {
    if (ch.from !== ch.to) {
      if (!pathToId.has(ch.from) && !pathToId.has(ch.to)) {
        ensureFile(ch.from, ci);
      }
      if (pathToId.has(ch.from)) renameFile(ch.from, ch.to);
    }
    const id = ensureFile(ch.to, ci);
    if (seen.has(id)) continue; // same file listed twice in one commit
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
  kept++;
}

console.log(`[extract] kept ${kept} commits, dropped ${dropped}`);

// ────────────────────────────────────────────────────────────────
// Prune files with too few touches; remap ids; update firstCommitIdx
// ────────────────────────────────────────────────────────────────

const remap: Map<number, number> = new Map();
const keptFiles: FileMeta[] = [];
for (const f of files) {
  if (f.totalTouches < MIN_FILE_TOTAL_TOUCHES) continue;
  const newId = keptFiles.length;
  remap.set(f.id, newId);
  keptFiles.push({
    id: newId,
    path: f.path,
    cluster: f.cluster,
    firstCommitIdx: -1, // fix below after commit filtering
    totalTouches: f.totalTouches,
    aliases: f.allPaths.size > 1 ? Array.from(f.allPaths) : undefined,
  });
}

// Filter touches in every commit; also track which commit index each surviving
// file first appears in (post-pruning, post-filter).
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

// Drop commits that ended up empty after pruning — they're no-ops for the graph.
const commitsFinal: Commit[] = [];
const commitIdxRemap: Map<number, number> = new Map();
for (let ci = 0; ci < commitsOut.length; ci++) {
  const c = commitsOut[ci];
  if (c.touches.length === 0) continue;
  commitIdxRemap.set(ci, commitsFinal.length);
  commitsFinal.push(c);
}
// Fix firstCommitIdx on files to point into commitsFinal
for (const f of keptFiles) {
  f.firstCommitIdx = commitIdxRemap.get(f.firstCommitIdx) ?? 0;
}

// ────────────────────────────────────────────────────────────────
// Build clusters with disk positions
// ────────────────────────────────────────────────────────────────

const clusterSize: Map<string, number> = new Map();
for (const f of keptFiles) {
  clusterSize.set(f.cluster, (clusterSize.get(f.cluster) ?? 0) + 1);
}
const clusterOrder = Array.from(clusterSize.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([c]) => c);

// Radius scales with the outer-ring capacity so ring spacing never shrinks
// below ~25 units between neighbours.
const diskRadius = Math.max(
  DISK_MIN_RADIUS,
  (Math.min(clusterOrder.length, MAJOR_RING_COUNT) * 26) / (2 * Math.PI),
);
const diskPositions = twoRingLayout(clusterOrder.length, diskRadius);

const clusters = clusterOrder.map((id, i) => ({
  id,
  label: id,
  color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
  size: clusterSize.get(id) ?? 0,
  // [x, z] fallback anchor for clients that don't run the organic layout.
  position: diskPositions[i],
}));

// ────────────────────────────────────────────────────────────────
// Cluster-cluster affinity: how often do two clusters have files that
// co-change in the same commit? This seeds the organic cluster layout on
// the client (d3-force over cluster-nodes with weighted attraction).
// ────────────────────────────────────────────────────────────────

const clusterIndex = new Map(clusterOrder.map((c, i): [string, number] => [c, i]));
const fileCluster = new Map(keptFiles.map((f): [number, string] => [f.id, f.cluster]));
function affKey(a: number, b: number): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }
const affinity: Map<string, number> = new Map();

for (const c of commitsFinal) {
  if (c.touches.length <= 1) continue;
  // Unique cluster indices touched in this commit.
  const ci: Set<number> = new Set();
  for (const [fid] of c.touches) {
    const cid = fileCluster.get(fid);
    if (cid === undefined) continue;
    const idx = clusterIndex.get(cid);
    if (idx !== undefined) ci.add(idx);
  }
  if (ci.size <= 1) continue;
  const arr = Array.from(ci);
  // Per-pair weight contribution decays with how many clusters touched (big
  // commits shouldn't dominate the signal).
  const contribution = 1 / Math.log2(arr.length + 2);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const k = affKey(arr[i], arr[j]);
      affinity.set(k, (affinity.get(k) ?? 0) + contribution);
    }
  }
}

// Emit as compact array, filtering out near-zero edges.
const clusterEdges: ClusterEdge[] = [];
for (const [k, w] of affinity) {
  if (w < 0.5) continue;
  const [as, bs] = k.split("|");
  clusterEdges.push([Number(as), Number(bs), +w.toFixed(3)]);
}
clusterEdges.sort((a, b) => b[2] - a[2]);

// ────────────────────────────────────────────────────────────────
// Write output
// ────────────────────────────────────────────────────────────────

mkdirSync(dirname(OUT), { recursive: true });

const out = {
  schemaVersion: SCHEMA_VERSION,
  meta: {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    totalCommits: commitsFinal.length,
    firstCommit: new Date(commitsFinal[0]?.ts ?? 0).toISOString(),
    lastCommit: new Date(commitsFinal[commitsFinal.length - 1]?.ts ?? 0).toISOString(),
    diskRadius,
    config: {
      MAX_FILES_PER_COMMIT,
      MIN_FILE_TOTAL_TOUCHES,
    },
  },
  clusters,
  clusterEdges,
  files: keptFiles,
  commits: commitsFinal,
};

const serialized = JSON.stringify(out);
writeFileSync(OUT, serialized);
console.log(
  `[extract] ${keptFiles.length} files · ${clusters.length} clusters · ${commitsFinal.length} commits · ${(serialized.length / 1024).toFixed(1)} KB`,
);
console.log(`[extract] wrote ${OUT}`);