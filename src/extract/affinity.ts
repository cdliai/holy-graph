// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Cluster-cluster co-change affinity.
// Optimized low-level implementation:
//   - Zero string allocations: uses a contiguous Float64Array symmetric matrix in L2 cache.
//   - O(1) L1 array lookup: fileToCluster[fileId] replaces 2-hop Map lookups.
//   - Bitset active-set tracking avoids dynamic Set<number> allocations.

import type { ClusterEdge, Commit, FileMeta } from "../schema/v1.js";

/** Minimum weight for an edge to survive into the output. */
export const AFFINITY_THRESHOLD = 0.5;

export function computeAffinity(
  files: FileMeta[],
  commits: Commit[],
  clusterOrder: string[],
): ClusterEdge[] {
  const N = clusterOrder.length;
  if (N <= 1 || commits.length === 0) return [];

  const clusterIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) clusterIndex.set(clusterOrder[i], i);

  // Direct O(1) array lookup: fileId -> clusterIndex
  let maxFileId = 0;
  for (let i = 0; i < files.length; i++) {
    if (files[i].id > maxFileId) maxFileId = files[i].id;
  }
  const fileToCluster = new Int32Array(maxFileId + 1).fill(-1);
  for (let i = 0; i < files.length; i++) {
    const cIdx = clusterIndex.get(files[i].cluster);
    if (cIdx !== undefined) fileToCluster[files[i].id] = cIdx;
  }

  // Symmetric dense matrix in L2 cache: zero string allocations
  const matrix = new Float64Array(N * N);
  const clusterBitset = new Uint8Array(N);
  const activeClusters = new Int32Array(N);

  for (let ci = 0; ci < commits.length; ci++) {
    const touches = commits[ci].touches;
    if (touches.length <= 1) continue;

    let activeCount = 0;
    for (let i = 0; i < touches.length; i++) {
      const fid = touches[i][0];
      if (fid < fileToCluster.length) {
        const cIdx = fileToCluster[fid];
        if (cIdx >= 0 && clusterBitset[cIdx] === 0) {
          clusterBitset[cIdx] = 1;
          activeClusters[activeCount++] = cIdx;
        }
      }
    }

    if (activeCount > 1) {
      const contribution = 1 / Math.log2(activeCount + 2);
      for (let i = 0; i < activeCount; i++) {
        const a = activeClusters[i];
        const row = a * N;
        for (let j = i + 1; j < activeCount; j++) {
          const b = activeClusters[j];
          matrix[row + b] += contribution;
          matrix[b * N + a] += contribution;
        }
      }
    }

    // Reset bitset for touched clusters
    for (let i = 0; i < activeCount; i++) {
      clusterBitset[activeClusters[i]] = 0;
    }
  }

  const edges: ClusterEdge[] = [];
  for (let i = 0; i < N; i++) {
    const row = i * N;
    for (let j = i + 1; j < N; j++) {
      const w = matrix[row + j];
      if (w >= AFFINITY_THRESHOLD) {
        edges.push([i, j, Math.round(w * 1000) / 1000]);
      }
    }
  }

  edges.sort((a, b) => b[2] - a[2]);
  return edges;
}
