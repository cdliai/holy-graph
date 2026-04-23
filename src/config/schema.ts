// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// User-facing config shape. Extract the constants that belong in a config file
// (per spec §8.3) and expose them via a typed Config surface. `holy-graph.config.js`
// can export a partial Config; loader.ts merges it with defaults.

import { DEFAULT_DELTA_CONFIG, type DeltaConfig } from "../extract/deltas.js";

export interface Config {
  /** Overrides for extract pruning/filtering. Unknown keys are rejected. */
  extract?: Partial<DeltaConfig>;
  /** Dev-server port (CLI --port flag wins). */
  port?: number;
  /** Commit filter (CLI --since flag wins). */
  since?: string;
}

export const DEFAULT_CONFIG: Required<Pick<Config, "port">> & Config = {
  port: 5173,
};

/** Merge a user-supplied (partial) config with the defaults. */
export function mergeConfig(user: Config | undefined): {
  extract: DeltaConfig;
  port: number;
  since: string | undefined;
} {
  return {
    extract: { ...DEFAULT_DELTA_CONFIG, ...(user?.extract ?? {}) },
    port: user?.port ?? DEFAULT_CONFIG.port,
    since: user?.since,
  };
}
