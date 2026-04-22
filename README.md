# Codebase Evolution

A 3D visualisation that replays a codebase's history commit by commit. Each
file is a glowing point; co-changing files link up; modules cluster; hot
files float above the plane. Not a git-log viewer — a semantic view of how
the architecture grew.

## What's on screen

- **Points** — source files. Colour = module (e.g. `apps/atlas`), size =
  recent activity (decays over time), height = how hot the file is right now.
- **Dim lines** — files in the same module that change together.
- **Bright lines** — cross-module co-change. These are the architectural
  bridges worth watching.
- **Rings** — a bright one means a file was just born, a softer one means it
  was just touched.
- **Sparks** flying along edges = signal rippling out from a file touched in
  the current commit toward its strongest co-change neighbours.
- **Beacons** mark each module's home. Hover a point or beacon for details.

## Quick start

```bash
pnpm install
pnpm extract          # reads ../monorepo, writes public/data.json
pnpm dev              # http://localhost:5173

# point at a different repo
REPO=/path/to/repo pnpm extract
```

## How it works

1. `pipeline/extract.mjs` walks `git log --numstat -M70%`, resolves renames
   into stable file ids, and emits per-commit deltas plus cluster-cluster
   affinity.
2. The client (`src/state.ts`) replays those deltas with time-based decay on
   activity and edge weights.
3. The renderer (`src/graph.ts`) lays clusters out with a d3-force sim seeded
   by affinity, and a second sim places files inside each cluster. Three.js
   draws the lot.

## Knobs

Tune these if the extract feels off:

| File | Setting | Effect |
| ---- | ------- | ------ |
| `pipeline/extract.mjs` | `MAX_FILES_PER_COMMIT` | drop bulk-rewrite commits |
| `pipeline/extract.mjs` | `MIN_FILE_TOTAL_TOUCHES` | prune rarely-touched files |
| `pipeline/extract.mjs` | `EXCLUDE` | path regexes to ignore |
| `src/state.ts` | `HALF_LIFE_ACT_DAYS` | how fast a file's glow fades |
| `src/state.ts` | `HALF_LIFE_EDGE_DAYS` | how fast co-change ties fade |
| `src/state.ts` | `MAX_LIVE_NODES` / `MAX_LIVE_EDGES` | top-K caps for perf |
| `src/graph.ts` | `ACTIVITY_Y_GAIN` | how high hot files float |
| `src/graph.ts` | `CLUSTER_PULL_STRENGTH` | how tightly modules cluster |

## Controls

Drag to orbit, scroll to zoom, right-drag to pan. Play/scrub from the HUD.
Click a module chip to zoom into it, a hot file to focus on it, or
double-click anywhere to reset.
