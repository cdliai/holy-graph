// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Single-file HTML export.
// Reads the Vite-built single-file renderer at dist/index.html, injects the
// Dataset as inline JSON, and writes the resulting HTML to `outPath`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { Dataset } from "../schema/v1.js";
import { injectDataIntoHtml } from "./template.js";
import { errors } from "../cli/errors.js";
import { defaultRendererHtml } from "../cli/renderer-path.js";

export interface ExportOptions {
  /** Absolute path to write the single-file HTML to. */
  outPath: string;
  /** Overwrite if outPath already exists. */
  force?: boolean;
  /** Override the source HTML (default: dist/index.html relative to CLI). */
  rendererHtmlPath?: string;
}

export function exportHtml(data: Dataset, opts: ExportOptions): { bytes: number } {
  const rendererHtmlPath = opts.rendererHtmlPath ?? defaultRendererHtml();
  if (!existsSync(rendererHtmlPath)) {
    throw errors.rendererMissing(rendererHtmlPath);
  }

  if (existsSync(opts.outPath) && !opts.force) {
    throw errors.exportExists(opts.outPath);
  }

  const html = readFileSync(rendererHtmlPath, "utf8");
  const final = injectDataIntoHtml(html, data);
  writeFileSync(opts.outPath, final);
  return { bytes: Buffer.byteLength(final, "utf8") };
}

