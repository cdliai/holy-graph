// Running state of the codebase graph: per-file activity EMA, per-edge
// co-change weight EMA, with time-based decay.
//
// Client replays commits forward. Scrubbing backward resets and replays 0→N.
// Replay is pure arithmetic — no rendering, no sim — so ~4000 commits apply in
// a few milliseconds.

import type { Dataset } from "./schema";

// Time-based decay half-lives, expressed in days.
// Activity of an untouched file halves roughly every HALF_LIFE_ACT_DAYS.
export const HALF_LIFE_ACT_DAYS = 14;
// Co-change edge weight halves roughly every HALF_LIFE_EDGE_DAYS.
export const HALF_LIFE_EDGE_DAYS = 30;

// Thresholds under which we drop entries (they vanish from the graph).
export const ACTIVITY_THRESHOLD = 0.12;
export const EDGE_THRESHOLD = 0.18;

// Caps so we never hand the renderer an infinitely-large graph.
export const MAX_LIVE_NODES = 500;
export const MAX_LIVE_EDGES = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Event emitted to the renderer when a commit is applied forward. */
export interface CommitEvent {
  commitIdx: number;
  /** File ids born in this commit (first-ever appearance). */
  born: number[];
  /** File ids touched (already alive) in this commit. */
  touched: number[];
  /** The per-file commit magnitudes, for pulse strength. */
  magnitude: Map<number, number>;
}

export class Replay {
  /** Per-file EMA activity. */
  readonly activity: Map<number, number> = new Map();
  /** Per-edge EMA weight, key = `${minId}|${maxId}`. */
  readonly edges: Map<string, number> = new Map();
  /** File id -> has it ever been born? (for the "new birth" flag). */
  readonly bornEver: Set<number> = new Set();
  /** Which commit index we're currently AT (exclusive of unapplied). */
  cursor = 0;

  constructor(private readonly data: Dataset) {}

  /** Reset state to before any commit has been applied. */
  reset(): void {
    this.activity.clear();
    this.edges.clear();
    this.bornEver.clear();
    this.cursor = 0;
  }

  /**
   * Apply the next commit. Returns metadata about what changed so the renderer
   * can trigger birth/touch animations precisely.
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

    // Co-change: every pair in this commit gets +1 weight
    for (let i = 0; i < touchedIds.length; i++) {
      for (let j = i + 1; j < touchedIds.length; j++) {
        const a = touchedIds[i];
        const b = touchedIds[j];
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        this.edges.set(k, (this.edges.get(k) ?? 0) + 1);
      }
    }

    this.cursor++;
    return { commitIdx: this.cursor - 1, born, touched, magnitude };
  }

  /** Seek forward or backward to the given commit index (exclusive). */
  seek(target: number): void {
    target = Math.max(0, Math.min(target, this.data.commits.length));
    if (target < this.cursor) {
      this.reset();
    }
    while (this.cursor < target) this.step();
  }

  /**
   * Derive the currently-live node + edge sets from the running state.
   * Capped by MAX_LIVE_NODES / MAX_LIVE_EDGES (top-K by weight).
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
      const [as, bs] = k.split("|");
      const a = Number(as);
      const b = Number(bs);
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
