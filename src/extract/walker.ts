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
  let lineStart = 0;
  const rawLen = raw.length;

  while (lineStart < rawLen) {
    let lineEnd = raw.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = rawLen;
    const line = raw.substring(lineStart, lineEnd);
    lineStart = lineEnd + 1;

    if (!line) continue;
    if (line.charCodeAt(0) === 67 && line.charCodeAt(1) === 9) { // "C\t"
      if (cur) commits.push(cur);
      const p1 = line.indexOf("\t", 2);
      const p2 = line.indexOf("\t", p1 + 1);
      const p3 = line.indexOf("\t", p2 + 1);
      cur = {
        hash: line.substring(2, p1),
        ts: Number(line.substring(p1 + 1, p2)) * 1000,
        author: line.substring(p2 + 1, p3) || "unknown",
        subject: p3 !== -1 ? line.substring(p3 + 1) : "",
        changes: [],
      };
      continue;
    }
    if (!cur) continue;
    const t1 = line.indexOf("\t");
    const t2 = line.indexOf("\t", t1 + 1);
    if (t1 === -1 || t2 === -1) continue;
    const addedStr = line.substring(0, t1);
    const removedStr = line.substring(t1 + 1, t2);
    const pathField = line.substring(t2 + 1);
    const { from, to } = splitRename(pathField);
    cur.changes.push({
      from,
      to,
      added: addedStr === "-" ? 0 : Number(addedStr) || 0,
      removed: removedStr === "-" ? 0 : Number(removedStr) || 0,
    });
  }
  if (cur) commits.push(cur);

  return commits;
}
