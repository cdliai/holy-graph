// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceY,
} from "d3-force-3d";

import type { Cluster } from "../schema/v1.js";
import { CLUSTER_SIM_TICKS } from "./types.js";

/**
 * Standard cubic ease-out transfer function.
 *
 * $$f(t) = 1 - (1 - t)^3, \quad t \in [0, 1]$$
 *
 * @complexity $\mathcal{O}(1)$ time.
 */
export function easeOutCubic(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k;
}

/**
 * Standard quadratic ease-out transfer function.
 *
 * $$f(t) = 1 - (1 - t)^2, \quad t \in [0, 1]$$
 *
 * @complexity $\mathcal{O}(1)$ time.
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Embeds architectural clusters into a 2.5D manifold via physical force simulation.
 *
 * ### Dynamical System Formulation
 * Simulates an $N$-body particle system constrained primarily to the $XZ$ orbital plane:
 *
 * 1. **Size-Scaled Electrostatic Repulsion ($N$-body)**:
 *    $$F_{\text{repel}}(u) = -\max\left(60, 30\sqrt{\text{size}(u)}\right)$$
 *    Larger clusters maintain proportional spatial clearing to prevent node occlusion.
 *
 * 2. **Affinity-Weighted Hookean Springs**:
 *    Target rest distance contracts logarithmically with inter-cluster affinity weight $w$:
 *    $$d(u, v) = \max\left(28, \frac{180}{\log_2(w + 4)}\right)$$
 *    Spring stiffness scales with affinity:
 *    $$k(u, v) = \min\left(0.9, 0.2 + 0.12\log_2(w + 1)\right)$$
 *
 * 3. **Orthogonal Restoring Force**:
 *    A strong restoring force $F_y = -0.35 \cdot y$ confines the simulation to a flat disk plane.
 *
 * 4. **Centroid Alignment & Bounding**:
 *    Post-simulation coordinates are translated by their size-weighted center of mass:
 *    $$\mathbf{C} = \frac{\sum_i m_i \mathbf{x}_i}{\sum_i m_i}$$
 *    and radially clamped within radius $R$.
 *
 * ### Computational Complexity
 * - **Time Complexity**: $\mathcal{O}(K \cdot (N \log N + E))$
 *   where $K = 220$ simulation ticks, using Barnes-Hut octree spatial partitioning.
 * - **Auxiliary Space**: $\mathcal{O}(N + E)$ for force graph topology.
 *
 * @param clusters Module clusters to layout.
 * @param edges Inter-cluster affinity pairs `[sourceIdx, targetIdx, weight]`.
 * @param radius Maximum radial boundary of the ground disk.
 * @returns Map of cluster ID to 3D centroid coordinates $[x, y, z]$.
 */
export function computeClusterLayout(
  clusters: Cluster[],
  edges: [number, number, number][],
  radius: number,
): Map<string, [number, number, number]> {
  interface CNode {
    id: string;
    x: number;
    y: number;
    z: number;
    vx?: number;
    vy?: number;
    vz?: number;
    size: number;
  }

  const nodes: CNode[] = clusters.map((c, i) => {
    // Seed on circular ring to establish initial radial parity
    const angle = (i / clusters.length) * Math.PI * 2;
    return {
      id: c.id,
      x: Math.cos(angle) * radius * 0.7,
      y: 0,
      z: Math.sin(angle) * radius * 0.7,
      vx: 0,
      vy: 0,
      vz: 0,
      size: c.size,
    };
  });

  const links = edges.map(([a, b, w]) => ({
    source: nodes[a],
    target: nodes[b],
    weight: w,
  }));

  const sim = forceSimulation<CNode>()
    .numDimensions(3)
    .nodes(nodes)
    .alpha(1)
    .alphaDecay(0.02)
    .velocityDecay(0.4)
    .force(
      "charge",
      forceManyBody<CNode>()
        .strength((d: CNode) => -Math.max(60, Math.sqrt(d.size) * 30)),
    )
    .force("center", forceCenter<CNode>(0, 0, 0).strength(0.05))
    .force("y", forceY<CNode>(() => 0).strength(0.35))
    .force(
      "link",
      forceLink<CNode, { source: CNode; target: CNode; weight: number }>(links)
        .id((d: CNode) => d.id)
        .distance((l) => Math.max(28, 180 / Math.log2(l.weight + 4)))
        .strength((l) => Math.min(0.9, 0.2 + Math.log2(l.weight + 1) * 0.12)),
    )
    .stop();

  for (let i = 0; i < CLUSTER_SIM_TICKS; i++) sim.tick(1);

  // Fix any NaN fallouts (can happen when isolated nodes collide)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) {
      const angle = (i / nodes.length) * Math.PI * 2;
      n.x = Math.cos(angle) * radius * 0.9;
      n.z = Math.sin(angle) * radius * 0.9;
      n.y = 0;
    }
    if (!Number.isFinite(n.y)) n.y = 0;
  }

  // Translate size-weighted center of mass to origin (0, 0, 0)
  let sumX = 0;
  let sumZ = 0;
  let sumW = 0;
  for (const n of nodes) {
    const w = Math.sqrt(n.size);
    sumX += n.x * w;
    sumZ += n.z * w;
    sumW += w;
  }
  const cx = sumW > 0 ? sumX / sumW : 0;
  const cz = sumW > 0 ? sumZ / sumW : 0;
  for (const n of nodes) {
    n.x -= cx;
    n.z -= cz;
  }

  // Radial clamping to maximum disk boundary
  let maxDist = 0;
  for (const n of nodes) {
    const d = Math.hypot(n.x, n.z);
    if (d > maxDist) maxDist = d;
  }
  const maxAllowed = radius * 0.82;
  const scale = maxDist > maxAllowed ? maxAllowed / maxDist : 1;

  const out = new Map<string, [number, number, number]>();
  for (const n of nodes) {
    out.set(n.id, [n.x * scale, n.y * 0.1, n.z * scale]);
  }
  return out;
}

/**
 * Places nodes within a cluster into dual concentric rings.
 *
 * ### Geometric Invariant
 * Partitions $N$ files into:
 * - **Inner Ring**: $N_{\text{inner}} = \max(1, \lfloor 0.35 \cdot N \rfloor)$ files at $R_{\text{inner}} = 0.48 \cdot R$.
 * - **Outer Ring**: $N_{\text{outer}} = N - N_{\text{inner}}$ files at $R_{\text{outer}} = R$.
 *
 * @complexity $\mathcal{O}(N)$ time, $\mathcal{O}(N)$ space.
 */
export function layoutConcentricRings(
  nodeIds: number[],
  center: [number, number, number],
  radius: number,
): Map<number, [number, number, number]> {
  const out = new Map<number, [number, number, number]>();
  const total = nodeIds.length;
  if (total === 0) return out;
  if (total === 1) {
    out.set(nodeIds[0], [center[0], center[1], center[2]]);
    return out;
  }

  const innerCount = Math.max(1, Math.floor(total * 0.35));
  const outerCount = total - innerCount;
  const rInner = radius * 0.48;
  const rOuter = radius;

  for (let i = 0; i < innerCount; i++) {
    const angle = (i / innerCount) * Math.PI * 2;
    out.set(nodeIds[i], [
      center[0] + Math.cos(angle) * rInner,
      center[1],
      center[2] + Math.sin(angle) * rInner,
    ]);
  }
  for (let i = 0; i < outerCount; i++) {
    const angle = (i / outerCount) * Math.PI * 2 + 0.3;
    out.set(nodeIds[innerCount + i], [
      center[0] + Math.cos(angle) * rOuter,
      center[1],
      center[2] + Math.sin(angle) * rOuter,
    ]);
  }
  return out;
}
