// Schema version 1 — the first stable data.json contract.
// Spec §9: any breaking change bumps this integer; renderer supports
// current + previous major.

export const SCHEMA_VERSION = 1 as const;

export interface Cluster {
  id: string;
  label: string;
  color: string;
  size: number;
  /** XZ-plane anchor position [x, z]; Y is computed by the renderer. */
  position: [number, number];
}

export interface FileMeta {
  id: number;
  path: string;
  cluster: string;
  firstCommitIdx: number;
  totalTouches: number;
  aliases?: string[];
}

export interface Commit {
  sha: string;
  short: string;
  ts: number;       // ms epoch
  date: string;     // YYYY-MM-DD
  author: string;
  msg: string;
  /** [fileId, linesAdded, linesRemoved] — unique per commit. */
  touches: Array<[number, number, number]>;
}

/** Weighted co-change edge between two clusters (indices into Dataset.clusters). */
export type ClusterEdge = [number, number, number];

export interface Dataset {
  /** Schema version — renderer must check this before interpreting the rest. */
  schemaVersion: typeof SCHEMA_VERSION;
  meta: {
    repo: string;
    generatedAt: string;
    totalCommits: number;
    firstCommit: string;
    lastCommit: string;
    diskRadius: number;
    config: Record<string, number>;
  };
  clusters: Cluster[];
  clusterEdges: ClusterEdge[];
  files: FileMeta[];
  commits: Commit[];
}
