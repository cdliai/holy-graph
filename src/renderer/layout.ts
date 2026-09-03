// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Layout calculation and easing utilities.

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceY,
} from "d3-force-3d";

import type { Cluster } from "../schema/v1.js";
import { CLUSTER_SIM_TICKS } from "./types.js";

// ── easing ──────────────────────────────────────────────────────
export function easeOutCubic(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ── cluster layout via d3-force ─────────────────────────────────
export function computeClusterLayout(
  clusters: Cluster[],
  edges: [number, number, number][],
  radius: number,
): Map<string, [number, number, number]> {
  // 2.5D: clusters live mostly on XZ plane with tiny Y offset.
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
    // Seed with a ring so the sim has a reasonable starting shape.
    const angle = (i / clusters.length) * Math.PI * 2;
    return {
      id: c.id,
      x: Math.cos(angle) * radius * 0.7,
      y: 0,
      z: Math.sin(angle) * radius * 0.7,
      size: c.size,
    };
  });

  const links = edges.map(([a, b, w]) => ({
    source: nodes[a],
    target: nodes[b],
    weight: w,
  }));

  const sim = forceSimulation<CNode>(nodes)
    .numDimensions(3)
    .alpha(1)
    .alphaDecay(0.02)
    .velocityDecay(0.4)
    .force(
      "charge",
      forceManyBody<CNode>()
        // Bigger clusters repel more so they don't overlap smaller neighbours.
        .strength((d: CNode) => -Math.max(60, Math.sqrt(d.size) * 30)),
    )
    .force("center", forceCenter<CNode>(0, 0, 0).strength(0.05))
    .force("y", forceY<CNode>(() => 0).strength(0.35)) // keep mostly flat
    .force(
      "link",
      forceLink<CNode, { source: CNode; target: CNode; weight: number }>(links)
        .id((d: CNode) => d.id)
        // Distance shrinks with weight: high-affinity clusters snuggle up.
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

  // Recenter so the *weighted* centroid (by cluster size) sits at the origin.
  let cx = 0,
    cz = 0,
    totalW = 0;
  for (const n of nodes) {
    const w = Math.max(1, n.size);
    cx += n.x * w;
    cz += n.z * w;
    totalW += w;
  }
  cx /= totalW;
  cz /= totalW;
  let maxR = 0;
  for (const n of nodes) {
    n.x -= cx;
    n.z -= cz;
    maxR = Math.max(maxR, Math.hypot(n.x, n.z));
  }
  const k = maxR > 0 ? radius / maxR : 1;

  const out = new Map<string, [number, number, number]>();
  for (const n of nodes) {
    out.set(n.id, [n.x * k, 0, n.z * k]);
  }
  return out;
}
