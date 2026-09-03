// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Dataset cache for MCP server.
// Caches extracted dataset in `.git/holy-graph/cache-<head-sha>.json` so subsequent
// tool calls or MCP server restarts avoid re-parsing Git logs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import type { Dataset } from "../schema/v1.js";
import { SCHEMA_VERSION } from "../schema/version.mjs";
import { extract } from "../extract/index.js";
import type { DeltaConfig } from "../extract/deltas.js";

/** Get the current Git HEAD SHA of the repository. */
export function getHeadSha(repo: string): string | null {
  try {
    const stdout = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface CacheOptions {
  repo: string;
  deltaConfig?: DeltaConfig;
  forceRefresh?: boolean;
}

/**
 * Load dataset from cache if valid for the current HEAD commit,
 * or run extraction and update the cache.
 */
export async function getOrExtractDataset(opts: CacheOptions): Promise<Dataset> {
  const headSha = getHeadSha(opts.repo);
  const cacheDir = resolve(opts.repo, ".git", "holy-graph");
  const cacheFile = headSha ? resolve(cacheDir, `cache-${headSha}.json`) : null;

  if (!opts.forceRefresh && cacheFile && existsSync(cacheFile)) {
    try {
      const raw = readFileSync(cacheFile, "utf8");
      const data = JSON.parse(raw) as Dataset;
      if (data.schemaVersion === SCHEMA_VERSION) {
        return data;
      }
    } catch {
      // Fall through to extract if cache is corrupt
    }
  }

  // Extract without terminal progress interfering with stdio
  const dataset = await extract({
    repo: opts.repo,
    deltaConfig: opts.deltaConfig,
    showProgress: false,
  });

  if (cacheFile) {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(dataset));
    } catch {
      // Ignore cache write errors (e.g. read-only filesystem)
    }
  }

  return dataset;
}
