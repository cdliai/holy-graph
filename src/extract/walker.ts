// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Git log walking and rename resolution.
// Invokes `git log --numstat -M70% --reverse --no-merges`, parses the output
// into RawCommit records, and resolves renames collapsed by git into from→to pairs.

import { execFileSync } from "node:child_process";

export interface RawChange {
  from: string;
  to: string;
  added: number;
  removed: number;
}

export interface RawCommit {
  hash: string;
  ts: number;
  author: string;
  subject: string;
  changes: RawChange[];
}

export interface WalkOptions {
  repo: string;
  /** Optional commit filter (passed to `git log --since`). */
  since?: string;
}

/**
 * Parse a git-numstat path field that may be a rename collapsed by git.
 *
 * Examples:
 * - `"src/a.ts"`                  → `{ from: "src/a.ts", to: "src/a.ts" }`
 * - `"old => new"`                → `{ from: "old",      to: "new" }`
 * - `"prefix/{old => new}/suf"`   → `{ from: "prefix/old/suf", to: "prefix/new/suf" }`
 */
export function splitRename(field: string): { from: string; to: string } {
  const braceIdx = field.indexOf("{");
  if (braceIdx !== -1) {
    const closeIdx = field.indexOf("}", braceIdx);
    if (closeIdx === -1) return { from: field, to: field };
    const prefix = field.slice(0, braceIdx);
    const suffix = field.slice(closeIdx + 1);
    const inner = field.slice(braceIdx + 1, closeIdx);
    const [fromInner, toInner] = inner.split(" => ");
    const from = (prefix + (fromInner ?? "") + suffix).replace(/\/\//g, "/");
    const to = (prefix + (toInner ?? "") + suffix).replace(/\/\//g, "/");
    return { from, to };
  }
  const arrowIdx = field.indexOf(" => ");
  if (arrowIdx !== -1) {
    return { from: field.slice(0, arrowIdx), to: field.slice(arrowIdx + 4) };
  }
  return { from: field, to: field };
}

/**
 * Walk the git log of `repo` and return parsed raw commits in chronological order.
 */
export function walkGitLog(opts: WalkOptions): RawCommit[] {
  const args = [
    "log",
    "--reverse",
    "--no-merges",
    "-M70%",
    "--numstat",
    "--pretty=format:C\t%H\t%at\t%aN\t%s",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);

  const raw = execFileSync("git", ["-C", opts.repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512, // 512 MB — large monorepos
  });

  const commits: RawCommit[] = [];
  let cur: RawCommit | null = null;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    if (line.startsWith("C\t")) {
      if (cur) commits.push(cur);
      const [, hash, ts, author, ...rest] = line.split("\t");
      cur = {
        hash,
        ts: Number(ts) * 1000,
        author: author || "unknown",
        subject: rest.join("\t") || "",
        changes: [],
      };
      continue;
    }
    if (!cur) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
    const removed = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
    const pathField = parts.slice(2).join("\t");
    const { from, to } = splitRename(pathField);
    cur.changes.push({ from, to, added, removed });
  }
  if (cur) commits.push(cur);

  return commits;
}
