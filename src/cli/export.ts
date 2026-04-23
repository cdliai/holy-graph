// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Export command: extract the target repo, bundle the renderer + data into a
// single-file HTML at `--out`.

import { extract } from "../extract/index.js";
import { exportHtml } from "../export/bundle.js";
import type { LoadedConfig } from "../config/loader.js";

export interface RunExportOptions {
  repo: string;
  outPath: string;
  force: boolean;
  since?: string;
  config: LoadedConfig;
  rendererHtmlPath?: string;
}

export async function runExport(opts: RunExportOptions): Promise<{ bytes: number }> {
  const dataset = await extract({
    repo: opts.repo,
    since: opts.since,
    deltaConfig: opts.config.extract,
  });
  return exportHtml(dataset, {
    outPath: opts.outPath,
    force: opts.force,
    rendererHtmlPath: opts.rendererHtmlPath,
  });
}
