// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// CLI command: holy-graph mcp [repo]
// Starts the Model Context Protocol stdio server to serve codebase intelligence to AI tools.

import type { LoadedConfig } from "../config/loader.js";
import { getOrExtractDataset } from "../mcp/cache.js";
import { McpServer } from "../mcp/server.js";

export interface McpOptions {
  repo: string;
  config: LoadedConfig;
}

export async function runMcp(opts: McpOptions): Promise<void> {
  // Announce on stderr only (stdout is reserved for JSON-RPC)
  process.stderr.write(
    `[holy-graph mcp] initializing codebase intelligence server for ${opts.repo}\n`,
  );

  let cachedDatasetPromise: ReturnType<typeof getOrExtractDataset> | null = null;
  const getDataset = () => {
    if (!cachedDatasetPromise) {
      cachedDatasetPromise = getOrExtractDataset({
        repo: opts.repo,
        deltaConfig: opts.config.extract,
      });
    }
    return cachedDatasetPromise;
  };

  // Pre-warm the cache asynchronously so first tool invocation is instantaneous
  getDataset().catch((err) => {
    process.stderr.write(`[holy-graph mcp] warning: background extraction failed: ${err}\n`);
  });

  const server = new McpServer(opts.repo, getDataset);
  server.start();

  // Keep process alive listening to stdin
  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
}
