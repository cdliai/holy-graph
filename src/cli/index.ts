// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// CLI entry point. Binary name: holy-graph.

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { loadConfig } from "../config/loader.js";
import { CliError, errors } from "./errors.js";
import { runServe } from "./serve.js";
import { runExport } from "./export.js";
import { runMcp } from "./mcp.js";

const USAGE = `hgraph / holy-graph — 3D visualization and intelligence for codebase evolution

USAGE
  hgraph [path]                      Serve visualization for current or target repo
  hgraph run [path]                  Alias for serve mode
  hgraph [path] --out <file>         Export a single-file self-contained HTML
  hgraph mcp [path]                  Start Model Context Protocol (MCP) server
                                     for AI coding tools (Cursor, Claude, etc.)

OPTIONS
  --run              Explicitly run the dev server (default behavior)
  --out <file>       Export mode: write single-file HTML to <file>
  --force            Overwrite --out if it exists
  --port <n>         Dev server port (default: 5173, with fallback)
  --no-open          Do not automatically launch the browser
  --since <date>     Only include commits since <date> (e.g. 2024-01-01)
  --config <path>    Path to holy-graph.config.{js,mjs,ts}
  --version          Print version and exit
  --help             Show this message

EXAMPLES
  hgraph                                       # analyze current repo & open browser
  hgraph ~/code/react                          # analyze another repo
  hgraph --out viz.html                        # export to shareable HTML
  hgraph mcp                                   # start MCP server for AI tools`;

// Hardcoded during build; bumped alongside package.json.
const VERSION = "1.1.0";

/** Find top-level Git root directory, allowing invocation inside subdirectories. */
export function findGitRoot(startDir: string): string | null {
  const directGit = resolve(startDir, ".git");
  if (existsSync(directGit)) return resolve(startDir);

  try {
    const stdout = execFileSync("git", ["-C", startDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = stdout.trim();
    return root && existsSync(resolve(root, ".git")) ? root : null;
  } catch {
    return null;
  }
}

/** Check if the repository is a shallow clone. */
export function isShallowClone(repo: string): boolean {
  try {
    const stdout = execFileSync("git", ["-C", repo, "rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        run: { type: "boolean", default: false },
        out: { type: "string" },
        force: { type: "boolean", default: false },
        port: { type: "string" },
        "no-open": { type: "boolean", default: false },
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

  // MCP Mode dispatch: `holy-graph mcp [repo]` or `hgraph mcp [repo]`
  if (parsed.positionals[0] === "mcp") {
    const repoArg = parsed.positionals[1] ?? process.cwd();
    const repo = findGitRoot(repoArg);
    if (!repo) {
      throw errors.noGitDir(resolve(repoArg));
    }
    const config = await loadConfig(repo, parsed.values.config);
    await runMcp({ repo, config });
    return 0;
  }

  // Handle explicit "run" or "serve" positional subcommand: `hgraph run [path]`
  let repoArg: string;
  if (parsed.positionals[0] === "run" || parsed.positionals[0] === "serve") {
    repoArg = parsed.positionals[1] ?? process.cwd();
  } else {
    repoArg = parsed.positionals[0] ?? process.cwd();
  }
  const repo = findGitRoot(repoArg);
  if (!repo) {
    throw errors.noGitDir(resolve(repoArg));
  }

  if (isShallowClone(repo)) {
    process.stderr.write(
      "[holy-graph] ⚠ shallow clone detected; Git history is truncated. For full history replay, run 'git fetch --unshallow'.\n",
    );
  }

  const config = await loadConfig(repo, parsed.values.config);
  const port = parsePort(parsed.values.port, config.port);
  const since = parsed.values.since ?? config.since;

  if (typeof parsed.values.out === "string" && parsed.values.out.length > 0) {
    // Export mode
    const outPath = resolve(parsed.values.out);
    process.stdout.write("[holy-graph] ⚡ local-first & 100% offline. No code leaves this machine.\n");
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
  process.stdout.write("[holy-graph] ⚡ local-first & 100% offline. No code leaves this machine.\n");
  const { url, close } = await runServe({
    repo,
    port,
    since,
    config,
    open: !parsed.values["no-open"],
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
