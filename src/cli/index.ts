// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// CLI entry point. Binary name: holy-graph.

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../config/loader.js";
import { CliError, errors } from "./errors.js";
import { runServe } from "./serve.js";
import { runExport } from "./export.js";

const USAGE = `holy-graph — 3D visualization of codebase evolution

USAGE
  holy-graph [path]                  Serve the visualization for the given repo
                                     (default: current working directory)
  holy-graph [path] --out <file>     Export a single-file HTML

OPTIONS
  --out <file>       Export mode: write single-file HTML to <file>
  --force            Overwrite --out if it exists
  --port <n>         Dev server port (default: 5173, with fallback)
  --since <date>     Only include commits since <date> (e.g. 2024-01-01)
  --config <path>    Path to holy-graph.config.{js,mjs,ts}
  --version          Print version and exit
  --help             Show this message

EXAMPLES
  npx @cdli/holy-graph                         # analyze current repo
  npx @cdli/holy-graph ~/code/react            # analyze another repo
  npx @cdli/holy-graph --out viz.html          # export to shareable HTML
  npx @cdli/holy-graph --port 3000             # use port 3000
  npx @cdli/holy-graph --since 2024-01-01      # recent commits only`;

// Hardcoded during build; bumped alongside package.json.
const VERSION = "1.0.0-rc.1";

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: "string" },
        force: { type: "boolean", default: false },
        port: { type: "string" },
        since: { type: "string" },
        config: { type: "string" },
        version: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (err) {
    throw errors.invalidArgs((err as Error).message);
  }

  if (parsed.values.help === true) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (parsed.values.version === true) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  const repoArg = parsed.positionals[0] ?? process.cwd();
  const repo = resolve(repoArg);
  if (!existsSync(resolve(repo, ".git"))) {
    throw errors.noGitDir(repo);
  }

  const config = await loadConfig(repo, parsed.values.config);

  const port = parsePort(parsed.values.port, config.port);

  // CLI --since flag overrides config.since; absent flag falls back to config.
  const since = parsed.values.since ?? config.since;

  if (typeof parsed.values.out === "string" && parsed.values.out.length > 0) {
    // Export mode
    const outPath = resolve(parsed.values.out);
    const { bytes } = await runExport({
      repo,
      outPath,
      force: parsed.values.force === true,
      since,
      config,
    });
    process.stdout.write(
      `[holy-graph] wrote ${outPath} (${(bytes / 1024).toFixed(1)} KB)\n`,
    );
    return 0;
  }

  // Serve mode
  const { url, close } = await runServe({
    repo,
    port,
    since,
    config,
  });
  process.stdout.write(`[holy-graph] serving at ${url}\n`);
  process.stdout.write(`[holy-graph] press ctrl+c to stop\n`);

  // Keep running until SIGINT.
  await new Promise<void>((settle) => {
    const shutdown = async (): Promise<void> => {
      process.stdout.write(`\n[holy-graph] shutting down…\n`);
      await close();
      settle();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  return 0;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw errors.invalidArgs(`--port must be an integer between 1 and 65535 (got ${raw}).`);
  }
  return n;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof CliError) {
      process.stderr.write(err.message + "\n");
      process.exit(1);
    }
    // Unexpected — surface with stack so we can debug.
    process.stderr.write(`holy-graph: unexpected error:\n${(err as Error).stack ?? String(err)}\n`);
    process.exit(2);
  },
);
