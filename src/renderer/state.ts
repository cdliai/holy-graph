// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import type { Dataset } from "../schema";

/** Half-life $t_{1/2}$ for file activity decay in solar days ($14\text{ days}$). */
export const HALF_LIFE_ACT_DAYS = 14;

/** Half-life $t_{1/2}$ for co-change edge weight decay in solar days ($30\text{ days}$). */
export const HALF_LIFE_EDGE_DAYS = 30;

/** Absolute lower-bound cutoff under which inactive nodes are purged from the live graph. */
export const ACTIVITY_THRESHOLD = 0.12;

/** Absolute lower-bound cutoff under which decaying edges are pruned. */
export const EDGE_THRESHOLD = 0.18;

/** Maximum upper bound of concurrent rendered nodes to guarantee 60 FPS GPU draw calls. */
export const MAX_LIVE_NODES = 500;

/** Maximum upper bound of concurrent rendered co-change edges. */
export const MAX_LIVE_EDGES = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Event emitted to the renderer when a commit is applied forward. */
export interface CommitEvent {
  commitIdx: number;
  /** File IDs born in this commit (first-ever appearance in Git history). */
  born: number[];
  /** File IDs touched (already existing in repository) in this commit. */
  touched: number[];
  /** Per-file commit touch magnitudes for visual pulse intensity. */
  magnitude: Map<number, number>;
}

/**
 * Packs two 16-bit unsigned integer node IDs into a canonical 32-bit unsigned integer key.
 *
 * $$\text{Key}(a, b) = (\min(a, b) \ll 16) \mid \max(a, b)$$
 *
 * @complexity $\mathcal{O}(1)$ time, zero heap memory allocation.
 */
export function packEdgeKey(a: number, b: number): number {
  return a < b ? (a << 16) | b : (b << 16) | a;
}

/**
 * Decodes a 32-bit packed integer key into its constituent $[a, b]$ file ID pair.
 *
 * $$a = K \ggg 16, \quad b = K \ \& \ \text{0xFFFF}$$
 *
 * @complexity $\mathcal{O}(1)$ time, zero string parsing.
 */
export function unpackEdgeKey(k: number): [number, number] {
  return [(k >>> 16) & 0xffff, k & 0xffff];
}

/**
 * Stateful arithmetic replay engine tracking temporal file activity and edge coupling.
 *
 * ### Physical Model & Decay Dynamics
 * Between consecutive commits $c_{k-1}$ and $c_k$ separated by $\Delta t$ days,
 * activity and edge weights undergo continuous exponential decay:
 *
 * $$v(t + \Delta t) = v(t) \cdot 2^{-\frac{\Delta t}{t_{1/2}}}$$
 *
 * Files touched within commit $c_k$ receive an instantaneous energy impulse scaled
 * logarithmically by code churn:
 *
 * $$M = 1 + \ln(1 + \Delta_{\text{added}} + \Delta_{\text{removed}})$$
 *
 * Every unordered pair $(u, v)$ co-modified within the commit increments their
 * pairwise temporal coupling edge by $+1$.
 */
export class Replay {
  /** Per-file Exponential Moving Average (EMA) activity. */
  readonly activity: Map<number, number> = new Map();
  /** Per-edge EMA weight indexed by packed 32-bit integer key $(u \ll 16) \mid v$. */
  readonly edges: Map<number, number> = new Map();
  /** Monotonic bitset tracking whether a file has ever been instantiated. */
  readonly bornEver: Set<number> = new Set();
  /** Head commit index cursor $[0, |\text{commits}|]$. */
  cursor = 0;

  constructor(private readonly data: Dataset) {}

  /** Resets state vector to prior to commit 0. $\mathcal{O}(1)$ amortized. */
  reset(): void {
    this.activity.clear();
    this.edges.clear();
    this.bornEver.clear();
    this.cursor = 0;
  }

  /**
   * Advances simulation forward by exactly one commit.
   *
   * ### Computational Complexity
   * - **Time Complexity**: $\mathcal{O}(N_{\text{live}} + E_{\text{live}} + T^2)$
   *   where $T = |\text{touches}|$ in the current commit, $N_{\text{live}} \le 500$, and $E_{\text{live}} \le 1000$.
   * - **Auxiliary Space**: $\mathcal{O}(T)$ allocations for returned event descriptor.
   *
   * @returns Event metadata for GPU particle/ring spawning, or `null` if EOF reached.
   */
  step(): CommitEvent | null {
    if (this.cursor >= this.data.commits.length) return null;
    const commit = this.data.commits[this.cursor];
    const prev = this.cursor > 0 ? this.data.commits[this.cursor - 1] : commit;
    const dtDays = Math.max(0, (commit.ts - prev.ts) / DAY_MS);

    // Time-based decay: v' = v * 2^(-dt / halfLife)
    if (dtDays > 0) {
      const actFactor = Math.pow(2, -dtDays / HALF_LIFE_ACT_DAYS);
      const edgeFactor = Math.pow(2, -dtDays / HALF_LIFE_EDGE_DAYS);
      for (const [k, v] of this.activity) {
        const nv = v * actFactor;
        if (nv < 0.01) this.activity.delete(k);
        else this.activity.set(k, nv);
      }
      for (const [k, v] of this.edges) {
        const nv = v * edgeFactor;
        if (nv < 0.05) this.edges.delete(k);
        else this.edges.set(k, nv);
      }
    }

    // Apply touches + compute event
    const born: number[] = [];
    const touched: number[] = [];
    const magnitude = new Map<number, number>();
    const touchedIds: number[] = [];

    for (const [id, added, removed] of commit.touches) {
      const isBirth = !this.bornEver.has(id);
      if (isBirth) {
        this.bornEver.add(id);
        born.push(id);
      } else {
        touched.push(id);
      }
      const mag = 1 + Math.log1p(added + removed);
      magnitude.set(id, mag);
      this.activity.set(id, (this.activity.get(id) ?? 0) + mag);
      touchedIds.push(id);
    }

    // Co-change: packed 32-bit integer key (minId << 16) | maxId (zero string allocations)
    for (let i = 0; i < touchedIds.length; i++) {
      for (let j = i + 1; j < touchedIds.length; j++) {
        const a = touchedIds[i];
        const b = touchedIds[j];
        const k = packEdgeKey(a, b);
        this.edges.set(k, (this.edges.get(k) ?? 0) + 1);
      }
    }

    this.cursor++;
    return { commitIdx: this.cursor - 1, born, touched, magnitude };
  }

  /**
   * Seeks timeline head to `target` commit index.
   *
   * @complexity $\mathcal{O}(\Delta \cdot \text{step})$ forward seek; $\mathcal{O}(\text{target} \cdot \text{step})$ backward seek.
   */
  seek(target: number): void {
    target = Math.max(0, Math.min(target, this.data.commits.length));
    if (target < this.cursor) {
      this.reset();
    }
    while (this.cursor < target) this.step();
  }

  /**
   * Derives active top-$K$ nodes and edges bounded by GPU rendering capacity.
   *
   * ### Computational Complexity
   * - **Time Complexity**: $\mathcal{O}(|A| \log |A| + |E| \log |E|)$ where $|A| = |\text{activity}|$ and $|E| = |\text{edges}|$.
   * - **Auxiliary Space**: $\mathcal{O}(K_N + K_E)$ where $K_N = 500$ and $K_E = 1000$.
   */
  liveSnapshot(): {
    nodes: Array<{ id: number; activity: number }>;
    edges: Array<{ a: number; b: number; weight: number }>;
  } {
    let nodes: Array<{ id: number; activity: number }> = [];
    for (const [id, act] of this.activity) {
      if (act >= ACTIVITY_THRESHOLD) nodes.push({ id, activity: act });
    }
    if (nodes.length > MAX_LIVE_NODES) {
      nodes.sort((a, b) => b.activity - a.activity);
      nodes = nodes.slice(0, MAX_LIVE_NODES);
    }
    const live = new Set(nodes.map((n) => n.id));

    let edges: Array<{ a: number; b: number; weight: number }> = [];
    for (const [k, w] of this.edges) {
      if (w < EDGE_THRESHOLD) continue;
      const a = (k >>> 16) & 0xffff;
      const b = k & 0xffff;
      if (!live.has(a) || !live.has(b)) continue;
      edges.push({ a, b, weight: w });
    }
    if (edges.length > MAX_LIVE_EDGES) {
      edges.sort((x, y) => y.weight - x.weight);
      edges = edges.slice(0, MAX_LIVE_EDGES);
    }

    return { nodes, edges };
  }
}