// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import type { ClusterEdge, Commit, FileMeta } from "../schema/v1.js";

/** Minimum weight for an inter-cluster co-change edge to survive pruning. */
export const AFFINITY_THRESHOLD = 0.5;

/**
 * Computes the empirical co-change affinity matrix between architectural clusters.
 *
 * ### Mathematical Formulation
 * For each commit $k \in \mathcal{C}$ that touches active cluster subset $\mathcal{S}_k \subseteq \{0, \dots, N-1\}$
 * where $|\mathcal{S}_k| \ge 2$, every unordered pair $(i, j) \in \mathcal{S}_k \times \mathcal{S}_k, i < j$
 * receives an incremental affinity weight scaled inversely by logarithmic cluster cardinality:
 *
 * $$\Delta w(i, j) = \frac{1}{\log_2(|\mathcal{S}_k| + 2)}$$
 *
 * Logarithmic dampening prevents large multi-cluster bulk commits (e.g. repo-wide renames,
 * dependency bumps) from dominating fine-grained organic developer workflows.
 *
 * ### Computational Complexity
 * - **Time Complexity**: $\mathcal{O}(C \cdot K^2 + N^2 + E \log E)$
 *   where $C = |\mathcal{C}|$ commits, $K = \max_k |\mathcal{S}_k|$ clusters touched per commit ($K \ll N$),
 *   $N = |\text{clusterOrder}|$, and $E \le \frac{N(N-1)}{2}$ surviving edges.
 * - **Auxiliary Space**: $\mathcal{O}(N^2 + F_{\max})$
 *   Matrix memory footprint is exactly $8N^2$ bytes (`Float64Array`).
 *   For $N \le 128$ clusters, the dense matrix consumes $\le 131 \text{ KB}$, fitting entirely
 *   within modern L2 CPU cache hierarchies.
 *
 * ### Zero-Allocation Invariants
 * - Inner commit loop allocates zero heap objects: no strings, no Map instances, no JS array slices.
 * - `fileToCluster` maps `fileId` $\to$ `clusterIndex` in direct $\mathcal{O}(1)$ array indexing.
 * - Active cluster deduplication is performed via a contiguous `Uint8Array` bitset with localized reset.
 *
 * @param files Processed file metadata containing monotonically assigned file IDs and assigned clusters.
 * @param commits Ordered sequence of commits with touch tuples `[fileId, added, removed]`.
 * @param clusterOrder Canonical cluster registry index.
 * @returns Sorted array of inter-cluster edges `[clusterA, clusterB, weight]` in descending weight order.
 */
export function computeAffinity(
  files: FileMeta[],
  commits: Commit[],
  clusterOrder: string[],
): ClusterEdge[] {
  const N = clusterOrder.length;
  if (N <= 1 || commits.length === 0) return [];

  const clusterIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) clusterIndex.set(clusterOrder[i], i);

  // Direct O(1) L1 array lookup: fileId -> clusterIndex
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
