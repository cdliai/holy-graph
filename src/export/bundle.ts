// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Single-file HTML export.
// Reads the Vite-built single-file renderer at dist/index.html, injects the
// Dataset as inline JSON, and writes the resulting HTML to `outPath`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Dataset } from "../schema/v1.js";
import { injectDataIntoHtml } from "./template.js";
import { errors } from "../cli/errors.js";

export interface ExportOptions {
  /** Absolute path to write the single-file HTML to. */
  outPath: string;
  /** Overwrite if outPath already exists. */
  force?: boolean;
  /** Override the source HTML (default: dist/index.html relative to CLI). */
  rendererHtmlPath?: string;
}

export function exportHtml(data: Dataset, opts: ExportOptions): { bytes: number } {
  const rendererHtmlPath = opts.rendererHtmlPath ?? resolveDefaultRendererHtml();
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

/**
 * Resolve the default path to the built renderer HTML. The CLI is executed as
 * `dist/cli/index.js`; the renderer sits at `dist/index.html` (two levels up
 * from the CLI entry at runtime).
 */
function resolveDefaultRendererHtml(): string {
  // Both dist/cli/index.js and dist/index.html are siblings-of-parent.
  // When the CLI runs, import.meta.url points to dist/cli/index.js.
  // Use process.argv[1] as a stable anchor.
  const cliEntry = process.argv[1] ?? "";
  // dist/cli/index.js → dist/index.html
  return resolve(cliEntry, "..", "..", "index.html");
}
