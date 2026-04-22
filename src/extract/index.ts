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

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../schema/version.mjs";
import type { ClusterEdge } from "../schema/v1.js";
import { walkGitLog, type RawCommit } from "./walker.js";
import { DEFAULT_DELTA_CONFIG, computeDeltas } from "./deltas.js";

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const REPO = process.env.REPO ?? resolve(ROOT, "../monorepo");
const OUT = resolve(ROOT, "public/data.json");

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
const commitsRaw: RawCommit[] = walkGitLog({ repo: REPO });
console.log(`[extract] parsed ${commitsRaw.length} commits`);

const { files: keptFiles, commits: commitsFinal } = computeDeltas(commitsRaw, DEFAULT_DELTA_CONFIG);
console.log(`[extract] kept ${commitsFinal.length} commits, dropped ${commitsRaw.length - commitsFinal.length}`);

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
      MAX_FILES_PER_COMMIT: DEFAULT_DELTA_CONFIG.maxFilesPerCommit,
      MIN_FILE_TOTAL_TOUCHES: DEFAULT_DELTA_CONFIG.minFileTotalTouches,
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