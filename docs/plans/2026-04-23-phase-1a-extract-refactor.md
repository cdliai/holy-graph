# Holy Graph — Plan 1A: Extract TS Refactor + Test Infra

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `src/extract/index.mjs` to TypeScript, split it into focused modules (`walker.ts`, `deltas.ts`, `affinity.ts`, `progress.ts`, `index.ts`) per spec §7.1, and introduce Vitest as the project's test framework with unit and integration tests covering the extract public surface.

**Architecture:** The extract pipeline becomes a callable `async function extract(opts): Promise<Dataset>` exported from `src/extract/index.ts`. It orchestrates sibling modules that each handle one phase — git log walking, per-commit delta computation, cluster affinity — and returns a typed `Dataset`. The `pnpm extract` script continues to work (now via `tsx`), preserving the current dev workflow. No runtime behavior change: the same `data.json` keeps coming out.

**Tech Stack:** Node.js 20+, TypeScript 5.4+, Vitest 1.x (new), tsx 4.x (new). No change to dependencies of the resulting output.

**Reference:**
- Spec: `docs/specs/2026-04-22-holy-graph-productization-design.md` §7.1 (package structure), §9 (schema versioning), §15 #6 (tests arrive incrementally).
- Phase 0 plan: `docs/plans/2026-04-22-phase-0-cleanup.md` (foundation this builds on).

**Testing stance:** Vitest arrives in this plan. Unit tests cover pure functions (regex exclusion, rename parsing, affinity math). One integration test runs the full `extract()` against a generated fixture git repo and asserts schema invariants. No snapshot tests (too fragile against real repos).

**Explicit non-goals of Plan 1A (deferred):**
- CLI binary / `src/cli/` implementation — Plan 1B.
- `holy-graph.config.js` loader — Plan 1B.
- Single-file HTML export — Plan 1B.
- Removing `"private": true` + publishing — Plan 1B.
- Renderer `graph.ts` split — Plan 1C.

---

## File Structure After Plan 1A

```
src/extract/
  index.ts          # NEW — public API: async function extract(opts): Promise<Dataset>
                    #       plus "run as script" entry (reads REPO env, writes data.json)
  walker.ts         # NEW — git log execution, raw commit parsing, rename resolution
  deltas.ts         # NEW — commit filtering (excludes, max-files), file pruning, touches
  affinity.ts       # NEW — cluster-cluster co-change affinity computation
  progress.ts       # NEW — single-line progress reporter (TTY-aware, silent in CI)
  walker.test.ts    # NEW — unit tests for git log + rename helpers
  deltas.test.ts    # NEW — unit tests for exclusion regex, pruning
  affinity.test.ts  # NEW — unit tests for affinity math
  index.test.ts     # NEW — integration test via fixture repo
  index.mjs         # DELETED at end of refactor

tests/
  helpers/
    fixture-repo.ts # NEW — helper: creates tmp git repo with given commits
```

All new `.ts` files receive the FSL-1.1-Apache-2.0 header.

---

### Task 1: Install Vitest and add test infrastructure

**Why:** Phase 0 shipped without a test framework. Plan 1A introduces Vitest so every subsequent task can land with real tests, not smoke-only verification.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDep + `test` scripts)
- Create: `src/schema/version.test.mts` (sanity test — verifies Vitest actually runs)

- [ ] **Step 1: Add Vitest as devDep**

```bash
pnpm add -D vitest@^1.6.0
```

Expected: `vitest` appears in `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Add test scripts to `package.json`**

Open `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
```

The final `scripts` block should be:

```json
"scripts": {
  "extract": "node src/extract/index.mjs",
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Vitest configuration.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.mts", "tests/**/*.test.ts"],
    testTimeout: 10_000, // git operations can be slow in CI
  },
});
```

- [ ] **Step 4: Write a sanity test**

Create `src/schema/version.test.mts`:

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION } from "./version.mjs";

describe("schema version", () => {
  it("is the literal 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
```

- [ ] **Step 5: Run tests to verify infra works**

```bash
pnpm test
```

Expected: Vitest boots, finds `src/schema/version.test.mts`, runs 1 test, reports **1 passed**.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/schema/version.test.mts
git commit -m "test(infra): install Vitest with node environment and sanity test"
```

---

### Task 2: Write invariant tests against current `data.json`

**Why:** Before touching extract, capture the properties the output must keep. These tests become the regression guarantee for the entire refactor.

**Files:**
- Create: `src/extract/output-shape.test.ts`

- [ ] **Step 1: Ensure `public/data.json` exists with valid output**

Run extract to produce fresh data.json (default `../monorepo` path is missing on this machine; use the repo itself as a known-valid input):

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract
```

Expected: completes without error. `public/data.json` has `schemaVersion: 1`.

- [ ] **Step 2: Create `src/extract/output-shape.test.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Regression test: whatever we ship, the extract output must keep these shape invariants.
// Runs against public/data.json (committed, produced by the current extract). If this
// test fails after the refactor, the refactor broke backward compatibility.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCHEMA_VERSION } from "../schema/version.mjs";

const raw = readFileSync(resolve(__dirname, "../../public/data.json"), "utf8");
const data = JSON.parse(raw);

describe("extract output shape (regression anchor)", () => {
  it("carries the current SCHEMA_VERSION", () => {
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("has a meta object with required fields", () => {
    expect(data.meta).toMatchObject({
      repo: expect.any(String),
      generatedAt: expect.any(String),
      totalCommits: expect.any(Number),
      firstCommit: expect.any(String),
      lastCommit: expect.any(String),
      diskRadius: expect.any(Number),
      config: expect.any(Object),
    });
  });

  it("clusters array — non-empty, each has id/label/color/size/position", () => {
    expect(Array.isArray(data.clusters)).toBe(true);
    expect(data.clusters.length).toBeGreaterThan(0);
    for (const c of data.clusters) {
      expect(c).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        size: expect.any(Number),
        position: expect.arrayContaining([expect.any(Number)]),
      });
      expect(c.position).toHaveLength(2);
    }
  });

  it("files array — non-empty, each has id/path/cluster/firstCommitIdx/totalTouches", () => {
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBeGreaterThan(0);
    for (const f of data.files) {
      expect(f).toMatchObject({
        id: expect.any(Number),
        path: expect.any(String),
        cluster: expect.any(String),
        firstCommitIdx: expect.any(Number),
        totalTouches: expect.any(Number),
      });
    }
  });

  it("commits array — non-empty, each has sha/short/ts/date/author/msg/touches", () => {
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThan(0);
    for (const c of data.commits) {
      expect(c).toMatchObject({
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        short: expect.stringMatching(/^[0-9a-f]{7}$/),
        ts: expect.any(Number),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        author: expect.any(String),
        msg: expect.any(String),
        touches: expect.any(Array),
      });
      for (const [fid, added, removed] of c.touches) {
        expect(typeof fid).toBe("number");
        expect(typeof added).toBe("number");
        expect(typeof removed).toBe("number");
      }
    }
  });

  it("clusterEdges array — shape is [clusterIdxA, clusterIdxB, weight]", () => {
    expect(Array.isArray(data.clusterEdges)).toBe(true);
    for (const e of data.clusterEdges) {
      expect(e).toHaveLength(3);
      const [a, b, w] = e;
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("number");
      expect(typeof w).toBe("number");
      expect(w).toBeGreaterThan(0);
    }
  });

  it("file firstCommitIdx is within bounds", () => {
    for (const f of data.files) {
      expect(f.firstCommitIdx).toBeGreaterThanOrEqual(0);
      expect(f.firstCommitIdx).toBeLessThan(data.commits.length);
    }
  });

  it("commit touches reference valid file ids", () => {
    for (const c of data.commits) {
      for (const [fid] of c.touches) {
        expect(fid).toBeGreaterThanOrEqual(0);
        expect(fid).toBeLessThan(data.files.length);
      }
    }
  });
});
```

- [ ] **Step 3: Run the tests — they should all pass against current output**

```bash
pnpm test
```

Expected: 1 sanity test + 7 shape tests = **8 passed**. If any fail, something is already wrong with `public/data.json` — stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/extract/output-shape.test.ts
git commit -m "test(extract): capture output shape as regression anchor for TS refactor"
```

---

### Task 3: Add `tsx`, convert `index.mjs` → `index.ts`

**Why:** The refactor targets TypeScript, but the pipeline needs to keep running during the refactor (each task commits working state). Add `tsx` to execute TS directly, rename `.mjs` → `.ts`, update the `extract` script.

**Files:**
- Modify: `package.json` (tsx devDep, update `scripts.extract`)
- Move: `src/extract/index.mjs` → `src/extract/index.ts`
- Modify: `src/extract/index.ts` (add minimal types, fix shebang)

- [ ] **Step 1: Add tsx as devDep**

```bash
pnpm add -D tsx@^4.7.0
```

- [ ] **Step 2: Git-move the file**

```bash
git mv src/extract/index.mjs src/extract/index.ts
```

- [ ] **Step 3: Minimal TypeScript conversion of `src/extract/index.ts`**

Three small changes to keep the file valid TypeScript while preserving all logic:

1. **Remove the Node shebang `#!/usr/bin/env node`.** It is no longer invoked directly; `tsx` dispatches. Remove line 1.

2. **Replace all JSDoc `@type {...}` annotations with TypeScript types.** Search for `/** @type` in the file and convert:

   - `/** @type {Map<string, number>} */ const pathToId = new Map();`
     becomes
     `const pathToId: Map<string, number> = new Map();`
   - `/** @type {Array<{id:number, path:string, ...}>} */ const files = [];`
     becomes an interface + typed array:
     ```typescript
     interface RawFile {
       id: number;
       path: string;
       cluster: string;
       firstCommitIdx: number;
       totalTouches: number;
       allPaths: Set<string>;
     }
     const files: RawFile[] = [];
     ```
   - `/** @type {Array<{hash:string,ts:number,author:string,subject:string,changes:Array<{from:string,to:string,added:number,removed:number}>}>} */ const commitsRaw = [];`
     becomes:
     ```typescript
     interface RawChange {
       from: string;
       to: string;
       added: number;
       removed: number;
     }
     interface RawCommit {
       hash: string;
       ts: number;
       author: string;
       subject: string;
       changes: RawChange[];
     }
     const commitsRaw: RawCommit[] = [];
     ```
   - `/** @type {Array<{sha:string, short:string, ...}>} */ const commitsOut = [];`
     becomes:
     ```typescript
     import type { Commit } from "../schema/v1.js";
     const commitsOut: Commit[] = [];
     ```
   - `/** @type {Map<number,number>} */ const commitIdxRemap = new Map();`
     becomes
     `const commitIdxRemap: Map<number, number> = new Map();`

3. **Add type annotations to helper function parameters:**
   - `function git(args)` → `function git(args: string[]): string`
   - `function isExcluded(path)` → `function isExcluded(path: string): boolean`
   - `function clusterOf(path)` → `function clusterOf(path: string): string`
   - `function twoRingLayout(count, radius)` → `function twoRingLayout(count: number, radius: number): [number, number][]`
   - `function splitRename(field)` → `function splitRename(field: string): { from: string; to: string }`
   - `function ensureFile(path, commitIdx)` → `function ensureFile(path: string, commitIdx: number): number`
   - `function renameFile(from, to)` → `function renameFile(from: string, to: string): void`
   - `function affKey(a, b)` → `function affKey(a: number, b: number): string`

4. **Out-of-band: the `cur` variable** — currently `let cur = null;` then assigned to `RawCommit`. Declare it as `let cur: RawCommit | null = null;`.

- [ ] **Step 4: Update `package.json scripts.extract`**

Change:
```json
"extract": "node src/extract/index.mjs",
```
to:
```json
"extract": "tsx src/extract/index.ts",
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no output. If there are errors, go back to Step 3 and fix the types.

- [ ] **Step 6: Verify extract still runs and produces identical output**

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
```

Expected: `[extract] wrote …data.json`. Same file/cluster/commit counts as before the conversion.

- [ ] **Step 7: Run the regression tests**

```bash
pnpm test
```

Expected: **8 passed** (sanity + shape tests). Output shape unchanged.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/extract/index.ts
git commit -m "refactor(extract): convert index.mjs to TypeScript (no logic change)"
```

---

### Task 4: Create fixture-repo test helper

**Why:** Task 8's integration test needs a deterministic git repo to run extract against. A helper that builds a tmp repo with a given commit list makes integration tests reliable and fast.

**Files:**
- Create: `tests/helpers/fixture-repo.ts`

- [ ] **Step 1: Create `tests/helpers/fixture-repo.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Test helper: build a deterministic tmp git repo from a commit spec.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureCommit {
  /** Map of relative path → file content. Empty string deletes the file. */
  files: Record<string, string>;
  message: string;
  author?: string;
  /** Optional ISO timestamp; default is "now" at the time of the call. */
  date?: string;
}

export interface FixtureRepo {
  path: string;
  cleanup: () => void;
}

export function createFixtureRepo(commits: FixtureCommit[]): FixtureRepo {
  const path = mkdtempSync(join(tmpdir(), "holy-graph-fixture-"));
  const run = (args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8" });

  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "fixture@holy-graph.test"]);
  run(["config", "user.name", "Fixture"]);
  run(["config", "commit.gpgsign", "false"]);

  for (const commit of commits) {
    for (const [relPath, content] of Object.entries(commit.files)) {
      const abs = join(path, relPath);
      if (content === "") {
        rmSync(abs, { force: true });
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    run(["add", "-A"]);
    const env = {
      ...process.env,
      ...(commit.date
        ? { GIT_AUTHOR_DATE: commit.date, GIT_COMMITTER_DATE: commit.date }
        : {}),
    };
    execFileSync(
      "git",
      [
        "-C",
        path,
        "commit",
        "-q",
        "-m",
        commit.message,
        "--author",
        commit.author ?? "Fixture <fixture@holy-graph.test>",
      ],
      { env, encoding: "utf8" },
    );
  }

  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 2: Smoke-test the helper**

Create a throwaway test at `tests/helpers/fixture-repo.test.ts`:

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createFixtureRepo, type FixtureRepo } from "./fixture-repo.js";

let repo: FixtureRepo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

describe("createFixtureRepo", () => {
  it("creates a repo with the given commits", () => {
    repo = createFixtureRepo([
      { files: { "a.txt": "alpha" }, message: "first" },
      { files: { "a.txt": "alpha-v2", "b.txt": "beta" }, message: "second" },
    ]);
    const log = execFileSync("git", ["-C", repo.path, "log", "--oneline"], { encoding: "utf8" });
    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("second");
    expect(lines[1]).toContain("first");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all tests pass (previously 8, now 9).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/fixture-repo.ts tests/helpers/fixture-repo.test.ts
git commit -m "test(helpers): add createFixtureRepo for integration tests"
```

---

### Task 5: Extract `walker.ts` — git log and rename resolution

**Why:** The git log walking + rename parsing is a well-bounded concern. Pull it into its own module so it can be unit-tested without running the whole extract pipeline.

**Files:**
- Create: `src/extract/walker.ts`
- Modify: `src/extract/index.ts` (use walker, remove moved code)

- [ ] **Step 1: Create `src/extract/walker.ts`**

```typescript
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
```

- [ ] **Step 2: Remove the moved code from `src/extract/index.ts`**

Delete from `src/extract/index.ts`:

- The `splitRename` function (moved to walker.ts).
- The `git` helper function (its logic lives inside `walkGitLog` now).
- The `RawChange` / `RawCommit` type definitions (re-exported from walker.ts).
- The inline `git log` execution block and parse loop (replaced by a single `walkGitLog` call).
- The `commitsRaw` assembly loop.

Add at the top of `src/extract/index.ts` (after existing imports):

```typescript
import { walkGitLog, type RawCommit } from "./walker.js";
```

Replace the parsing block (everything from the `console.log` announcing the repo through the `[extract] parsed ${commitsRaw.length} commits` log) with:

```typescript
console.log(`[extract] repo: ${REPO}`);
const commitsRaw: RawCommit[] = walkGitLog({ repo: REPO });
console.log(`[extract] parsed ${commitsRaw.length} commits`);
```

- [ ] **Step 3: Run tsc**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Run extract end-to-end**

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
```

Expected: same `wrote …data.json`, same counts as before.

- [ ] **Step 5: Run regression tests**

```bash
pnpm test
```

Expected: 9 passed — output shape unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/extract/walker.ts src/extract/index.ts
git commit -m "refactor(extract): move git log walking and rename resolution to walker.ts"
```

---

### Task 6: Unit tests for `walker.ts`

**Why:** `splitRename` is pure and tiny — perfect TDD target. `walkGitLog` uses a real git invocation; test it against the fixture-repo helper.

**Files:**
- Create: `src/extract/walker.test.ts`

- [ ] **Step 1: Write unit tests**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, describe, expect, it } from "vitest";
import { createFixtureRepo, type FixtureRepo } from "../../tests/helpers/fixture-repo.js";
import { splitRename, walkGitLog } from "./walker.js";

describe("splitRename", () => {
  it("returns from=to=path for a regular file path", () => {
    expect(splitRename("src/a.ts")).toEqual({ from: "src/a.ts", to: "src/a.ts" });
  });

  it("parses a full-path rename", () => {
    expect(splitRename("old.txt => new.txt")).toEqual({ from: "old.txt", to: "new.txt" });
  });

  it("parses a brace rename with prefix only", () => {
    expect(splitRename("src/{a => b}.ts")).toEqual({
      from: "src/a.ts",
      to: "src/b.ts",
    });
  });

  it("parses a brace rename with prefix and suffix", () => {
    expect(splitRename("apps/{web => mobile}/src/app.ts")).toEqual({
      from: "apps/web/src/app.ts",
      to: "apps/mobile/src/app.ts",
    });
  });

  it("handles an empty-side brace rename (move out of prefix)", () => {
    expect(splitRename("pkg/{ => lib/}a.ts")).toEqual({
      from: "pkg/a.ts",
      to: "pkg/lib/a.ts",
    });
  });

  it("leaves malformed braces untouched", () => {
    expect(splitRename("pkg/{a.ts")).toEqual({ from: "pkg/{a.ts", to: "pkg/{a.ts" });
  });
});

let repo: FixtureRepo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

describe("walkGitLog", () => {
  it("returns raw commits in chronological order with author and subject", () => {
    repo = createFixtureRepo([
      { files: { "a.txt": "v1" }, message: "first" },
      { files: { "a.txt": "v2" }, message: "second" },
      { files: { "b.txt": "b" }, message: "third" },
    ]);
    const commits = walkGitLog({ repo: repo.path });
    expect(commits).toHaveLength(3);
    expect(commits.map((c) => c.subject)).toEqual(["first", "second", "third"]);
    for (const c of commits) {
      expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(c.ts).toBeGreaterThan(0);
      expect(c.author).toBe("Fixture");
    }
  });

  it("records added/removed line counts per change", () => {
    repo = createFixtureRepo([
      { files: { "a.txt": "line1\nline2\n" }, message: "init" },
      { files: { "a.txt": "line1\nline2\nline3\n" }, message: "append" },
    ]);
    const commits = walkGitLog({ repo: repo.path });
    expect(commits[1].changes).toHaveLength(1);
    expect(commits[1].changes[0].added).toBe(1);
    expect(commits[1].changes[0].removed).toBe(0);
  });

  it("detects renames collapsed by git -M70%", () => {
    repo = createFixtureRepo([
      { files: { "original.txt": "content\nmore content\nand more\n" }, message: "add" },
      {
        files: {
          "original.txt": "",
          "renamed.txt": "content\nmore content\nand more\n",
        },
        message: "rename",
      },
    ]);
    const commits = walkGitLog({ repo: repo.path });
    const renameCommit = commits[1];
    const change = renameCommit.changes[0];
    expect(change.from).toBe("original.txt");
    expect(change.to).toBe("renamed.txt");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: **18 passed** (previous 9 + 9 new in walker.test.ts).

If any walker tests fail, `walker.ts` behavior diverged from `splitRename` expectations — fix walker.ts, not the tests.

- [ ] **Step 3: Commit**

```bash
git add src/extract/walker.test.ts
git commit -m "test(extract): unit tests for walker (splitRename + walkGitLog)"
```

---

### Task 7: Extract `deltas.ts` — commit filtering, file pruning, touches

**Why:** The delta-computation phase (exclude regex → file prune → touches array) is a pure function over RawCommits + config. Isolating it makes the pipeline's second stage testable.

**Files:**
- Create: `src/extract/deltas.ts`
- Modify: `src/extract/index.ts`

- [ ] **Step 1: Create `src/extract/deltas.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Commit filtering, file pruning, and per-commit touch assembly.
// Takes parsed raw commits and returns the set of surviving files + commits with
// stable numeric file ids, dropping bulk-rewrite commits and rarely-touched files.

import type { Commit, FileMeta } from "../schema/v1.js";
import type { RawCommit } from "./walker.js";

export interface DeltaConfig {
  /** Drop commits that touch more than this many files. */
  maxFilesPerCommit: number;
  /** Drop files that were touched fewer than this many times. */
  minFileTotalTouches: number;
  /** Path regexes — matching files are excluded entirely. */
  exclude: RegExp[];
}

export const DEFAULT_EXCLUDE: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.svelte-kit(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|mov|webm|woff2?|ttf|eot|pdf|zip|gz|tgz|wasm)$/i,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/,
  /(^|\/)\.DS_Store$/,
];

export const DEFAULT_DELTA_CONFIG: DeltaConfig = {
  maxFilesPerCommit: 80,
  minFileTotalTouches: 2,
  exclude: DEFAULT_EXCLUDE,
};

export interface DeltaResult {
  files: FileMeta[];
  commits: Commit[];
}

export function isExcluded(path: string, exclude: RegExp[]): boolean {
  for (const re of exclude) if (re.test(path)) return true;
  return false;
}

/**
 * Heuristic bucket for a file into a cluster by its top-level directory — or
 * two levels when the top level is a known monorepo grouping (`apps/`, `packages/`, …).
 */
export function clusterOf(path: string): string {
  const parts = path.split("/");
  const head = parts[0];
  const GROUPS = new Set(["apps", "packages", "tools", "ops", "scripts", "services", "libs"]);
  if (GROUPS.has(head) && parts.length > 1) return `${head}/${parts[1]}`;
  return head || "(root)";
}

interface InternalFile {
  id: number;
  path: string;
  cluster: string;
  firstCommitIdx: number;
  totalTouches: number;
  allPaths: Set<string>;
}

/**
 * Walk raw commits in order and assemble the final Dataset-compatible
 * `files` and `commits` arrays, with stable numeric ids and pruning.
 */
export function computeDeltas(rawCommits: RawCommit[], config: DeltaConfig): DeltaResult {
  const pathToId = new Map<string, number>();
  const files: InternalFile[] = [];

  function ensureFile(path: string, commitIdx: number): number {
    let id = pathToId.get(path);
    if (id === undefined) {
      id = files.length;
      files.push({
        id,
        path,
        cluster: clusterOf(path),
        firstCommitIdx: commitIdx,
        totalTouches: 0,
        allPaths: new Set([path]),
      });
      pathToId.set(path, id);
    }
    return id;
  }

  function renameFile(from: string, to: string): void {
    if (from === to) return;
    const id = pathToId.get(from);
    if (id === undefined) return;
    pathToId.delete(from);
    pathToId.set(to, id);
    const f = files[id];
    f.path = to;
    f.cluster = clusterOf(to);
    f.allPaths.add(to);
  }

  const commitsOut: Commit[] = [];

  for (let ci = 0; ci < rawCommits.length; ci++) {
    const c = rawCommits[ci];
    const effective = c.changes.filter(
      (ch) => !isExcluded(ch.from, config.exclude) && !isExcluded(ch.to, config.exclude),
    );
    if (effective.length === 0) continue;
    if (effective.length > config.maxFilesPerCommit) continue;

    const touches: Array<[number, number, number]> = [];
    const seen = new Set<number>();
    for (const ch of effective) {
      if (ch.from !== ch.to) {
        if (!pathToId.has(ch.from) && !pathToId.has(ch.to)) {
          ensureFile(ch.from, ci);
        }
        if (pathToId.has(ch.from)) renameFile(ch.from, ch.to);
      }
      const id = ensureFile(ch.to, ci);
      if (seen.has(id)) continue;
      seen.add(id);
      files[id].totalTouches += 1;
      touches.push([id, ch.added, ch.removed]);
    }

    commitsOut.push({
      sha: c.hash,
      short: c.hash.slice(0, 7),
      ts: c.ts,
      date: new Date(c.ts).toISOString().slice(0, 10),
      author: c.author,
      msg: c.subject.slice(0, 200),
      touches,
    });
  }

  // Prune files below the touch threshold, remap ids.
  const remap = new Map<number, number>();
  const keptFiles: FileMeta[] = [];
  for (const f of files) {
    if (f.totalTouches < config.minFileTotalTouches) continue;
    const newId = keptFiles.length;
    remap.set(f.id, newId);
    keptFiles.push({
      id: newId,
      path: f.path,
      cluster: f.cluster,
      firstCommitIdx: -1, // fixed up below
      totalTouches: f.totalTouches,
      aliases: f.allPaths.size > 1 ? Array.from(f.allPaths) : undefined,
    });
  }

  // Filter touches against remap and track each file's post-filter first-appearance index.
  for (let ci = 0; ci < commitsOut.length; ci++) {
    const c = commitsOut[ci];
    const filtered: Array<[number, number, number]> = [];
    for (const [oldId, added, removed] of c.touches) {
      const nid = remap.get(oldId);
      if (nid === undefined) continue;
      filtered.push([nid, added, removed]);
      if (keptFiles[nid].firstCommitIdx === -1) {
        keptFiles[nid].firstCommitIdx = ci;
      }
    }
    c.touches = filtered;
  }

  // Drop commits that ended up empty after pruning.
  const commitsFinal: Commit[] = [];
  const commitIdxRemap = new Map<number, number>();
  for (let ci = 0; ci < commitsOut.length; ci++) {
    const c = commitsOut[ci];
    if (c.touches.length === 0) continue;
    commitIdxRemap.set(ci, commitsFinal.length);
    commitsFinal.push(c);
  }

  for (const f of keptFiles) {
    f.firstCommitIdx = commitIdxRemap.get(f.firstCommitIdx) ?? 0;
  }

  return { files: keptFiles, commits: commitsFinal };
}
```

- [ ] **Step 2: Remove moved code from `src/extract/index.ts`**

In `src/extract/index.ts`, delete:
- The `MAX_FILES_PER_COMMIT`, `MIN_FILE_TOTAL_TOUCHES`, and `EXCLUDE` constants.
- The `isExcluded` and `clusterOf` functions.
- The `ensureFile` and `renameFile` closures.
- The `pathToId`, `files`, `commitsOut` declarations and assembly loop.
- The pruning loop (`remap`, `keptFiles`, ID-remapping block).
- The `commitsFinal` + `commitIdxRemap` tail block.

Add imports at the top of `src/extract/index.ts`:

```typescript
import {
  DEFAULT_DELTA_CONFIG,
  computeDeltas,
  type DeltaConfig,
} from "./deltas.js";
```

Replace the removed parsing-through-pruning block with a single call:

```typescript
const { files: keptFiles, commits: commitsFinal } = computeDeltas(commitsRaw, DEFAULT_DELTA_CONFIG);
console.log(`[extract] kept ${commitsFinal.length} commits, dropped ${commitsRaw.length - commitsFinal.length}`);
```

- [ ] **Step 3: Run tsc**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run extract end-to-end**

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
```

Expected: same counts as before.

- [ ] **Step 5: Run tests**

```bash
pnpm test
```

Expected: 18 passed (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/extract/deltas.ts src/extract/index.ts
git commit -m "refactor(extract): move commit filtering, pruning, and touch assembly to deltas.ts"
```

---

### Task 8: Unit tests for `deltas.ts`

**Why:** `isExcluded`, `clusterOf`, and `computeDeltas` are all pure — ideal unit targets.

**Files:**
- Create: `src/extract/deltas.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELTA_CONFIG,
  DEFAULT_EXCLUDE,
  clusterOf,
  computeDeltas,
  isExcluded,
} from "./deltas.js";
import type { RawCommit } from "./walker.js";

describe("isExcluded", () => {
  it("excludes node_modules", () => {
    expect(isExcluded("node_modules/foo/index.js", DEFAULT_EXCLUDE)).toBe(true);
    expect(isExcluded("deep/node_modules/foo/index.js", DEFAULT_EXCLUDE)).toBe(true);
  });

  it("excludes minified JS/CSS", () => {
    expect(isExcluded("vendor.min.js", DEFAULT_EXCLUDE)).toBe(true);
    expect(isExcluded("style.min.css", DEFAULT_EXCLUDE)).toBe(true);
  });

  it("excludes binary assets", () => {
    expect(isExcluded("public/image.png", DEFAULT_EXCLUDE)).toBe(true);
    expect(isExcluded("fonts/font.woff2", DEFAULT_EXCLUDE)).toBe(true);
  });

  it("excludes lockfiles", () => {
    expect(isExcluded("pnpm-lock.yaml", DEFAULT_EXCLUDE)).toBe(true);
    expect(isExcluded("Cargo.lock", DEFAULT_EXCLUDE)).toBe(true);
  });

  it("keeps source files", () => {
    expect(isExcluded("src/index.ts", DEFAULT_EXCLUDE)).toBe(false);
    expect(isExcluded("packages/core/src/main.rs", DEFAULT_EXCLUDE)).toBe(false);
  });
});

describe("clusterOf", () => {
  it("returns the top-level dir for a flat path", () => {
    expect(clusterOf("src/main.ts")).toBe("src");
  });

  it("returns two levels for monorepo groupings", () => {
    expect(clusterOf("apps/web/src/index.ts")).toBe("apps/web");
    expect(clusterOf("packages/core/lib.ts")).toBe("packages/core");
  });

  it("falls back to (root) for bare files", () => {
    expect(clusterOf("README.md")).toBe("README.md");
    expect(clusterOf("")).toBe("(root)");
  });
});

describe("computeDeltas", () => {
  const mkCommit = (hash: string, ts: number, subject: string, changes: RawCommit["changes"]): RawCommit => ({
    hash,
    ts,
    author: "Test",
    subject,
    changes,
  });

  it("drops commits larger than maxFilesPerCommit", () => {
    const tooBigChanges = Array.from({ length: 100 }, (_, i) => ({
      from: `src/f${i}.ts`,
      to: `src/f${i}.ts`,
      added: 1,
      removed: 0,
    }));
    const raw = [mkCommit("a".repeat(40), 1, "bulk", tooBigChanges)];
    const { commits } = computeDeltas(raw, { ...DEFAULT_DELTA_CONFIG, maxFilesPerCommit: 80 });
    expect(commits).toHaveLength(0);
  });

  it("prunes files below minFileTotalTouches and remaps ids", () => {
    const raw: RawCommit[] = [
      mkCommit("a".repeat(40), 1, "c1", [
        { from: "src/kept.ts", to: "src/kept.ts", added: 1, removed: 0 },
        { from: "src/pruned.ts", to: "src/pruned.ts", added: 1, removed: 0 },
      ]),
      mkCommit("b".repeat(40), 2, "c2", [
        { from: "src/kept.ts", to: "src/kept.ts", added: 1, removed: 0 },
      ]),
    ];
    const { files, commits } = computeDeltas(raw, {
      ...DEFAULT_DELTA_CONFIG,
      minFileTotalTouches: 2,
    });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/kept.ts");
    expect(files[0].totalTouches).toBe(2);
    expect(commits).toHaveLength(2);
    for (const c of commits) {
      for (const [fid] of c.touches) {
        expect(fid).toBe(0);
      }
    }
  });

  it("resolves a rename into a single stable file id", () => {
    const raw: RawCommit[] = [
      mkCommit("a".repeat(40), 1, "c1", [
        { from: "old.ts", to: "old.ts", added: 10, removed: 0 },
      ]),
      mkCommit("b".repeat(40), 2, "c2", [
        { from: "old.ts", to: "new.ts", added: 0, removed: 0 },
      ]),
      mkCommit("c".repeat(40), 3, "c3", [
        { from: "new.ts", to: "new.ts", added: 2, removed: 1 },
      ]),
    ];
    const { files, commits } = computeDeltas(raw, DEFAULT_DELTA_CONFIG);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("new.ts");
    expect(files[0].aliases).toEqual(["old.ts", "new.ts"]);
    // All three commits reference file id 0
    for (const c of commits) {
      for (const [fid] of c.touches) expect(fid).toBe(0);
    }
  });

  it("drops commits that become empty after pruning", () => {
    const raw: RawCommit[] = [
      mkCommit("a".repeat(40), 1, "kept", [
        { from: "src/a.ts", to: "src/a.ts", added: 1, removed: 0 },
      ]),
      mkCommit("b".repeat(40), 2, "drop", [
        { from: "src/once.ts", to: "src/once.ts", added: 1, removed: 0 },
      ]),
      mkCommit("c".repeat(40), 3, "kept", [
        { from: "src/a.ts", to: "src/a.ts", added: 1, removed: 0 },
      ]),
    ];
    const { commits } = computeDeltas(raw, { ...DEFAULT_DELTA_CONFIG, minFileTotalTouches: 2 });
    expect(commits.map((c) => c.msg)).toEqual(["kept", "kept"]);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: **30 passed** (18 + 12 new).

- [ ] **Step 3: Commit**

```bash
git add src/extract/deltas.test.ts
git commit -m "test(extract): unit tests for deltas (isExcluded, clusterOf, computeDeltas)"
```

---

### Task 9: Extract `affinity.ts` — cluster-cluster affinity

**Why:** Affinity math is a pure function over files, commits, and a cluster ordering. Isolating it makes the cluster-bridge-weight calculation testable.

**Files:**
- Create: `src/extract/affinity.ts`
- Modify: `src/extract/index.ts`

- [ ] **Step 1: Create `src/extract/affinity.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Cluster-cluster co-change affinity.
// For every commit that touches files in more than one cluster, emit a weighted
// edge between each pair of clusters. Big commits contribute less per-pair (via
// log-scaled contribution) so they don't dominate the signal.

import type { ClusterEdge, Commit, FileMeta } from "../schema/v1.js";

/** Minimum weight for an edge to survive into the output. */
export const AFFINITY_THRESHOLD = 0.5;

export function computeAffinity(
  files: FileMeta[],
  commits: Commit[],
  clusterOrder: string[],
): ClusterEdge[] {
  const clusterIndex = new Map(clusterOrder.map((c, i) => [c, i]));
  const fileCluster = new Map(files.map((f) => [f.id, f.cluster]));
  const affKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const affinity = new Map<string, number>();

  for (const c of commits) {
    if (c.touches.length <= 1) continue;
    const ci = new Set<number>();
    for (const [fid] of c.touches) {
      const cid = fileCluster.get(fid);
      if (cid === undefined) continue;
      const idx = clusterIndex.get(cid);
      if (idx !== undefined) ci.add(idx);
    }
    if (ci.size <= 1) continue;
    const arr = Array.from(ci);
    // Per-pair contribution decays with number of clusters touched.
    const contribution = 1 / Math.log2(arr.length + 2);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = affKey(arr[i], arr[j]);
        affinity.set(k, (affinity.get(k) ?? 0) + contribution);
      }
    }
  }

  const edges: ClusterEdge[] = [];
  for (const [k, w] of affinity) {
    if (w < AFFINITY_THRESHOLD) continue;
    const [as, bs] = k.split("|");
    edges.push([Number(as), Number(bs), +w.toFixed(3)]);
  }
  edges.sort((a, b) => b[2] - a[2]);
  return edges;
}
```

- [ ] **Step 2: Remove moved code from `src/extract/index.ts`**

Delete the affinity computation block (`clusterIndex`, `fileCluster`, `affKey`, `affinity` loop, final `clusterEdges` assembly) from `src/extract/index.ts`.

Add import:

```typescript
import { computeAffinity } from "./affinity.js";
```

Replace the deleted block with a single call (near where `clusterOrder` is in scope — check the existing code for where `clusterOrder` is defined):

```typescript
const clusterEdges = computeAffinity(keptFiles, commitsFinal, clusterOrder);
```

- [ ] **Step 3: Verify**

```bash
node_modules/.bin/tsc --noEmit
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
pnpm test
```

Expected: tsc clean, extract produces same counts, 30 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/extract/affinity.ts src/extract/index.ts
git commit -m "refactor(extract): move cluster-cluster affinity to affinity.ts"
```

---

### Task 10: Unit tests for `affinity.ts`

**Files:**
- Create: `src/extract/affinity.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, expect, it } from "vitest";
import { AFFINITY_THRESHOLD, computeAffinity } from "./affinity.js";
import type { Commit, FileMeta } from "../schema/v1.js";

const file = (id: number, cluster: string): FileMeta => ({
  id,
  path: `${cluster}/file${id}.ts`,
  cluster,
  firstCommitIdx: 0,
  totalTouches: 10,
});

const commit = (touches: Array<[number, number, number]>): Commit => ({
  sha: "0".repeat(40),
  short: "0000000",
  ts: 0,
  date: "2026-01-01",
  author: "Test",
  msg: "",
  touches,
});

describe("computeAffinity", () => {
  it("returns no edges when commits touch only one cluster", () => {
    const files = [file(0, "a"), file(1, "a")];
    const commits = [commit([[0, 1, 0], [1, 1, 0]])];
    expect(computeAffinity(files, commits, ["a"])).toEqual([]);
  });

  it("emits an edge when two clusters co-change above the threshold", () => {
    const files = [file(0, "a"), file(1, "b")];
    // Many co-change commits — weight should clear threshold.
    const commits = Array.from({ length: 5 }, () => commit([[0, 1, 0], [1, 1, 0]]));
    const edges = computeAffinity(files, commits, ["a", "b"]);
    expect(edges).toHaveLength(1);
    const [a, b, w] = edges[0];
    expect([a, b].sort()).toEqual([0, 1]);
    expect(w).toBeGreaterThan(AFFINITY_THRESHOLD);
  });

  it("drops edges with weight strictly below the threshold", () => {
    const files = [file(0, "a"), file(1, "b"), file(2, "c")];
    // Single commit touching 3 clusters: per-pair contribution = 1/log2(3+2) ≈ 0.431,
    // below the 0.5 threshold, so all three pairs are dropped.
    const commits = [commit([[0, 1, 0], [1, 1, 0], [2, 1, 0]])];
    const edges = computeAffinity(files, commits, ["a", "b", "c"]);
    expect(edges).toHaveLength(0);
  });

  it("weights big commits less per-pair than focused commits", () => {
    const files = [file(0, "a"), file(1, "b"), file(2, "c"), file(3, "d")];
    const focusedCommits = Array.from({ length: 10 }, () =>
      commit([[0, 1, 0], [1, 1, 0]]),
    );
    const noisyCommits = Array.from({ length: 10 }, () =>
      commit([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]),
    );
    const focused = computeAffinity(files, focusedCommits, ["a", "b", "c", "d"]);
    const noisy = computeAffinity(files, noisyCommits, ["a", "b", "c", "d"]);
    const weightAB = (edges: typeof focused) =>
      edges.find(
        ([a, b]) => (a === 0 && b === 1) || (a === 1 && b === 0),
      )?.[2] ?? 0;
    // Focused commits contribute more to A-B than noisy ones do.
    expect(weightAB(focused)).toBeGreaterThan(weightAB(noisy));
  });

  it("sorts edges by descending weight", () => {
    const files = [file(0, "a"), file(1, "b"), file(2, "c")];
    const commits = [
      ...Array.from({ length: 10 }, () => commit([[0, 1, 0], [1, 1, 0]])),
      ...Array.from({ length: 3 }, () => commit([[1, 1, 0], [2, 1, 0]])),
    ];
    const edges = computeAffinity(files, commits, ["a", "b", "c"]);
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i - 1][2]).toBeGreaterThanOrEqual(edges[i][2]);
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: **35 passed** (30 + 5 new).

- [ ] **Step 3: Commit**

```bash
git add src/extract/affinity.test.ts
git commit -m "test(extract): unit tests for computeAffinity"
```

---

### Task 11: Extract `progress.ts` — minimal progress reporter

**Why:** Spec §13 Phase 1 "Minimal progress bar in `extract/`" — big repos currently go silent during parse. Ship a simple TTY-aware progress reporter as its own module; wire it into extract in Task 12.

**Files:**
- Create: `src/extract/progress.ts`
- Create: `src/extract/progress.test.ts`

- [ ] **Step 1: Create `src/extract/progress.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Single-line progress reporter. TTY-aware: renders a carriage-return-updated
// line when attached to a terminal, silent in pipes / CI / non-TTY environments.

export interface Progress {
  start(label: string, total?: number): void;
  update(current: number, suffix?: string): void;
  done(final?: string): void;
}

export function createProgress(stream: NodeJS.WriteStream = process.stderr): Progress {
  const isTty = stream.isTTY === true;
  let label = "";
  let total = 0;
  let lastRenderMs = 0;

  return {
    start(nextLabel, nextTotal) {
      label = nextLabel;
      total = nextTotal ?? 0;
      lastRenderMs = 0;
      if (isTty) stream.write(`${label}…\r`);
    },
    update(current, suffix) {
      if (!isTty) return;
      // Throttle to ~20 Hz so we don't flood the terminal.
      const now = Date.now();
      if (now - lastRenderMs < 50) return;
      lastRenderMs = now;
      const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
      const pctStr = total > 0 ? ` ${pct}%` : "";
      stream.write(`\r${label}${pctStr} ${suffix ?? ""}[K`);
    },
    done(final) {
      if (isTty) stream.write(`\r${final ?? `${label} done`}[K\n`);
      else if (final) stream.write(`${final}\n`);
    },
  };
}
```

- [ ] **Step 2: Create `src/extract/progress.test.ts`**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createProgress } from "./progress.js";

function mockTtyStream(isTty: boolean) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  }) as Writable & { isTTY?: boolean };
  stream.isTTY = isTty;
  return { stream: stream as unknown as NodeJS.WriteStream, chunks };
}

describe("createProgress", () => {
  it("is silent in non-TTY mode", () => {
    const { stream, chunks } = mockTtyStream(false);
    const p = createProgress(stream);
    p.start("Parsing", 100);
    p.update(50);
    p.done();
    expect(chunks).toEqual([]);
  });

  it("writes a final summary in non-TTY mode when provided", () => {
    const { stream, chunks } = mockTtyStream(false);
    const p = createProgress(stream);
    p.start("Parsing");
    p.done("Parsing: 1234 commits");
    expect(chunks.join("")).toContain("Parsing: 1234 commits");
  });

  it("renders a label on start in TTY mode", () => {
    const { stream, chunks } = mockTtyStream(true);
    const p = createProgress(stream);
    p.start("Parsing", 10);
    expect(chunks.join("")).toContain("Parsing");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: **38 passed** (35 + 3 new).

- [ ] **Step 4: Commit**

```bash
git add src/extract/progress.ts src/extract/progress.test.ts
git commit -m "feat(extract): add Progress reporter module"
```

---

### Task 12: Refactor `index.ts` — public `extract()` API + wire in progress

**Why:** With walker / deltas / affinity / progress all isolated, `index.ts` becomes a thin orchestrator that exposes a testable `extract()` function. This task also wires Progress into the pipeline.

**Files:**
- Modify: `src/extract/index.ts`

- [ ] **Step 1: Replace `src/extract/index.ts` with the orchestrator**

Target content — keep existing imports plus add the orchestration logic. The file shrinks dramatically:

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Extract a commit-indexed semantic graph from a git repository.
//
// Public API: `extract(opts)` returns a Dataset. When invoked as a script
// (`tsx src/extract/index.ts`), reads the REPO env var and writes
// public/data.json.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMA_VERSION } from "../schema/version.mjs";
import type { Cluster, ClusterEdge, Dataset, FileMeta } from "../schema/v1.js";

import { walkGitLog, type RawCommit } from "./walker.js";
import { computeDeltas, DEFAULT_DELTA_CONFIG, type DeltaConfig } from "./deltas.js";
import { computeAffinity } from "./affinity.js";
import { createProgress } from "./progress.js";

// ────────────────────────────────────────────────────────────────
// Cluster layout — lays cluster anchors on two concentric rings.
// ────────────────────────────────────────────────────────────────

const CLUSTER_PALETTE = [
  "#7cc7ff", "#ffb86b", "#b78bff", "#66e6a9", "#ff7aa5",
  "#f1d86b", "#5ed8d0", "#ff8e5a", "#9fb7ff", "#c7f06b",
  "#ff6b8e", "#7ee2c4", "#d48bff", "#ffc07a", "#6bf0c3",
  "#ff9eb5", "#8bd4ff", "#e5ff6b", "#ffb38b", "#a0a8ff",
];

const MAJOR_RING_COUNT = 22;
const DISK_MIN_RADIUS = 90;

function twoRingLayout(count: number, radius: number): [number, number][] {
  const pts: [number, number][] = new Array(count);
  const outer = Math.min(count, MAJOR_RING_COUNT);
  const inner = count - outer;
  for (let i = 0; i < outer; i++) {
    const angle = -Math.PI / 2 + (i / outer) * Math.PI * 2;
    pts[i] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }
  const innerRadius = radius * 0.48;
  const rotate = Math.PI / Math.max(1, inner);
  for (let i = 0; i < inner; i++) {
    const angle = -Math.PI / 2 + rotate + (i / inner) * Math.PI * 2;
    pts[outer + i] = [Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius];
  }
  return pts;
}

function buildClusters(files: FileMeta[]): {
  clusters: Cluster[];
  clusterOrder: string[];
  diskRadius: number;
} {
  const clusterSize = new Map<string, number>();
  for (const f of files) {
    clusterSize.set(f.cluster, (clusterSize.get(f.cluster) ?? 0) + 1);
  }
  const clusterOrder = Array.from(clusterSize.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const diskRadius = Math.max(
    DISK_MIN_RADIUS,
    (Math.min(clusterOrder.length, MAJOR_RING_COUNT) * 26) / (2 * Math.PI),
  );
  const diskPositions = twoRingLayout(clusterOrder.length, diskRadius);

  const clusters: Cluster[] = clusterOrder.map((id, i) => ({
    id,
    label: id,
    color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
    size: clusterSize.get(id) ?? 0,
    position: diskPositions[i],
  }));

  return { clusters, clusterOrder, diskRadius };
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** Absolute path to the git repository to analyze. */
  repo: string;
  /** Optional `--since` filter passed to git log. */
  since?: string;
  /** Override delta-computation config (defaults to DEFAULT_DELTA_CONFIG). */
  deltaConfig?: DeltaConfig;
  /** Show a progress reporter on stderr (default: true in TTY, always off otherwise). */
  showProgress?: boolean;
}

export async function extract(opts: ExtractOptions): Promise<Dataset> {
  const deltaConfig = opts.deltaConfig ?? DEFAULT_DELTA_CONFIG;
  const progress = createProgress(process.stderr);

  if (opts.showProgress !== false) progress.start("extracting");

  const rawCommits: RawCommit[] = walkGitLog({ repo: opts.repo, since: opts.since });
  if (opts.showProgress !== false) {
    progress.update(0, `parsed ${rawCommits.length} commits`);
  }

  const { files, commits } = computeDeltas(rawCommits, deltaConfig);
  if (opts.showProgress !== false) {
    progress.update(0, `${files.length} files · ${commits.length} commits`);
  }

  const { clusters, clusterOrder, diskRadius } = buildClusters(files);
  const clusterEdges: ClusterEdge[] = computeAffinity(files, commits, clusterOrder);

  if (opts.showProgress !== false) {
    progress.done(
      `[extract] ${files.length} files · ${clusters.length} clusters · ${commits.length} commits`,
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      repo: opts.repo,
      generatedAt: new Date().toISOString(),
      totalCommits: commits.length,
      firstCommit: new Date(commits[0]?.ts ?? 0).toISOString(),
      lastCommit: new Date(commits[commits.length - 1]?.ts ?? 0).toISOString(),
      diskRadius,
      config: {
        MAX_FILES_PER_COMMIT: deltaConfig.maxFilesPerCommit,
        MIN_FILE_TOTAL_TOUCHES: deltaConfig.minFileTotalTouches,
      },
    },
    clusters,
    clusterEdges,
    files,
    commits,
  };
}

// ────────────────────────────────────────────────────────────────
// Script entry — `tsx src/extract/index.ts` or `pnpm extract`
// ────────────────────────────────────────────────────────────────

const invokedAsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const REPO = process.env.REPO ?? resolve(ROOT, "../monorepo");
  const OUT = resolve(ROOT, "public/data.json");

  const dataset = await extract({ repo: REPO });
  mkdirSync(dirname(OUT), { recursive: true });
  const serialized = JSON.stringify(dataset);
  writeFileSync(OUT, serialized);
  console.log(`[extract] wrote ${OUT} (${(serialized.length / 1024).toFixed(1)} KB)`);
}
```

- [ ] **Step 2: Run tsc**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run extract end-to-end**

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
```

Expected: `[extract] wrote …` with same counts.

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```

Expected: 38 passed (no regressions — `output-shape.test.ts` still asserts against `public/data.json`).

- [ ] **Step 5: Commit**

```bash
git add src/extract/index.ts
git commit -m "refactor(extract): split index.ts into orchestrator with extract() public API"
```

---

### Task 13: Integration test for `extract()` via fixture repo

**Why:** Unit tests cover pieces; this one proves the whole assembly works end-to-end.

**Files:**
- Create: `src/extract/index.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, describe, expect, it } from "vitest";
import { createFixtureRepo, type FixtureRepo } from "../../tests/helpers/fixture-repo.js";
import { SCHEMA_VERSION } from "../schema/version.mjs";
import { extract } from "./index.js";

let repo: FixtureRepo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

describe("extract()", () => {
  it("produces a valid Dataset from a multi-commit repo", async () => {
    repo = createFixtureRepo([
      { files: { "src/a.ts": "alpha\nbeta\ngamma\n" }, message: "add a" },
      { files: { "src/b.ts": "line\n" }, message: "add b" },
      { files: { "src/a.ts": "alpha\nbeta\ngamma\ndelta\n" }, message: "touch a" },
      {
        files: {
          "src/a.ts": "alpha\nbeta\ngamma\ndelta\nepsilon\n",
          "src/b.ts": "line\nline2\n",
        },
        message: "co-change a and b",
      },
      {
        files: { "src/b.ts": "line\nline2\nline3\n" },
        message: "touch b again",
      },
    ]);

    const ds = await extract({ repo: repo.path, showProgress: false });

    expect(ds.schemaVersion).toBe(SCHEMA_VERSION);
    expect(ds.meta.repo).toBe(repo.path);
    expect(ds.meta.totalCommits).toBeGreaterThan(0);
    expect(ds.clusters.length).toBeGreaterThan(0);
    expect(ds.files.length).toBeGreaterThan(0);
    expect(ds.commits.length).toBeGreaterThan(0);

    // Every commit touch must reference a valid file id
    for (const c of ds.commits) {
      for (const [fid] of c.touches) {
        expect(fid).toBeGreaterThanOrEqual(0);
        expect(fid).toBeLessThan(ds.files.length);
      }
    }

    // Every file's firstCommitIdx must be within commits range
    for (const f of ds.files) {
      expect(f.firstCommitIdx).toBeGreaterThanOrEqual(0);
      expect(f.firstCommitIdx).toBeLessThan(ds.commits.length);
    }
  });

  it("resolves a rename across commits into one file id", async () => {
    // Need enough content changes on the renamed file to exceed minFileTotalTouches=2 default
    repo = createFixtureRepo([
      { files: { "old.ts": "v1\n" }, message: "add" },
      { files: { "old.ts": "v1\nv2\n" }, message: "touch" },
      { files: { "old.ts": "", "new.ts": "v1\nv2\n" }, message: "rename" },
      { files: { "new.ts": "v1\nv2\nv3\n" }, message: "touch renamed" },
    ]);
    const ds = await extract({ repo: repo.path, showProgress: false });
    const renamedFile = ds.files.find((f) => f.path === "new.ts");
    expect(renamedFile).toBeDefined();
    expect(renamedFile?.aliases).toContain("old.ts");
    expect(renamedFile?.aliases).toContain("new.ts");
  });

  it("filters excluded paths (node_modules)", async () => {
    repo = createFixtureRepo([
      {
        files: {
          "src/a.ts": "alpha\nbeta\n",
          "node_modules/pkg/index.js": "require()\n",
        },
        message: "init",
      },
      {
        files: {
          "src/a.ts": "alpha\nbeta\ngamma\n",
          "node_modules/pkg/index.js": "require()\nupdated\n",
        },
        message: "touch both",
      },
    ]);
    const ds = await extract({ repo: repo.path, showProgress: false });
    for (const f of ds.files) {
      expect(f.path).not.toMatch(/node_modules/);
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: **41 passed** (38 + 3 integration).

- [ ] **Step 3: Commit**

```bash
git add src/extract/index.test.ts
git commit -m "test(extract): integration test for extract() via fixture repo"
```

---

### Task 14: Final verification

**Why:** Prove Plan 1A preserved every Phase 0 promise and added the test layer.

**Files:** none modified.

- [ ] **Step 1: Clean install + full smoke**

```bash
rm -rf node_modules
pnpm install
```

Expected: no errors.

- [ ] **Step 2: TypeScript**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Full test suite**

```bash
pnpm test
```

Expected: **41 passed**, 0 failed, 0 skipped.

- [ ] **Step 4: Extract end-to-end**

```bash
REPO=/Users/fatih/Desktop/projects/CDLI/holy-graph pnpm extract 2>&1 | tail -3
```

Expected: success. Count of kept commits matches pre-refactor run.

- [ ] **Step 5: Build**

```bash
pnpm build
```

Expected: `✓ built in …ms`, no errors.

- [ ] **Step 6: Dev server**

```bash
pnpm dev > /tmp/vite.log 2>&1 &
sleep 3
curl -sI http://localhost:5173 | head -1
kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 7: File-tree sanity**

```bash
find src/extract -type f | sort
```

Expected (exactly):

```
src/extract/affinity.test.ts
src/extract/affinity.ts
src/extract/deltas.test.ts
src/extract/deltas.ts
src/extract/index.test.ts
src/extract/index.ts
src/extract/output-shape.test.ts
src/extract/progress.test.ts
src/extract/progress.ts
src/extract/walker.test.ts
src/extract/walker.ts
```

Confirm: no `.mjs` files left under `src/extract/`.

- [ ] **Step 8: Commit count check**

```bash
git log --oneline main..HEAD | wc -l
```

Expected: 14 commits (one per task, plus per-split commits).

- [ ] **No commit in Task 14.**

---

## Plan 1A Definition of Done

- [ ] Vitest installed and all tests pass (41+).
- [ ] `src/extract/` contains TypeScript modules: `walker.ts`, `deltas.ts`, `affinity.ts`, `progress.ts`, `index.ts` — plus test files.
- [ ] `src/extract/index.mjs` no longer exists.
- [ ] `extract()` exported from `src/extract/index.ts` with typed `ExtractOptions` / `Promise<Dataset>` signature.
- [ ] `pnpm extract` still works via `tsx`.
- [ ] `pnpm build`, `pnpm dev`, and `pnpm test` all green.
- [ ] FSL header on every new source file.
- [ ] No functional regression vs. Phase 0 (output-shape tests prove it).

## What Plan 1A Does NOT Do (by design)

- No CLI binary (`bin/holy-graph`, `src/cli/`) — Plan 1B.
- No `holy-graph.config.js` loader — Plan 1B.
- No single-file HTML export (`--out viz.html`) — Plan 1B.
- No removal of `"private": true` — Plan 1B.
- No renderer `graph.ts` split — Plan 1C.
- No `bin:` field implementation — Plan 1B.
- No publish / tag — Plan 1B.

## Next Phase

After Plan 1A lands on main, run `superpowers:writing-plans` against the Phase 1B scope to produce `docs/plans/2026-04-XX-phase-1b-cli.md`.
