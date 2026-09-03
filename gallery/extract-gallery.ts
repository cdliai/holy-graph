// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Extract datasets for the holygraph.cdli.ai public gallery.
// Usage: tsx gallery/extract-gallery.ts [repo-path] [target-name]

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { extract } from "../src/extract/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const repoPath = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, "..");
  const targetName = process.argv[3] ?? "holy-graph";

  console.log(`[gallery-extract] Analyzing ${repoPath} for gallery target "${targetName}"...`);

  const dataset = await extract({
    repo: repoPath,
    showProgress: true,
  });

  const outDir = resolve(__dirname, "repos", targetName);
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "data.json");

  const json = JSON.stringify(dataset);
  writeFileSync(outFile, json);

  console.log(
    `[gallery-extract] Wrote ${outFile} (${(Buffer.byteLength(json, "utf8") / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error(`[gallery-extract] Error:`, err);
  process.exit(1);
});
