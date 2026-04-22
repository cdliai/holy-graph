---
title: Holy Graph — Productization Design
date: 2026-04-22
status: draft
author: Fatih Burak Karagöz (CDLI)
license: FSL-1.1-Apache-2.0
---

# Holy Graph — Productization Design

## 1. Summary

Holy Graph is a 3D visualization that replays a codebase's git history commit by commit. This document captures the design decisions to ship it as `@cdli/holy-graph` — a local-first, source-available CLI tool with a public gallery, AI-native integration surface (later), and a deliberate path to a commercial product (later still).

v1.0 is not directly monetized. It is a brand-building artifact, a viral top-of-funnel asset, and the demo surface of a future commercial product. FSL licensing keeps the commercial path open.

## 2. Positioning

**What this is:**

- A **local-first developer tool.** User runs it on their own machine; repo content never leaves disk. This is a product feature, not an implementation detail.
- A **viral, shareable artifact.** `--out viz.html` produces a single self-contained HTML that drags, drops, emails, embeds.
- A **public gallery** of pre-rendered animations of well-known repos (React, Linux, Next.js, TypeScript, Rails, Vite) hosted at `holygraph.cdli.ai`.
- **Top-of-funnel** for CDLI's future commercial products.

**What this is not (yet):**

- A paid product. No payment gateway at v1.x.
- A hosted SaaS for private repos. Local-first is a feature, not a gap.
- A general-purpose git visualizer. It is opinionated: clusters, co-change, decay, activity.

## 3. Goals

1. `npx @cdli/holy-graph` in any git repo works with zero configuration.
2. Single-file HTML export enables viral, low-friction sharing.
3. Six pre-rendered gallery repos ship with v1.0 as launch fuel.
4. FSL-licensed source-available distribution protects the commercial path.
5. Clean architectural boundaries; original code; functionality-first.

## 4. Non-goals (v1.0)

- GitHub Action for user repos — deferred to v1.1.
- MCP server — deferred to v1.2.
- Team / hosted dashboards — v2.0, traction-gated.
- Paid tier — v2.0.
- Private repo analysis as a service — never. Local-first is the whole point.

## 5. License Decision

**Chosen:** FSL-1.1-Apache-2.0 (Functional Source License, Apache 2.0 conversion).

**Rationale:**

- Source-available → developer trust, debuggability, fork-ability.
- Competitive-use restriction → a cloud vendor cannot SaaS-ify this without a separate license.
- 2-year auto-conversion to Apache 2.0 → long-term OSS credibility.
- Precedent: Sentry, Convex, Keygen ship under FSL; legally authored by Heather Meeker.

**Costs (accepted):**

- Non-OSI label. GitHub shows "Other" license. Discovery slightly reduced vs. MIT/Apache.
- Some OSS contributors will skip non-OSI projects. PR throughput will likely be lower than an MIT project's.
- Outside contributor CLA will be needed before the first external PR merges, to keep future relicensing options clean.

Accepted because v2.0 commercial protection outweighs the community-contribution cost at this stage. CLA text is a deferred decision (see §14).

## 6. Naming & Branding

| Surface | Value |
|---|---|
| Package name | `@cdli/holy-graph` |
| Public product name | Holy Graph |
| Binary name | `holy-graph` |
| Domain | `holygraph.cdli.ai` |
| Org brand | CDLI (`cdli.ai`) |

The wordmark in `public/holy-graph.png` has been updated from "GENERIC" to "HOLY GRAPH". The same mockup is ported into the landing page hero in Phase 2.

Every source file carries a one-line header: `// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) CDLI`. The CLI emits a one-line banner on start with the version and license. Attribution is non-negotiable.

## 7. Architectural Discipline

The user directive: **no random code in random places.** The rules below are binding for v1.0 and all subsequent development.

### 7.1 Package Structure

```
@cdli/holy-graph/
  src/
    cli/              # command-line entry (Node only)
      index.ts        # bin entry; arg parsing; dispatch
      serve.ts        # default zero-config dev server
      export.ts       # --out HTML export command
      errors.ts       # user-facing error messages
    extract/          # git log → dataset (Node only)
      walker.ts       # git log walking + rename resolution
      deltas.ts       # per-commit delta computation
      affinity.ts     # cluster-cluster affinity
      progress.ts     # progress reporting
      index.ts        # public API: extract(path, opts): Dataset
    renderer/         # browser-only visualization
      main.ts         # boot + UI wiring
      graph.ts        # three.js scene + d3-force sim
      state.ts        # replay state, decay, top-K caps
      types.ts        # shared type defs
      style.css
    export/           # single-file HTML generation (Node only)
      bundle.ts       # inline JS + data into HTML shell
      template.ts     # HTML scaffold
    config/
      schema.ts       # holy-graph.config.js shape + defaults
      loader.ts       # config discovery + merging
    schema/
      v1.ts           # data.json v1 type definitions
  gallery/            # static site for holygraph.cdli.ai (separate build)
    landing/
    repos/
      react/
      linux/
      nextjs/
      typescript/
      rails/
      vite/
    shared/           # shared renderer bundle, styles, assets
  .github/workflows/
    gallery-refresh.yml  # weekly cron
  bin/holy-graph
  LICENSE
  LICENSE.headers.txt   # per-file header template
  README.md
  package.json
```

### 7.2 Boundary Rules (enforced, not aspirational)

1. `cli/` imports `extract/`, `export/`, `config/`, `schema/`. **Never** `renderer/`.
2. `renderer/` imports `schema/` and its own modules. **No Node imports.** Runs in browsers and in the bundled HTML.
3. `extract/` imports `schema/` and Node stdlib. Dependency-light.
4. `export/` is the bridge: it takes a built `renderer/` bundle + a `data.json` and emits a single HTML.
5. `config/` is the only user-facing knob surface. Internal constants stay inside the module that uses them; they do not leak to CLI flags.
6. `schema/` is the contract between `extract/` and `renderer/`. Breaking it requires a schema version bump (§9).

### 7.3 Coding Guidelines

- **One-purpose files.** If a file does two things, split it before it grows. `renderer/graph.ts` is already 44k — it will be split as part of Phase 1 (proposed: `scene.ts`, `layout.ts`, `edges.ts`, `nodes.ts`, `hud.ts`). This split is the only refactor we do during productization; everything else carries over.
- **Original code.** No Stack Overflow copy-paste without understanding. Prefer writing fresh over "looks about right".
- **Functionality first.** No speculative abstractions, no framework-building, no config-for-things-nobody-configures. Three similar lines is fine; the fourth triggers a refactor conversation.
- **No dead code.** If a branch isn't reachable, delete it. A TODO older than two weeks gets fixed or deleted.
- **Comments only when the WHY is non-obvious.** Don't narrate WHAT; the code already says that.
- **Tests on the boundary, not the internals.** Test `extract()` contracts, `renderer/` state transitions, `export/` output shape — not internal helpers.
- **Author identity preserved.** FSL header on every source file. CLI banner. CDLI attribution in gallery footer and OG cards.

## 8. CLI Design

### 8.1 Invocation Matrix

```bash
# zero-config: analyze cwd's .git
npx @cdli/holy-graph

# explicit path
npx @cdli/holy-graph ~/code/react

# export single-file HTML (no server)
npx @cdli/holy-graph --out viz.html

# dev server port override
npx @cdli/holy-graph --port 3000

# commit range for large repos
npx @cdli/holy-graph --since 2024-01-01

# MCP mode — reserved, v1.2
npx @cdli/holy-graph mcp
```

### 8.2 Flag Surface (locked for v1.0)

| Flag | Purpose | Default |
|---|---|---|
| `[path]` | repo root (positional) | `process.cwd()` |
| `--out <file>` | HTML export file; implies no-serve | *(unset → serve mode)* |
| `--port <n>` | dev server port | `5173` |
| `--since <date>` | filter commits `>= date` | *(unset)* |
| `--config <path>` | config file path | auto-detect `holy-graph.config.{js,mjs}` |
| `--version` | print version + license | — |
| `--help` | usage | — |

### 8.3 Out-of-scope flags (they live in `holy-graph.config.js`)

`HALF_LIFE_ACT_DAYS`, `HALF_LIFE_EDGE_DAYS`, `MAX_FILES_PER_COMMIT`, `MIN_FILE_TOTAL_TOUCHES`, `EXCLUDE`, `MAX_LIVE_NODES`, `MAX_LIVE_EDGES`, `ACTIVITY_Y_GAIN`, `CLUSTER_PULL_STRENGTH`.

These are advanced tuning parameters. Surfacing them as CLI flags would bloat the surface area, confuse new users, and make `--help` unreadable. Config file only.

### 8.4 Error Surface (user-visible messages)

| Condition | Message |
|---|---|
| No `.git` at path | `holy-graph: no .git directory found at <path>. run inside a git repository or pass a path.` |
| Shallow clone | *(warn, continue)* `shallow clone detected; only <N> commits available.` |
| Empty repo | `holy-graph: repo has no commits.` |
| Port in use | *(try next port, announce)* `port 5173 busy; serving on 5174.` |
| Export file exists | `holy-graph: <file> already exists. pass --force to overwrite.` |
| Config file parse error | `holy-graph: failed to load <path>: <reason>` |

Error text is user-facing product copy, not dev logs. No stack traces by default; `DEBUG=holy-graph` env var reveals them.

## 9. Data Schema & Versioning

`data.json` gains a top-level field: `"schemaVersion": 1`.

**Renderer policy:** accept `schemaVersion === 1`. Unknown versions fail fast with: `this viewer requires schemaVersion <=1 (got <N>). upgrade the renderer.`

**Evolution rule:** any breaking change to `data.json` bumps the integer. Renderer supports *current + previous* major. Two-version window gives users time to regenerate.

**What counts as breaking:** removing a field, renaming a field, changing a field's type, changing the semantics of an existing field. Additive changes (new optional fields) do not bump.

## 10. Three.js Bundling Strategy

Two distribution modes. Each one makes a different tradeoff, deliberately.

### 10.1 Single-file HTML export (`--out viz.html`)

- three.js + renderer bundle **inlined** in the HTML.
- Base size ~1 MB; grows with data.json size.
- Rationale: offline, archive-safe, drag-droppable. The user explicitly opted into single-file by passing `--out`; they are choosing self-containment over size.
- CLI warns if output exceeds 10 MB: `export is 12.4 MB — consider --since or config EXCLUDE to shrink.`

### 10.2 Gallery site (`holygraph.cdli.ai`)

- three.js loaded from CDN: `<script src="https://unpkg.com/three@0.163.0/build/three.min.js">`.
- Renderer bundle hosted under `holygraph.cdli.ai/shared/renderer-<hash>.js`, shared across all gallery pages.
- Each gallery page loads only its own `data.json`.
- Rationale: shared cache = fast TTI after the first page; total bandwidth is minimized across the gallery.

The two use cases have inverse constraints. Archive artifacts value self-containment. A multi-page gallery values cache efficiency.

## 11. Gallery

### 11.1 v1.0 Gallery Targets

React · Linux · Next.js · TypeScript · Rails · Vite

Each target has:

- Pre-rendered `data.json` (checked into `gallery/repos/<name>/data.json`).
- A dedicated page at `holygraph.cdli.ai/gallery/<name>`.
- A 30-second recorded `.mp4` embedded on the page and used for social (X, HN, dev.to).
- A "last refreshed: YYYY-MM-DD" timestamp in the footer.

### 11.2 Refresh Cron — critical

Without refresh, gallery rots in ~6 months. This is not optional.

GitHub Action at `.github/workflows/gallery-refresh.yml`, scheduled weekly:

1. For each target repo: `git pull` (or clone if first run) into a workspace.
2. Run `extract()` with the config used in v1.0.
3. Diff the produced `data.json` against the committed one.
4. If changed: commit the new `data.json`, update the footer timestamp, deploy.
5. If a run fails: open a GitHub issue tagged `gallery-refresh`.

Failure mode monitoring: if a target fails three consecutive runs, the gallery page banners `data may be stale` and an alert is raised.

### 11.3 Contingency

If Phase 2 slips, ship v1.0 with **3 gallery repos** (React, Linux, Next.js). Fill the remaining 3 in v1.0.1, within two weeks post-launch. This keeps the launch on schedule; it does not cancel the gallery concept.

## 12. Marketing Assets

### 12.1 Launch collateral (Phase 2)

- **Hero image:** existing `public/holy-graph.png` (now with HOLY GRAPH wordmark), ported into the landing page.
- **Gallery videos:** 6 × 30-second recordings, one per repo. Real product captures — no fake-UI synthesis.
- **Launch video (~60 sec):** narrative walkthrough — problem setup → CLI invocation → gallery showcase → CTA. Script written manually. Visual production may use AI tools (Veo 3, Sora, nano-banana) for composite / motion layers only, wrapped around real product captures. Never AI-rendered fake UI.
- **Social card:** OG image for `holygraph.cdli.ai`.
- **Launch copy:** Show HN post, X launch thread, dev.to article — all drafted before launch day.

### 12.2 Principles

- Real product footage is the core. AI as composite / motion enhancement, not product facsimile.
- Every asset ends with a link to `holygraph.cdli.ai`.
- "by CDLI" attribution consistent across all assets.

## 13. Phased Roadmap

Timeline: 3-4 weeks. Aggressive by advisor review; contingency in §11.3 if Phase 2 slips.

### Week 1 — Phase 0: Cleanup

- Rename `package.json`: `track-animation` → `@cdli/holy-graph`. Scoped publish.
- Replace `LICENSE` with FSL-1.1-Apache-2.0.
- Add per-file license headers.
- Add `"schemaVersion": 1` to `data.json`; update `extract/` to emit it; update `renderer/` to check it.
- Add `bin` entry in `package.json` pointing at `dist/cli/index.js`.
- README: product-first rewrite. One-liner pitch, GIF, three install lines, then detail.
- Move existing files into the §7.1 structure (see Appendix A). Mechanical move; behavior unchanged.

### Week 2-3 — Phase 1: CLI v1.0

- `cli/index.ts`: arg parser (minimal — no heavy framework), dispatch to `serve` or `export`.
- `cli/serve.ts`: zero-config, runs extract (with progress bar) → writes to temp → serves via an embedded static HTTP server (no framework, just Node stdlib + the prebuilt renderer bundle).
- `cli/export.ts`: runs extract → builds renderer bundle → inlines both into single HTML → writes to `--out`.
- `cli/errors.ts`: error message catalog from §8.4.
- `config/loader.ts`: discover and load `holy-graph.config.{js,mjs}`, merge with defaults, validate.
- `extract/progress.ts`: single-line progress in TTY; silent in non-TTY.
- Split `renderer/graph.ts` per §7.3.
- Exit criteria: `npx @cdli/holy-graph` works on React repo; `--out viz.html` produces a working self-contained file.

### Week 3 — Phase 2: Gallery + Landing

- Port `public/holy-graph.png` mockup to HTML/CSS at `gallery/landing/`.
- Build `gallery/shared/` renderer bundle; each gallery page is ~20 lines of HTML + a `data.json`.
- Pre-render 6 `data.json`s (React, Linux, Next.js, TypeScript, Rails, Vite).
- Record 6 × 30-sec `.mp4`s.
- Deploy `holygraph.cdli.ai` via Vercel / Cloudflare Pages (cheap static host, TBD).
- Implement `.github/workflows/gallery-refresh.yml`.

### Week 4 — v1.0 Launch

- Show HN post (Tuesday/Wednesday morning PT).
- X launch thread with gallery video embeds.
- dev.to long-form article (technical angle: co-change decay, cross-cluster edges).
- Gallery is the primary CTA; CLI is the secondary.

### Post-launch

- **v1.1 (~2 wks):** `cdli/holy-graph-action@v1` GitHub Action for user repos. CI-integrated.
- **v1.2 (~1 wk):** MCP server. Tools: `list_hot_files`, `get_cochange_neighbors`, `get_module_graph`, `get_file_history`. Claude Code / Cursor / Zed integration guide.
- **v2.0 (traction-gated):** commercial surface — team dashboard / archaeology reports / refactor risk. Path chosen from v1.x behavior signal.

## 14. Versioning Policy

- **Package:** semver. `0.x.y` during Phase 0-2. Promote to `1.0.0` at launch once CLI surface and output format are stable.
- **Data schema:** integer `schemaVersion`. Renderer supports current + previous major.
- **CLI flags:** additions are minor. Removals / renames are major (bump to 2.0.0).
- **MCP tool namespace:** versioned (`holy_graph.v1.list_hot_files`).
- **Gallery data:** regenerated weekly by cron; no version numbers, last-refresh timestamp on each page.

## 15. Tradeoffs (Honest List)

1. **FSL non-OSI friction.** Some contributors will skip. Accepted for commercial-path protection.
2. **Aggressive timeline.** 3-4 weeks is ~2x optimistic by external review. Contingency: §11.3 scope cut.
3. **Single-file HTML size.** ~1 MB + data. Fine for the sharing use case; CLI warns above 10 MB.
4. **Gallery staleness.** Cron mitigates but doesn't eliminate. Monitoring in §11.2.
5. **Brand concentration.** If Holy Graph flops, the name is tied to the attempt. CDLI as umbrella brand is the durable asset; product names can rotate.
6. **No tests at shipping.** v1.0 ships with smoke tests only — enough to block obvious regressions. Proper test coverage arrives incrementally post-launch. Accepted because functionality-first; not accepted indefinitely.

## 16. Deferred Decisions

- Payment gateway (v2.0).
- Commercial product shape (v2.0, behavior-gated).
- CLA text for outside contributors (before first external PR).
- Analytics on gallery site (v1.1; privacy-respecting — Plausible or similar; no GA).
- Static host choice (Vercel vs. Cloudflare Pages) — Phase 2 decision.
- Whether to mirror the source repo on a separate GitHub org (`cdli-holygraph`) vs. stay under `cdli/` — naming cosmetic, deferred.

## 17. Open Questions

None at spec-write time. All blockers resolved during brainstorming.

---

## Appendix A — File-Level Migration Map

Current → target locations. Moves are mechanical; behavior is unchanged at Phase 0.

| Current | Target |
|---|---|
| `pipeline/extract.mjs` | split into `src/extract/{walker,deltas,affinity,progress,index}.ts` |
| `src/main.ts` | `src/renderer/main.ts` |
| `src/graph.ts` (44k) | split into `src/renderer/{scene,layout,edges,nodes,hud}.ts` |
| `src/state.ts` | `src/renderer/state.ts` |
| `src/types.ts` | `src/schema/v1.ts` + `src/renderer/types.ts` (renderer-internal types stay; schema types move) |
| `src/style.css` | `src/renderer/style.css` |
| `src/d3-force-3d.d.ts` | `src/renderer/d3-force-3d.d.ts` |
| `index.html` | `gallery/landing/index.html` + `src/renderer/template.ts` (extract shared shell) |
| `public/data.json` | gitignored after Phase 0; written to `.cache/` at runtime |
| `public/holy-graph.png` | `gallery/landing/assets/hero.png` |
| `vite.config.ts` | updated for new paths |

## Appendix B — Immediate Next Step

After user review of this spec, transition to `superpowers:writing-plans` skill to produce a step-by-step implementation plan bound to this design.
