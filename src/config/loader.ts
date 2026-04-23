// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Discover and load a holy-graph.config.{js,mjs,ts} next to the target repo
// (or at an explicit path via --config). Returns a merged Config. Missing
// file = defaults only. Unknown top-level keys are a hard error.

import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { type Config, mergeConfig } from "./schema.js";

const KNOWN_FILENAMES = [
  "holy-graph.config.js",
  "holy-graph.config.mjs",
  "holy-graph.config.ts",
];

const KNOWN_KEYS = new Set<keyof Config>(["extract", "port", "since"]);

export interface LoadedConfig {
  extract: import("../extract/deltas.js").DeltaConfig;
  port: number;
  since: string | undefined;
  /** Absolute path of the config file that was loaded, or `null` if defaults. */
  sourcePath: string | null;
}

/**
 * Locate and load the config file.
 *
 * @param cwd    The directory to search (usually the target repo or process.cwd()).
 * @param explicit Path to a specific config file (from --config). If provided, this
 *                 file MUST exist. If not, we search KNOWN_FILENAMES under `cwd`.
 */
export async function loadConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  let sourcePath: string | null = null;

  if (explicit !== undefined) {
    sourcePath = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(sourcePath)) {
      throw new Error(`holy-graph: config file not found: ${sourcePath}`);
    }
  } else {
    for (const name of KNOWN_FILENAMES) {
      const candidate = resolve(cwd, name);
      if (existsSync(candidate)) {
        sourcePath = candidate;
        break;
      }
    }
  }

  if (sourcePath === null) {
    const merged = mergeConfig(undefined);
    return { ...merged, sourcePath: null };
  }

  let loaded: unknown;
  try {
    const mod = await import(pathToFileURL(sourcePath).href);
    loaded = (mod as { default?: unknown }).default ?? mod;
  } catch (err) {
    throw new Error(
      `holy-graph: failed to load ${sourcePath}: ${(err as Error).message}`,
    );
  }

  if (loaded !== null && typeof loaded === "object") {
    for (const key of Object.keys(loaded as object)) {
      if (!KNOWN_KEYS.has(key as keyof Config)) {
        throw new Error(
          `holy-graph: unknown config key "${key}" in ${sourcePath}. ` +
          `Known keys: ${[...KNOWN_KEYS].join(", ")}.`,
        );
      }
    }
  }

  const merged = mergeConfig(loaded as Config);
  return { ...merged, sourcePath };
}
