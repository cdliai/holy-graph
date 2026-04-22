// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Cluster-cluster co-change affinity.
// For every commit that touches files in more than one cluster, emit a weighted
// edge between each pair of clusters. Big commits contribute less per-pair (via
// log-scaled contribution) so they don't dominate the signal.

import type { ClusterEdge, Commit, FileMeta } from "../schema/v1.js";

/** Minimum weight for an edge to survive into the output. */
export const AFFINITY_THRESHOLD = 0.5;

export function computeAffinity(
  files: FileMeta[],
  commits: Commit[],
  clusterOrder: string[],
): ClusterEdge[] {
  const clusterIndex = new Map(clusterOrder.map((c, i): [string, number] => [c, i]));
  const fileCluster = new Map(files.map((f): [number, string] => [f.id, f.cluster]));
  const affKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const affinity = new Map<string, number>();

  for (const c of commits) {
    if (c.touches.length <= 1) continue;
    const ci = new Set<number>();
    for (const [fid] of c.touches) {
      const cid = fileCluster.get(fid);
      if (cid === undefined) continue;
      const idx = clusterIndex.get(cid);
      if (idx !== undefined) ci.add(idx);
    }
    if (ci.size <= 1) continue;
    const arr = Array.from(ci);
    // Per-pair contribution decays with number of clusters touched.
    const contribution = 1 / Math.log2(arr.length + 2);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = affKey(arr[i], arr[j]);
        affinity.set(k, (affinity.get(k) ?? 0) + contribution);
      }
    }
  }

  const edges: ClusterEdge[] = [];
  for (const [k, w] of affinity) {
    if (w < AFFINITY_THRESHOLD) continue;
    const [as, bs] = k.split("|");
    edges.push([Number(as), Number(bs), +w.toFixed(3)]);
  }
  edges.sort((a, b) => b[2] - a[2]);
  return edges;
}
