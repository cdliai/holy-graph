# Holy Graph — Phase 0: Cleanup & Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the package to `@cdli/holy-graph`, apply FSL-1.1-Apache-2.0 licensing, introduce `schemaVersion: 1` to the data format, reorganize files into the §7.1 structure, and rewrite the README — all while keeping `pnpm extract` / `pnpm dev` working at every step.

**Architecture:** Phase 0 is mechanical cleanup and foundation only. No functional behavior changes. The extract pipeline stays as `.mjs` (TypeScript conversion is Phase 1). Renderer file splits (e.g., `graph.ts` → scene/layout/edges/nodes/hud) are Phase 1. Phase 0's deliverable is a **renamed, licensed, reorganized repo whose existing commands still work**.

**Tech Stack:** Node.js 20+, TypeScript 5.4, Vite 5, Three.js 0.163, d3-force-3d 3. No new dependencies in Phase 0.

**Reference spec:** `docs/specs/2026-04-22-holy-graph-productization-design.md`
Relevant sections: §5 (license), §6 (naming), §7 (architectural discipline), §9 (data schema versioning), Appendix A (migration map).

**Testing stance (explicit):** Phase 0 adds no unit test framework. The spec §15 tradeoff #6 accepts "smoke tests only at ship"; Phase 1 introduces Vitest and a proper test setup. Phase 0 verification = "existing commands still produce a working visualization".

---

### Task 1: Baseline verification

**Why:** Lock in a known-working state before any change. If Phase 0 breaks something later, we have a reference SHA to compare against.

**Files:** none modified.

- [ ] **Step 1: Verify install is clean**

```bash
pnpm install
```

Expected: no errors, lockfile unchanged.

- [ ] **Step 2: Verify extract works**

```bash
pnpm extract
ls -la public/data.json
```

Expected: `public/data.json` is written. Record its size (e.g. `1.4M`) for later comparison.

- [ ] **Step 3: Verify dev server serves the app**

```bash
pnpm dev &
sleep 3
curl -sI http://localhost:5173 | head -1
curl -s http://localhost:5173 | grep -i "codebase evolution"
kill %1
```

Expected: HTTP 200; body contains `Codebase Evolution` title.

- [ ] **Step 4: Record baseline**

```bash
git log --oneline -1
git status
```

Record the current commit SHA. This is the rollback target if Phase 0 goes sideways.

**No commit — this is a read-only verification task.**

---

### Task 2: Create directory skeleton

**Why:** All new target paths exist up-front so file-move tasks don't create directories as side-effects and can be reviewed cleanly.

**Files:**
- Create: `src/cli/.gitkeep`
- Create: `src/extract/.gitkeep`
- Create: `src/renderer/.gitkeep`
- Create: `src/export/.gitkeep`
- Create: `src/config/.gitkeep`
- Create: `src/schema/.gitkeep`
- Create: `gallery/landing/.gitkeep`
- Create: `gallery/repos/.gitkeep`
- Create: `gallery/shared/.gitkeep`
- Create: `.github/workflows/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p \
  src/cli src/extract src/renderer src/export src/config src/schema \
  gallery/landing gallery/repos gallery/shared \
  .github/workflows

touch \
  src/cli/.gitkeep src/extract/.gitkeep src/renderer/.gitkeep \
  src/export/.gitkeep src/config/.gitkeep src/schema/.gitkeep \
  gallery/landing/.gitkeep gallery/repos/.gitkeep gallery/shared/.gitkeep \
  .github/workflows/.gitkeep
```

- [ ] **Step 2: Verify the structure**

```bash
find src gallery .github -type d | sort
```

Expected output (exactly):
```
.github
.github/workflows
gallery
gallery/landing
gallery/repos
gallery/shared
src
src/cli
src/config
src/export
src/extract
src/renderer
src/schema
```

- [ ] **Step 3: Commit**

```bash
git add src/cli src/extract src/renderer src/export src/config src/schema gallery .github
git commit -m "chore: create package directory skeleton per spec §7.1"
```

---

### Task 3: Add FSL-1.1-Apache-2.0 LICENSE file

**Why:** Spec §5 — FSL licensing must be in place before any source file receives its header.

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Fetch the canonical FSL-1.1-Apache-2.0 template**

Open https://fsl.software/FSL-1.1-Apache-2.0.template.md in a browser (or fetch with `curl`) and copy the full template text. If that URL is not reachable, use the canonical mirror at https://github.com/fsl-software/fsl.software/blob/main/FSL-1.1-Apache-2.0.template.md.

- [ ] **Step 2: Fill placeholders**

In the template, replace:

| Placeholder | Value |
|---|---|
| `[Licensor]` | `CDLI` |
| `[Software]` | `Holy Graph` |
| `[Change Date]` | `2028-04-22` (spec §5 — two years from 2026-04-22) |
| `[Change License]` | `Apache License, Version 2.0` |

- [ ] **Step 3: Save as `LICENSE` (no extension) in repo root**

```bash
ls -la LICENSE
wc -l LICENSE
```

Expected: file exists, roughly 30–50 lines (template length depends on variant).

- [ ] **Step 4: Commit**

```bash
git add LICENSE
git commit -m "chore: add FSL-1.1-Apache-2.0 license (converts to Apache 2.0 on 2028-04-22)"
```

---

### Task 4: Add per-file header template

**Why:** Every source file will carry a one-line attribution header (spec §7.3 "Author identity preserved"). Task 13 applies this to every file. This task creates the canonical template.

**Files:**
- Create: `LICENSE.headers.txt`

- [ ] **Step 1: Write the header template**

Create `LICENSE.headers.txt` with exactly this content (one line, trailing newline):

```
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
```

- [ ] **Step 2: Verify**

```bash
cat LICENSE.headers.txt
```

Expected: the single line above.

- [ ] **Step 3: Commit**

```bash
git add LICENSE.headers.txt
git commit -m "chore: add per-file license header template"
```

---

### Task 5: Update `package.json` (rename, scope, metadata)

**Why:** Spec §6 — package name is `@cdli/holy-graph`, binary is `holy-graph`, license is FSL. Scripts stay pointing at current file locations; they'll be updated in Task 11 when `extract.mjs` moves.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `package.json` content**

Current content is 22 lines. Replace with:

```json
{
  "name": "@cdli/holy-graph",
  "version": "0.1.0",
  "description": "A 3D visualization that replays a codebase's git history commit by commit.",
  "keywords": [
    "git",
    "visualization",
    "codebase",
    "3d",
    "three.js",
    "cli"
  ],
  "homepage": "https://holygraph.cdli.ai",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/CDLI/holy-graph.git"
  },
  "bugs": {
    "url": "https://github.com/CDLI/holy-graph/issues"
  },
  "license": "SEE LICENSE IN LICENSE",
  "author": "Fatih Burak Karagöz <higlited@gmail.com> (CDLI)",
  "type": "module",
  "bin": {
    "holy-graph": "./dist/cli/index.js"
  },
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
  "scripts": {
    "extract": "node pipeline/extract.mjs",
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "d3-force-3d": "^3.0.5",
    "three": "^0.163.0"
  },
  "devDependencies": {
    "@types/three": "^0.163.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.10"
  }
}
```

Notes:
- `"private": true` is removed — we intend to publish to npm under `@cdli` scope.
- `bin.holy-graph` points at `./dist/cli/index.js` (per spec §13 Phase 0). `dist/cli/index.js` does not exist at end of Phase 0; Phase 1 builds it. Declaring it now signals intent and makes the `package.json` the canonical source of the binary's final path. `pnpm install` does not fail on a missing `bin` target for a locally-linked package.
- `scripts.extract` still references `pipeline/extract.mjs` — updated in Task 12 after the file moves.

- [ ] **Step 2: Verify `pnpm install` still works**

```bash
pnpm install
```

Expected: no errors. `pnpm-lock.yaml` may update because the package name changed (this is fine).

- [ ] **Step 3: Smoke test — existing scripts still run**

```bash
pnpm extract
pnpm dev &
sleep 3
curl -sI http://localhost:5173 | head -1
kill %1
```

Expected: extract succeeds; dev server returns HTTP 200.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: rename to @cdli/holy-graph with scoped metadata and bin declaration"
```

---

### Task 6: Rewrite README as product-first

**Why:** Spec §13 Phase 0 — current README leads with implementation detail. A product-first README leads with what it does, one GIF, three install lines, then detail. This doubles as the npm package description once published.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` content**

Replace with:

````markdown
# Holy Graph

> A 3D visualization that replays your codebase's git history — commit by commit.

![Holy Graph screenshot](./public/holy-graph.png)

Holy Graph turns a git repository into a 3D scene: every source file is a glowing point, co-changing files link up, modules cluster, and hot files float above the plane. Not a git-log viewer — a semantic view of how your architecture grew.

## Quick start

```bash
# in any git repository
npx @cdli/holy-graph
```

Opens the visualization in your browser at http://localhost:5173. To export a shareable single-file HTML:

```bash
npx @cdli/holy-graph --out viz.html
```

> **Note:** The `npx` binary ships in v1.0. During Phase 0 development, use `pnpm extract && pnpm dev` from a local clone.

## Gallery

Pre-rendered animations of well-known codebases live at [holygraph.cdli.ai](https://holygraph.cdli.ai).

## What you're seeing

- **Points** — source files. Colour = module (e.g. `apps/atlas`), size = recent activity (decays over time), height = how hot the file is right now.
- **Dim lines** — files in the same module that change together.
- **Bright lines** — cross-module co-change. These are the architectural bridges worth watching.
- **Rings** — bright: file was just born. Soft: file was just touched.
- **Sparks** along edges = signal rippling from a file touched in the current commit toward its strongest co-change neighbours.
- **Beacons** mark each module's home. Hover a point or beacon for details.

## How it works

1. `src/extract/` walks `git log --numstat -M70%`, resolves renames into stable file ids, and emits per-commit deltas plus cluster-cluster affinity to `data.json`.
2. `src/renderer/` replays those deltas with time-based decay on activity and edge weights.
3. A d3-force-3d simulation lays clusters out seeded by affinity; a second sim places files inside each cluster. Three.js draws the scene.

## Configuration

Knobs live in `holy-graph.config.js` (see `src/config/schema.ts` for the full list). Common ones:

| Setting | Effect |
| --- | --- |
| `MAX_FILES_PER_COMMIT` | drop bulk-rewrite commits |
| `MIN_FILE_TOTAL_TOUCHES` | prune rarely-touched files |
| `EXCLUDE` | path regexes to ignore |
| `HALF_LIFE_ACT_DAYS` | how fast a file's glow fades |
| `HALF_LIFE_EDGE_DAYS` | how fast co-change ties fade |

## Controls

Drag to orbit · scroll to zoom · right-drag to pan · play/scrub from the HUD · click a module chip to zoom into it · double-click anywhere to reset.

## License

[FSL-1.1-Apache-2.0](./LICENSE) — source-available, non-competing use permitted, auto-converts to Apache 2.0 on 2028-04-22.

## Author

Built by [Fatih Burak Karagöz](https://github.com/CDLI) as part of [CDLI](https://cdli.ai) — *Intelligence for Developers · Insights for Products · Impact for Business.*
````

- [ ] **Step 2: Verify the new README renders**

```bash
head -20 README.md
```

Expected: starts with `# Holy Graph` and the tagline.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README as product-first with pitch, install, feature tour"
```

---

### Task 7: Create `src/schema/v1.ts` with `SCHEMA_VERSION` constant

**Why:** Spec §9 — introduce a versioned schema module. All of `src/types.ts` is currently schema types (verified — no renderer-internal types), so the file can be moved wholesale into the schema package in Task 10.

This task creates the new `src/schema/v1.ts` with a `SCHEMA_VERSION` constant but **does not delete** the old `src/types.ts` yet. Task 10 handles the delete after all consumers are updated.

**Files:**
- Create: `src/schema/v1.ts`
- Create: `src/schema/index.ts`

- [ ] **Step 1: Write `src/schema/v1.ts`**

```typescript
// Schema version 1 — the first stable data.json contract.
// Spec §9: any breaking change bumps this integer; renderer supports
// current + previous major.

export const SCHEMA_VERSION = 1 as const;

export interface Cluster {
  id: string;
  label: string;
  color: string;
  size: number;
  /** XZ-plane anchor position [x, z]; Y is computed by the renderer. */
  position: [number, number];
}

export interface FileMeta {
  id: number;
  path: string;
  cluster: string;
  firstCommitIdx: number;
  totalTouches: number;
  aliases?: string[];
}

export interface Commit {
  sha: string;
  short: string;
  ts: number;       // ms epoch
  date: string;     // YYYY-MM-DD
  author: string;
  msg: string;
  /** [fileId, linesAdded, linesRemoved] — unique per commit. */
  touches: Array<[number, number, number]>;
}

/** Weighted co-change edge between two clusters (indices into Dataset.clusters). */
export type ClusterEdge = [number, number, number];

export interface Dataset {
  /** Schema version — renderer must check this before interpreting the rest. */
  schemaVersion: typeof SCHEMA_VERSION;
  meta: {
    repo: string;
    generatedAt: string;
    totalCommits: number;
    firstCommit: string;
    lastCommit: string;
    diskRadius: number;
    config: Record<string, number>;
  };
  clusters: Cluster[];
  clusterEdges: ClusterEdge[];
  files: FileMeta[];
  commits: Commit[];
}
```

Note the one change from the original `src/types.ts`: `Dataset` gains a required `schemaVersion: typeof SCHEMA_VERSION` field. This will compile-fail any consumer that constructs a `Dataset` without the version — which is what we want.

- [ ] **Step 2: Write `src/schema/index.ts`** (barrel export — future versions add here)

```typescript
export * from "./v1.js";
```

- [ ] **Step 3: Verify TypeScript accepts the file in isolation**

```bash
npx tsc --noEmit src/schema/v1.ts src/schema/index.ts
```

Expected: no output = no errors.

Consumers (`src/main.ts`, `src/state.ts`, `src/graph.ts`) still import from the old `src/types.ts` — that's intentional. Task 10 flips them.

- [ ] **Step 4: Commit**

```bash
git add src/schema/v1.ts src/schema/index.ts
git commit -m "feat(schema): add versioned schema module with SCHEMA_VERSION=1"
```

---

### Task 8: Emit `schemaVersion` from the extract pipeline

**Why:** Spec §9 — `data.json` must carry `"schemaVersion": 1` as a top-level field so the renderer can reject incompatible inputs.

**Files:**
- Modify: `pipeline/extract.mjs` (lines 408–425 — the `out = { ... }` block)

- [ ] **Step 1: Add `schemaVersion` as the first field of the output**

In `pipeline/extract.mjs`, find this block (near line 408):

```javascript
const out = {
  meta: {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    ...
```

Change it to:

```javascript
const out = {
  schemaVersion: 1,
  meta: {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    ...
```

(Add one line; the rest of the block is unchanged.)

- [ ] **Step 2: Re-run extract and verify**

```bash
pnpm extract
node -e "const d = require('./public/data.json'); console.log('schemaVersion:', d.schemaVersion)"
```

Expected output: `schemaVersion: 1`

- [ ] **Step 3: Commit**

```bash
git add pipeline/extract.mjs public/data.json
git commit -m "feat(extract): emit schemaVersion: 1 at top of data.json (spec §9)"
```

(We commit the regenerated `data.json` here because downstream tasks use it to verify the renderer still reads correctly. It will be removed from tracking at the end of Phase 1 when runtime caching moves to `.cache/`.)

---

### Task 9: Enforce `schemaVersion` check in the renderer

**Why:** Spec §9 — renderer rejects unknown schema versions with a clear error: `this viewer requires schemaVersion <=1 (got <N>). upgrade the renderer.`

**Files:**
- Modify: `src/main.ts:28-32` (the `loadData` function)

- [ ] **Step 1: Update `loadData` to validate `schemaVersion`**

Current `loadData` (lines 28–32):

```typescript
async function loadData(): Promise<Dataset> {
  const res = await fetch("/data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load data.json: ${res.status}`);
  return res.json();
}
```

Add a new import at the top of the file (line 4, alongside the existing imports):

```typescript
import { SCHEMA_VERSION } from "./schema";
```

Then replace the `loadData` function with:

```typescript
async function loadData(): Promise<Dataset> {
  const res = await fetch("/data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load data.json: ${res.status}`);
  const json = await res.json();
  if (json?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `this viewer requires schemaVersion ${SCHEMA_VERSION} (got ${json?.schemaVersion}). upgrade the renderer.`,
    );
  }
  return json as Dataset;
}
```

Rationale: importing `SCHEMA_VERSION` from the schema module (instead of hardcoding `1`) means the renderer and extract side can never drift. When Phase 1 bumps the schema, one constant moves and both consumers update.

- [ ] **Step 2: Verify the renderer still loads current data.json**

```bash
pnpm dev &
sleep 3
# visit http://localhost:5173 in a browser (or check console):
curl -s http://localhost:5173 | grep -i "codebase evolution"
kill %1
```

Expected: page loads, no schemaVersion error in browser console.

(Since `pnpm extract` in Task 8 already wrote `schemaVersion: 1`, the check passes.)

- [ ] **Step 3: Negative test — break the schema version, confirm error**

```bash
# Temporarily mutate data.json to have schemaVersion: 99
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('public/data.json','utf8'));d.schemaVersion=99;fs.writeFileSync('public/data.json',JSON.stringify(d));"

pnpm dev &
sleep 3
# Check that the page shows the subtitle error. For automated check:
curl -s http://localhost:5173/src/main.ts | head -50 | grep -q "SUPPORTED_SCHEMA_VERSION" && echo "check in place"
kill %1

# Restore correct data.json
pnpm extract
```

Expected: `check in place` printed; after restoring, page loads normally.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts public/data.json
git commit -m "feat(renderer): reject data.json with unsupported schemaVersion"
```

---

### Task 10: Move `src/types.ts` into the schema package

**Why:** Spec Appendix A — `src/types.ts` → `src/schema/v1.ts`. The new file already exists (Task 7); this task updates all consumers and deletes the old file.

**Files:**
- Modify: `src/main.ts:3` (import)
- Modify: `src/state.ts` (imports)
- Modify: `src/graph.ts` (imports)
- Delete: `src/types.ts`

- [ ] **Step 1: Update imports in `src/main.ts`**

Line 3 currently:
```typescript
import type { Dataset } from "./types";
```

Change to:
```typescript
import type { Dataset } from "./schema";
```

- [ ] **Step 2: Update imports in `src/state.ts`**

```bash
grep -n 'from "./types"' src/state.ts
```

Replace every `from "./types"` with `from "./schema"` in `src/state.ts`.

- [ ] **Step 3: Update imports in `src/graph.ts`**

```bash
grep -n 'from "./types"' src/graph.ts
```

Replace every `from "./types"` with `from "./schema"` in `src/graph.ts`.

- [ ] **Step 4: Verify no remaining references to `./types`**

```bash
grep -rn 'from "./types"' src/
```

Expected: no output.

- [ ] **Step 5: Delete the old file**

```bash
rm src/types.ts
```

- [ ] **Step 6: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Smoke test the app**

```bash
pnpm dev &
sleep 3
curl -sI http://localhost:5173 | head -1
kill %1
```

Expected: HTTP 200.

- [ ] **Step 8: Commit**

```bash
git add -A src/
git commit -m "refactor: redirect type imports from ./types to ./schema; remove src/types.ts"
```

---

### Task 11: Move renderer source files into `src/renderer/`

**Why:** Spec Appendix A — `main.ts`, `state.ts`, `graph.ts`, `style.css`, `d3-force-3d.d.ts` all live in `src/renderer/`.

**Files:**
- Move: `src/main.ts` → `src/renderer/main.ts`
- Move: `src/state.ts` → `src/renderer/state.ts`
- Move: `src/graph.ts` → `src/renderer/graph.ts`
- Move: `src/style.css` → `src/renderer/style.css`
- Move: `src/d3-force-3d.d.ts` → `src/renderer/d3-force-3d.d.ts`
- Modify: `index.html` (script and stylesheet paths)

- [ ] **Step 1: Move the files (use `git mv` to preserve history)**

```bash
git mv src/main.ts src/renderer/main.ts
git mv src/state.ts src/renderer/state.ts
git mv src/graph.ts src/renderer/graph.ts
git mv src/style.css src/renderer/style.css
git mv src/d3-force-3d.d.ts src/renderer/d3-force-3d.d.ts

# Remove the now-redundant .gitkeep
git rm src/renderer/.gitkeep
```

- [ ] **Step 2: Update imports inside moved files**

Inside `src/renderer/main.ts`, the import paths like `./graph`, `./state`, `./schema` now need to be re-pointed. The files `graph.ts`, `state.ts` are now siblings — `./graph` and `./state` still resolve. But `./schema` used to mean `src/schema` and now needs to be `../schema`.

```bash
grep -n 'from "./schema"' src/renderer/*.ts
```

For each hit, change `"./schema"` to `"../schema"`:

- `src/renderer/main.ts` line 3 — update
- `src/renderer/state.ts` — update any hits
- `src/renderer/graph.ts` — update any hits

- [ ] **Step 3: Update `index.html`**

Current lines 7 and 63:

```html
<link rel="stylesheet" href="/src/style.css" />
...
<script type="module" src="/src/main.ts"></script>
```

Change to:

```html
<link rel="stylesheet" href="/src/renderer/style.css" />
...
<script type="module" src="/src/renderer/main.ts"></script>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:5173 | grep -q "renderer/main.ts" && echo "OK: html references renderer"
curl -sI http://localhost:5173/src/renderer/main.ts | head -1
kill %1
```

Expected: `OK: html references renderer` printed; HTTP 200 for the renderer module.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move renderer source files into src/renderer/ (spec Appendix A)"
```

---

### Task 12: Move extract pipeline into `src/extract/`

**Why:** Spec Appendix A — `pipeline/extract.mjs` lives at `src/extract/index.mjs`. Phase 0 keeps it as `.mjs`; Phase 1 converts to TypeScript and splits into `walker.ts`, `deltas.ts`, `affinity.ts`, `progress.ts`.

**Files:**
- Move: `pipeline/extract.mjs` → `src/extract/index.mjs`
- Modify: `package.json` (the `"extract"` script)
- Delete: `pipeline/` (now empty)

- [ ] **Step 1: Move the file and update the `ROOT` path**

```bash
git mv pipeline/extract.mjs src/extract/index.mjs
git rm src/extract/.gitkeep
rmdir pipeline
```

Now open `src/extract/index.mjs`. Current line 29:

```javascript
const ROOT = resolve(__dirname, "..");
```

This previously resolved from `pipeline/` → repo root. Now it resolves from `src/extract/` → `src/`. That's one level off. Change to:

```javascript
const ROOT = resolve(__dirname, "..", "..");
```

- [ ] **Step 2: Update `package.json` `extract` script**

In `package.json`, change:

```json
"extract": "node pipeline/extract.mjs",
```

To:

```json
"extract": "node src/extract/index.mjs",
```

- [ ] **Step 3: Verify extract still works end-to-end**

```bash
pnpm extract
node -e "const d = require('./public/data.json'); console.log('schemaVersion:', d.schemaVersion, 'commits:', d.commits.length)"
```

Expected: `schemaVersion: 1 commits: <N>` — same commit count as Task 1 baseline.

- [ ] **Step 4: Smoke test the full flow**

```bash
pnpm dev &
sleep 3
curl -sI http://localhost:5173 | head -1
kill %1
```

Expected: HTTP 200.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move extract pipeline to src/extract/index.mjs"
```

---

### Task 13: Update `vite.config.ts` and `tsconfig.json` for new layout

**Why:** The existing Vite config is minimal and resolves paths relative to project root, so most moves "just work". But `tsconfig.json`'s `include` list may need an update to cover `src/schema/` and `src/extract/`.

**Files:**
- Read and possibly modify: `vite.config.ts`
- Read and possibly modify: `tsconfig.json`

- [ ] **Step 1: Inspect current configs**

```bash
cat vite.config.ts tsconfig.json
```

- [ ] **Step 2: If `tsconfig.json` has an explicit `include` that references `src/**/*.ts`, leave it alone — the new files are still under `src/`.**

If `tsconfig.json` has narrower include like `"include": ["src/main.ts", "src/types.ts"]`, broaden to:

```json
"include": ["src/**/*.ts", "src/**/*.d.ts"]
```

If `tsconfig.json` already has `"include": ["src"]` or `"include": ["src/**/*"]`, no change needed.

- [ ] **Step 3: Verify `vite.config.ts` doesn't hardcode the old `pipeline/` path**

```bash
grep -n "pipeline" vite.config.ts
```

Expected: no output. If any hits, remove/update.

- [ ] **Step 4: Run typecheck and build**

```bash
npx tsc --noEmit
pnpm build
```

Expected: both succeed.

- [ ] **Step 5: Commit (only if files were modified)**

```bash
git status
# if vite.config.ts or tsconfig.json changed:
git add vite.config.ts tsconfig.json
git commit -m "build: update tsconfig/vite config for new src/ layout"
```

If nothing changed, skip the commit and note "no config update needed" in the task log.

---

### Task 14: Apply license headers to all source files

**Why:** Spec §7.3 — "FSL header on every source file. Attribution is non-negotiable." The template lives in `LICENSE.headers.txt` (Task 4).

**Files:** every file under `src/` (`.ts`, `.mjs`, `.d.ts`, `.css`)

- [ ] **Step 1: Enumerate files that need headers**

```bash
find src -type f \( -name '*.ts' -o -name '*.mjs' -o -name '*.d.ts' -o -name '*.css' \) -not -name '.gitkeep'
```

Expected list:
- `src/extract/index.mjs`
- `src/renderer/main.ts`
- `src/renderer/state.ts`
- `src/renderer/graph.ts`
- `src/renderer/d3-force-3d.d.ts`
- `src/renderer/style.css`
- `src/schema/v1.ts`
- `src/schema/index.ts`

- [ ] **Step 2: Prepend the header to each file**

The header is:

```
// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
```

For `.css` files, use CSS comment syntax:

```
/* @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI */
```

One-shot script (run once from repo root):

```bash
TS_HEADER='// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI'
CSS_HEADER='/* @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI */'

for f in \
  src/extract/index.mjs \
  src/renderer/main.ts \
  src/renderer/state.ts \
  src/renderer/graph.ts \
  src/renderer/d3-force-3d.d.ts \
  src/schema/v1.ts \
  src/schema/index.ts
do
  # Skip if already headered
  if head -1 "$f" | grep -q 'FSL-1.1-Apache-2.0'; then continue; fi
  printf '%s\n%s' "$TS_HEADER" "$(cat "$f")" > "$f.tmp" && mv "$f.tmp" "$f"
done

# CSS file
if ! head -1 src/renderer/style.css | grep -q 'FSL-1.1-Apache-2.0'; then
  printf '%s\n%s' "$CSS_HEADER" "$(cat src/renderer/style.css)" > src/renderer/style.css.tmp
  mv src/renderer/style.css.tmp src/renderer/style.css
fi
```

Special case: `src/extract/index.mjs` starts with a shebang `#!/usr/bin/env node`. The header must go **after** the shebang, not before. If the one-shot script above clobbered this, manually fix by editing `src/extract/index.mjs` so line 1 is the shebang and line 2 is the header.

- [ ] **Step 3: Verify every file has the header**

```bash
for f in src/extract/index.mjs src/renderer/{main,state,graph}.ts src/renderer/d3-force-3d.d.ts src/renderer/style.css src/schema/{v1,index}.ts; do
  if grep -q "FSL-1.1-Apache-2.0" "$f"; then
    echo "OK  $f"
  else
    echo "MISSING  $f"
  fi
done
```

Expected: all lines say `OK`.

- [ ] **Step 4: Verify code still compiles and runs**

```bash
npx tsc --noEmit
pnpm extract
pnpm build
```

Expected: all three succeed.

- [ ] **Step 5: Commit**

```bash
git add -A src/
git commit -m "chore: apply FSL-1.1-Apache-2.0 headers to all source files"
```

---

### Task 15: Final end-to-end verification

**Why:** Phase 0 is "mechanical changes, behavior unchanged". This task proves it by running the full current flow and checking the output matches the Task 1 baseline in all meaningful ways.

**Files:** none modified.

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules
pnpm install
```

Expected: no errors.

- [ ] **Step 2: Extract**

```bash
pnpm extract
```

Expected: writes `public/data.json`, prints commit/file/cluster counts.

- [ ] **Step 3: Verify `data.json` has `schemaVersion: 1`**

```bash
node -e "const d=require('./public/data.json');console.log({schemaVersion:d.schemaVersion,commits:d.commits.length,files:d.files.length,clusters:d.clusters.length})"
```

Expected: an object with `schemaVersion: 1` and non-zero counts matching the Task 1 baseline (±0 — extract is deterministic given the same repo state).

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: `dist/` created; no errors.

- [ ] **Step 5: Dev server loads the app**

```bash
pnpm dev &
sleep 3
curl -sI http://localhost:5173 | head -1
curl -s http://localhost:5173/src/renderer/main.ts | head -1 | grep -q "FSL" && echo "header present"
kill %1
```

Expected: HTTP 200; `header present` printed (confirming license header survived the Vite pipeline).

- [ ] **Step 6: Summary**

```bash
git log --oneline $(git log --oneline -1 --format=%H^ | head -1)..HEAD
ls -la LICENSE README.md package.json
find src -type f -not -name '.gitkeep' | sort
```

Expected final tree under `src/`:

```
src/config/.gitkeep
src/cli/.gitkeep
src/export/.gitkeep
src/extract/index.mjs
src/renderer/d3-force-3d.d.ts
src/renderer/graph.ts
src/renderer/main.ts
src/renderer/state.ts
src/renderer/style.css
src/schema/index.ts
src/schema/v1.ts
```

**No commit** — this task is verification only.

---

## Phase 0 Definition of Done

- [ ] `package.json` name is `@cdli/holy-graph`; `"private"` removed.
- [ ] `LICENSE` (FSL-1.1-Apache-2.0) in repo root.
- [ ] Every source file under `src/` begins with the FSL header (Task 14 verification script passes).
- [ ] `README.md` is product-first.
- [ ] `public/data.json` contains `"schemaVersion": 1`.
- [ ] Renderer rejects unknown schema versions with the spec §9 error message.
- [ ] Files are in their §7.1 locations (verified by Task 15 Step 6 tree).
- [ ] `pnpm install && pnpm extract && pnpm build && pnpm dev` all succeed on a fresh clone.
- [ ] No functional regression vs. the Task 1 baseline: same commit count, same cluster count, same visualization behavior.

## What Phase 0 Does NOT Do (by design)

- Does **not** convert `extract.mjs` to TypeScript — Phase 1.
- Does **not** split `renderer/graph.ts` (still 44 kb) — Phase 1.
- Does **not** introduce Vitest or any test framework — Phase 1.
- Does **not** build a CLI binary at `bin/holy-graph` (declared but not implemented) — Phase 1.
- Does **not** create `holy-graph.config.js` loader — Phase 1.
- Does **not** touch the gallery infrastructure — Phase 2.
- Does **not** apply marketing changes beyond the README rewrite — Phase 2.

## Next Phase

After Phase 0 merges, run `superpowers:writing-plans` on the spec again to generate `docs/plans/2026-04-22-phase-1-cli.md`.
