// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

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
 * Resolves Git's collapsed rename path grammar into canonical source/destination pairs.
 *
 * ### Grammatical Productions
 * 1. **Identity**:
 *    $$\text{"path/to/file.ts"} \implies (\text{from}: \text{"path/to/file.ts"}, \text{to}: \text{"path/to/file.ts"})$$
 * 2. **Unbounded Rename**:
 *    $$\text{"old.ts => new.ts"} \implies (\text{from}: \text{"old.ts"}, \text{to}: \text{"new.ts"})$$
 * 3. **Affixed Subpath Substitution**:
 *    $$P \cdot \{\alpha \implies \beta\} \cdot S \implies (\text{from}: P \cdot \alpha \cdot S, \text{to}: P \cdot \beta \cdot S)$$
 *    *Example*: `"src/{legacy => modern}/index.ts"` $\implies$ `("src/legacy/index.ts", "src/modern/index.ts")`
 *
 * ### Computational Complexity
 * - **Time Complexity**: $\mathcal{O}(L)$ where $L = |\text{field}|$ characters.
 * - **Auxiliary Space**: $\mathcal{O}(L)$ string allocation for resolved paths.
 *
 * @param field The raw path string from the 3rd column of `git log --numstat`.
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
 * Walks the Git commit history and extracts chronological per-commit numstat deltas.
 *
 * ### Systems & Parsing Architecture
 * Invokes `git log` with the following flags:
 * - `--reverse`: Preserves chronological order required for topological graph construction.
 * - `--no-merges`: Filters out merge commits to prevent synthetic duplicate diffs.
 * - `-M70%`: Activates Git's internal similarity index algorithm at $70\%$ threshold to track renames.
 * - `--numstat`: Emits added/removed line counters and path specifications.
 * - `--pretty=format:C\t%H\t%at\t%aN\t%s`: Emits commit header prefix `C\t` with timestamp and author.
 *
 * ### Memory Layout & Zero-Array Scanning Invariants
 * - **No Intermediate String Array (`split("\n")`)**: Scans the stdout buffer sequentially using
 *   cursor indices (`indexOf("\n")`). Avoids allocating millions of temporary string pointers on the V8 heap.
 * - **No Line Token Array (`split("\t")`)**: Extracts numstat fields via zero-allocation `indexOf("\t")`
 *   indexing directly on the current line slice.
 *
 * ### Computational Complexity
 * - **Time Complexity**: $\mathcal{O}(B)$ where $B$ is the total byte size of Git's stdout stream.
 * - **Auxiliary Space**: $\mathcal{O}(C + T)$ where $C = |\text{commits}|$ and $T = |\text{total file touches}|$.
 *   Working heap allocation during parsing is bounded by $\mathcal{O}(L_{\max})$ line slice length.
 *
 * @param opts Git repository path and optional `--since` filter.
 * @returns Parsed chronological raw commit records with resolved renames.
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
