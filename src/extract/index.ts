// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Extract a commit-indexed semantic graph from a git repository.
//
// Public API: `extract(opts)` returns a Dataset. When invoked as a script
// (`tsx src/extract/index.ts`), reads the REPO env var and writes
// public/data.json.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMA_VERSION } from "../schema/version.mjs";
import type { Cluster, ClusterEdge, Dataset, FileMeta } from "../schema/v1.js";

import { walkGitLog, type RawCommit } from "./walker.js";
import { computeDeltas, DEFAULT_DELTA_CONFIG, type DeltaConfig } from "./deltas.js";
import { computeAffinity } from "./affinity.js";
import { createProgress } from "./progress.js";

// ────────────────────────────────────────────────────────────────
// Cluster layout — lays cluster anchors on two concentric rings.
// ────────────────────────────────────────────────────────────────

const CLUSTER_PALETTE = [
  "#7cc7ff", "#ffb86b", "#b78bff", "#66e6a9", "#ff7aa5",
  "#f1d86b", "#5ed8d0", "#ff8e5a", "#9fb7ff", "#c7f06b",
  "#ff6b8e", "#7ee2c4", "#d48bff", "#ffc07a", "#6bf0c3",
  "#ff9eb5", "#8bd4ff", "#e5ff6b", "#ffb38b", "#a0a8ff",
];

const MAJOR_RING_COUNT = 22;
const DISK_MIN_RADIUS = 90;

function twoRingLayout(count: number, radius: number): [number, number][] {
  const pts = new Array<[number, number]>(count);
  const outer = Math.min(count, MAJOR_RING_COUNT);
  const inner = count - outer;
  for (let i = 0; i < outer; i++) {
    const angle = -Math.PI / 2 + (i / outer) * Math.PI * 2;
    pts[i] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }
  const innerRadius = radius * 0.48;
  const rotate = Math.PI / Math.max(1, inner);
  for (let i = 0; i < inner; i++) {
    const angle = -Math.PI / 2 + rotate + (i / inner) * Math.PI * 2;
    pts[outer + i] = [Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius];
  }
  return pts;
}

function buildClusters(files: FileMeta[]): {
  clusters: Cluster[];
  clusterOrder: string[];
  diskRadius: number;
} {
  const clusterSize = new Map<string, number>();
  for (const f of files) {
    clusterSize.set(f.cluster, (clusterSize.get(f.cluster) ?? 0) + 1);
  }
  const clusterOrder = Array.from(clusterSize.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const diskRadius = Math.max(
    DISK_MIN_RADIUS,
    (Math.min(clusterOrder.length, MAJOR_RING_COUNT) * 26) / (2 * Math.PI),
  );
  const diskPositions = twoRingLayout(clusterOrder.length, diskRadius);

  const clusters: Cluster[] = clusterOrder.map((id, i) => ({
    id,
    label: id,
    color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
    size: clusterSize.get(id) ?? 0,
    position: diskPositions[i],
  }));

  return { clusters, clusterOrder, diskRadius };
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** Absolute path to the git repository to analyze. */
  repo: string;
  /** Optional `--since` filter passed to git log. */
  since?: string;
  /** Override delta-computation config (defaults to DEFAULT_DELTA_CONFIG). */
  deltaConfig?: DeltaConfig;
  /**
   * Show a progress reporter on stderr.
   * TTY: live single-line updates. Non-TTY: single-line final summary only.
   * Set to `false` to suppress all progress output (useful in tests).
   * Default: `true`.
   */
  showProgress?: boolean;
}

export async function extract(opts: ExtractOptions): Promise<Dataset> {
  const deltaConfig = opts.deltaConfig ?? DEFAULT_DELTA_CONFIG;
  const progress = createProgress(process.stderr);

  if (opts.showProgress !== false) progress.start("extracting");

  const rawCommits: RawCommit[] = walkGitLog({ repo: opts.repo, since: opts.since });
  if (opts.showProgress !== false) {
    progress.update(0, `parsed ${rawCommits.length} commits`);
  }

  const { files, commits } = computeDeltas(rawCommits, deltaConfig);
  if (opts.showProgress !== false) {
    progress.update(0, `${files.length} files · ${commits.length} commits`);
  }

  const { clusters, clusterOrder, diskRadius } = buildClusters(files);
  const clusterEdges: ClusterEdge[] = computeAffinity(files, commits, clusterOrder);

  if (opts.showProgress !== false) {
    progress.done(
      `[extract] ${files.length} files · ${clusters.length} clusters · ${commits.length} commits`,
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      repo: opts.repo,
      generatedAt: new Date().toISOString(),
      totalCommits: commits.length,
      firstCommit: new Date(commits[0]?.ts ?? 0).toISOString(),
      lastCommit: new Date(commits[commits.length - 1]?.ts ?? 0).toISOString(),
      diskRadius,
      config: {
        MAX_FILES_PER_COMMIT: deltaConfig.maxFilesPerCommit,
        MIN_FILE_TOTAL_TOUCHES: deltaConfig.minFileTotalTouches,
      },
    },
    clusters,
    clusterEdges,
    files,
    commits,
  };
}

// ────────────────────────────────────────────────────────────────
// Script entry — `tsx src/extract/index.ts` or `pnpm extract`
// ────────────────────────────────────────────────────────────────

const invokedAsScript =
  process.argv[1]?.endsWith("/extract/index.ts") === true ||
  process.argv[1]?.endsWith("/extract/index.js") === true;

if (invokedAsScript) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const REPO = process.env.REPO ?? resolve(ROOT, "../monorepo");
  const OUT = resolve(ROOT, "public/data.json");

  const dataset = await extract({ repo: REPO });
  mkdirSync(dirname(OUT), { recursive: true });
  const serialized = JSON.stringify(dataset);
  writeFileSync(OUT, serialized);
  console.log(`[extract] wrote ${OUT} (${(serialized.length / 1024).toFixed(1)} KB)`);
}
