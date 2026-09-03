// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Semantic developer intelligence tools for MCP.
// Exposes temporal coupling, blast radius, hotspot detection, and module graph
// to AI coding agents (Cursor, Claude Code, Antigravity).

import { execFileSync } from "node:child_process";
import { normalize } from "node:path";

import type { Dataset, FileMeta } from "../schema/v1.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "holy_graph_get_cochange_neighbors",
    description:
      "Get files that historically co-change with a given file (temporal coupling). Identifies cross-module architectural bridges and hidden dependencies that static imports often miss.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative or absolute path to the target file.",
        },
        limit: {
          type: "number",
          description: "Maximum number of neighbors to return (default: 10).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "holy_graph_get_blast_radius",
    description:
      "Calculate the architectural blast radius of modified files. Predicts which other files and modules are at high risk of side effects based on historical co-change patterns.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "List of modified file paths. If omitted or empty, automatically inspects git status for dirty/staged files.",
        },
        minAffinity: {
          type: "number",
          description: "Minimum co-change affinity threshold (0.0 to 1.0, default: 0.15).",
        },
      },
    },
  },
  {
    name: "holy_graph_list_hotspots",
    description:
      "List the highest-churn and most central files in the repository. Hotspots represent files with frequent changes and high coupling, indicating refactoring or bug risks.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of hotspots to return (default: 15).",
        },
        cluster: {
          type: "string",
          description: "Optional module/cluster name filter (e.g. 'packages/core').",
        },
      },
    },
  },
  {
    name: "holy_graph_get_module_graph",
    description:
      "Get the high-level architecture overview: all clusters/modules, their file counts, and the strongest cross-module co-change bridges.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "holy_graph_explain_architecture",
    description:
      "Generate an executive architectural breakdown of the codebase: module hierarchy, top cross-module bridges, systemic hotspots, and coupling risks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

interface DatasetIndex {
  pathMap: Map<string, FileMeta>;
  suffixMap: Map<string, FileMeta>;
  fileCommits: Array<number[]>; // fileId -> commit indices
}

const INDEX_CACHE = new WeakMap<Dataset, DatasetIndex>();

/**
 * Constructs or retrieves a memoized inverted index over the dataset.
 *
 * ### Inverted Index Architecture
 * Builds a direct inverted posting list `fileCommits[fileId] = [ci_0, ci_1, ...]`
 * mapping every file ID directly to the commit indices where it was touched.
 *
 * Memoized via a `WeakMap<Dataset, DatasetIndex>`:
 * - Automatically evicted by V8 garbage collector when the parent Dataset is de-referenced.
 * - Guarantees zero memory leaks on reloaded datasets.
 *
 * ### Computational Complexity
 * - **Construction Time**: $\mathcal{O}(F + C \cdot T)$ single pass over dataset.
 * - **Auxiliary Space**: $\mathcal{O}(F + C \cdot T)$ pointers.
 */
export function getOrCreateIndex(dataset: Dataset): DatasetIndex {
  let idx = INDEX_CACHE.get(dataset);
  if (!idx) {
    const pathMap = new Map<string, FileMeta>();
    const suffixMap = new Map<string, FileMeta>();
    const fileCommits: Array<number[]> = Array.from({ length: dataset.files.length }, () => []);

    for (const f of dataset.files) {
      pathMap.set(f.path, f);
      const lastSlash = f.path.lastIndexOf("/");
      if (lastSlash !== -1) {
        suffixMap.set(f.path.substring(lastSlash + 1), f);
      }
      if (f.aliases) {
        for (const alias of f.aliases) {
          pathMap.set(alias, f);
        }
      }
    }

    for (let ci = 0; ci < dataset.commits.length; ci++) {
      for (const [fid] of dataset.commits[ci].touches) {
        if (fid < fileCommits.length) {
          fileCommits[fid].push(ci);
        }
      }
    }

    idx = { pathMap, suffixMap, fileCommits };
    INDEX_CACHE.set(dataset, idx);
  }
  return idx;
}

/**
 * Resolves a file query string against the dataset using a multi-tiered hash index.
 *
 * ### Resolution Hierarchy
 * 1. $\mathcal{O}(1)$ exact path lookup in `pathMap`.
 * 2. $\mathcal{O}(1)$ basename suffix lookup in `suffixMap`.
 * 3. $\mathcal{O}(F)$ fallback linear scan over `dataset.files`.
 *
 * @complexity $\mathcal{O}(1)$ amortized best-case; $\mathcal{O}(F)$ worst-case.
 */
export function findFileInDataset(dataset: Dataset, inputPath: string): FileMeta | null {
  const clean = normalize(inputPath).replace(/^(\.\/|\/)/, "");
  const idx = getOrCreateIndex(dataset);

  // 1. O(1) exact match
  const exact = idx.pathMap.get(clean);
  if (exact) return exact;

  // 2. O(1) filename suffix match
  const lastSlash = clean.lastIndexOf("/");
  const baseName = lastSlash !== -1 ? clean.substring(lastSlash + 1) : clean;
  const suffix = idx.suffixMap.get(baseName);
  if (suffix && (suffix.path === clean || suffix.path.endsWith("/" + clean))) {
    return suffix;
  }

  // 3. Fallback suffix search
  for (const f of dataset.files) {
    if (f.path.endsWith("/" + clean)) return f;
  }
  return null;
}

/**
 * Retrieves uncommitted or staged files in the working tree via `git status --porcelain`.
 *
 * @complexity $\mathcal{O}(D)$ where $D = |\text{dirty files}|$.
 */
export function getDirtyFiles(repo: string): string[] {
  try {
    const stdout = execFileSync("git", ["-C", repo, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const paths: string[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const filePart = line.slice(3).trim();
      // Handle renames in porcelain: "R  old -> new"
      const arrow = filePart.indexOf(" -> ");
      const finalPath = arrow !== -1 ? filePart.slice(arrow + 4) : filePart;
      paths.push(finalPath);
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Computes the empirical temporal coupling neighborhood for a target file.
 *
 * ### Cosine Temporal Coupling Formula
 * For target file $A$ and neighbor $B$, normalized affinity $\rho(A, B)$ is defined as:
 *
 * $$\rho(A, B) = \frac{|\mathcal{C}_A \cap \mathcal{C}_B|}{\sqrt{|\mathcal{C}_A| \cdot |\mathcal{C}_B|}}$$
 *
 * where $\mathcal{C}_X$ is the set of commits touching file $X$.
 *
 * ### Sub-Linear Inverted Query Complexity
 * Utilizing the inverted index `fileCommits[targetId]`, traversal inspects **only**
 * the commits $c \in \mathcal{C}_A$, dropping execution time from $\mathcal{O}(C_{\text{total}})$
 * to $\mathcal{O}(|\mathcal{C}_A| \cdot T_{\text{commit}})$.
 *
 * @complexity $\mathcal{O}(|\mathcal{C}_A| \cdot T + N \log N)$ where $N \le 50$ neighbors returned.
 */
export function handleGetCochangeNeighbors(
  dataset: Dataset,
  args: { path: string; limit?: number },
): {
  target: { id: number; path: string; cluster: string; totalTouches: number };
  neighbors: Array<{
    path: string;
    cluster: string;
    cochangeCount: number;
    affinity: number;
    isCrossModule: boolean;
  }>;
} {
  const target = findFileInDataset(dataset, args.path);
  if (!target) {
    throw new Error(
      `File "${args.path}" was not found in the analyzed Git history. It may be rarely touched (< 2 commits) or excluded by config.`,
    );
  }

  const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
  const targetId = target.id;
  const idx = getOrCreateIndex(dataset);
  const relevantCommits = idx.fileCommits[targetId] ?? [];

  const cochange = new Map<number, { count: number; linesAdded: number; linesRemoved: number }>();

  // Inspect ONLY commits touching targetId (O(K) instead of O(C))
  for (const ci of relevantCommits) {
    const c = dataset.commits[ci];
    for (const [id, added, removed] of c.touches) {
      if (id === targetId) continue;
      const cur = cochange.get(id) ?? { count: 0, linesAdded: 0, linesRemoved: 0 };
      cur.count += 1;
      cur.linesAdded += added;
      cur.linesRemoved += removed;
      cochange.set(id, cur);
    }
  }

  const neighbors = Array.from(cochange.entries())
    .map(([id, stats]) => {
      const other = dataset.files[id];
      // Cosine-like normalized co-change affinity: cochange / sqrt(touchesA * touchesB)
      const affinity = +(
        stats.count / Math.sqrt(target.totalTouches * other.totalTouches)
      ).toFixed(3);
      return {
        path: other.path,
        cluster: other.cluster,
        cochangeCount: stats.count,
        affinity,
        isCrossModule: other.cluster !== target.cluster,
      };
    })
    .sort((a, b) => b.affinity - a.affinity || b.cochangeCount - a.cochangeCount)
    .slice(0, limit);

  return {
    target: {
      id: target.id,
      path: target.path,
      cluster: target.cluster,
      totalTouches: target.totalTouches,
    },
    neighbors,
  };
}

/**
 * Calculates the ripple effect of modified files across architectural domains.
 *
 * ### Graph Neighborhood Expansion
 * Expands a 1-hop empirical coupling frontier from initial seed set $\mathcal{P} \subseteq \mathcal{F}$:
 *
 * $$\mathcal{B} = \left\{ v \in \mathcal{F} \setminus \mathcal{P} \;\middle|\; \max_{u \in \mathcal{P}} \rho(u, v) \ge \tau \right\}$$
 *
 * Architectural risk is categorized by cross-module leakage:
 * - **HIGH**: $\ge 3$ cross-module bridges or $\ge 8$ total impacted files.
 * - **MEDIUM**: $\ge 1$ cross-module bridge or $\ge 3$ total impacted files.
 * - **LOW**: Purely intra-module localized changes.
 *
 * @complexity $\mathcal{O}(|\mathcal{P}| \cdot |\mathcal{C}_p| \cdot T + |\mathcal{B}| \log |\mathcal{B}|)$
 */
export function handleGetBlastRadius(
  dataset: Dataset,
  repo: string,
  args: { paths?: string[]; minAffinity?: number },
): {
  analyzedFiles: string[];
  untrackedOrNewFiles: string[];
  blastRadius: Array<{
    path: string;
    cluster: string;
    impactScore: number;
    coupledTo: string[];
    isCrossModule: boolean;
  }>;
  affectedModules: string[];
  riskAssessment: {
    level: "LOW" | "MEDIUM" | "HIGH";
    crossModuleBridgesCount: number;
    summary: string;
  };
} {
  const minAffinity = args.minAffinity ?? 0.15;
  const inputPaths =
    args.paths && args.paths.length > 0 ? args.paths : getDirtyFiles(repo);

  const analyzedFiles: string[] = [];
  const untrackedOrNewFiles: string[] = [];
  const coupledMap = new Map<
    number,
    { impactSum: number; maxAffinity: number; coupledTo: Set<string> }
  >();

  const targetClusters = new Set<string>();

  for (const p of inputPaths) {
    const f = findFileInDataset(dataset, p);
    if (!f) {
      untrackedOrNewFiles.push(p);
      continue;
    }
    analyzedFiles.push(f.path);
    targetClusters.add(f.cluster);

    const neighbors = handleGetCochangeNeighbors(dataset, {
      path: f.path,
      limit: 30,
    });
    for (const n of neighbors.neighbors) {
      if (n.affinity < minAffinity) continue;
      const other = findFileInDataset(dataset, n.path);
      if (!other || analyzedFiles.includes(other.path)) continue;

      const cur = coupledMap.get(other.id) ?? {
        impactSum: 0,
        maxAffinity: 0,
        coupledTo: new Set<string>(),
      };
      cur.impactSum += n.affinity;
      cur.maxAffinity = Math.max(cur.maxAffinity, n.affinity);
      cur.coupledTo.add(f.path);
      coupledMap.set(other.id, cur);
    }
  }

  const blastRadius = Array.from(coupledMap.entries())
    .map(([id, info]) => {
      const f = dataset.files[id];
      const isCrossModule = !targetClusters.has(f.cluster);
      return {
        path: f.path,
        cluster: f.cluster,
        impactScore: +info.maxAffinity.toFixed(3),
        coupledTo: Array.from(info.coupledTo),
        isCrossModule,
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 20);

  const allAffectedModules = new Set<string>(targetClusters);
  let crossModuleCount = 0;
  for (const item of blastRadius) {
    allAffectedModules.add(item.cluster);
    if (item.isCrossModule) crossModuleCount++;
  }

  let level: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (crossModuleCount >= 3 || blastRadius.length >= 8) {
    level = "HIGH";
  } else if (crossModuleCount >= 1 || blastRadius.length >= 3) {
    level = "MEDIUM";
  }

  const summary =
    level === "HIGH"
      ? `High architectural blast radius: Changes ripple across ${allAffectedModules.size} modules with ${crossModuleCount} cross-module coupling bridges. Thorough cross-system integration testing recommended.`
      : level === "MEDIUM"
        ? `Moderate blast radius: Changes touch coupled files across ${allAffectedModules.size} modules. Verify coupled contracts.`
        : `Localized change: Low ripple effect outside of primary files.`;

  return {
    analyzedFiles,
    untrackedOrNewFiles,
    blastRadius,
    affectedModules: Array.from(allAffectedModules),
    riskAssessment: {
      level,
      crossModuleBridgesCount: crossModuleCount,
      summary,
    },
  };
}

/**
 * Ranks files by churn frequency and cross-module entanglement degree.
 *
 * ### Entanglement Metric Formulation
 * The cross-module entanglement degree $E(f)$ is defined as the cardinality of foreign modules
 * co-committed alongside file $f$:
 *
 * $$E(f) = \left| \bigcup_{c \in \mathcal{C}_f} \left\{ \text{cluster}(g) \mid g \in c, \text{cluster}(g) \ne \text{cluster}(f) \right\} \right|$$
 *
 * Files with high churn and high $E(f)$ constitute systemic architectural debt hotspots.
 *
 * @complexity $\mathcal{O}(C \cdot T + F \log F)$
 */
export function handleListHotspots(
  dataset: Dataset,
  args: { limit?: number; cluster?: string },
): Array<{
  id: number;
  path: string;
  cluster: string;
  totalTouches: number;
  crossModuleBridges: number;
  firstCommitDate: string;
}> {
  const limit = Math.max(1, Math.min(args.limit ?? 15, 100));

  // Compute cross-module coupling degree for each file
  const crossModuleCoupling = new Map<number, Set<string>>();
  for (const c of dataset.commits) {
    const clustersInCommit = new Set<string>();
    for (const [fid] of c.touches) {
      clustersInCommit.add(dataset.files[fid].cluster);
    }
    if (clustersInCommit.size <= 1) continue;

    for (const [fid] of c.touches) {
      const f = dataset.files[fid];
      const cur = crossModuleCoupling.get(fid) ?? new Set<string>();
      for (const otherCluster of clustersInCommit) {
        if (otherCluster !== f.cluster) cur.add(otherCluster);
      }
      crossModuleCoupling.set(fid, cur);
    }
  }

  let candidates = dataset.files;
  if (args.cluster) {
    candidates = candidates.filter((f) => f.cluster === args.cluster);
  }

  return candidates
    .map((f) => ({
      id: f.id,
      path: f.path,
      cluster: f.cluster,
      totalTouches: f.totalTouches,
      crossModuleBridges: crossModuleCoupling.get(f.id)?.size ?? 0,
      firstCommitDate: dataset.commits[f.firstCommitIdx]?.date ?? "unknown",
    }))
    .sort((a, b) => b.totalTouches - a.totalTouches)
    .slice(0, limit);
}

/**
 * Extracts the quotient graph $G = (V_{\text{mod}}, E_{\text{bridge}})$ of architectural modules.
 *
 * @complexity $\mathcal{O}(|V_{\text{mod}}| + |E_{\text{bridge}}|)$ direct mapping.
 */
export function handleGetModuleGraph(dataset: Dataset): {
  clusters: Array<{ id: string; label: string; fileCount: number; color: string }>;
  bridges: Array<{
    source: string;
    target: string;
    affinityWeight: number;
  }>;
} {
  const clusters = dataset.clusters.map((c) => ({
    id: c.id,
    label: c.label,
    fileCount: c.size,
    color: c.color,
  }));

  const bridges = dataset.clusterEdges.map(([sourceIdx, targetIdx, weight]) => ({
    source: dataset.clusters[sourceIdx]?.id ?? String(sourceIdx),
    target: dataset.clusters[targetIdx]?.id ?? String(targetIdx),
    affinityWeight: weight,
  }));

  return { clusters, bridges };
}

/**
 * Synthesizes an executive markdown architectural breakdown for LLM context injection.
 *
 * @complexity $\mathcal{O}(F + C \cdot T)$
 */
export function handleExplainArchitecture(dataset: Dataset): string {
  const modGraph = handleGetModuleGraph(dataset);
  const hotspots = handleListHotspots(dataset, { limit: 5 });

  let out = `# Codebase Architecture Analysis — Holy Graph\n\n`;
  out += `- **Repository:** \`${dataset.meta.repo}\`\n`;
  out += `- **Total Analyzed Commits:** ${dataset.meta.totalCommits.toLocaleString()} (${dataset.meta.firstCommit.slice(0, 10)} → ${dataset.meta.lastCommit.slice(0, 10)})\n`;
  out += `- **Surviving Files:** ${dataset.files.length} across ${modGraph.clusters.length} architectural modules\n\n`;

  out += `## Primary Architectural Modules\n\n`;
  out += `| Module | Files | Proportion |\n|---|---|---|\n`;
  for (const c of modGraph.clusters.slice(0, 10)) {
    const pct = ((c.fileCount / dataset.files.length) * 100).toFixed(1);
    out += `| \`${c.id}\` | ${c.fileCount} | ${pct}% |\n`;
  }

  out += `\n## Key Architectural Bridges (Cross-Module Coupling)\n\n`;
  if (modGraph.bridges.length === 0) {
    out += `No strong cross-module coupling detected. Modules are well-isolated.\n\n`;
  } else {
    out += `These modules co-change frequently, indicating strong temporal coupling:\n\n`;
    for (const b of modGraph.bridges.slice(0, 8)) {
      out += `- **\`${b.source}\`** ⟷ **\`${b.target}\`** (affinity weight: ${b.affinityWeight})\n`;
    }
  }

  out += `\n## Top Architectural Hotspots\n\n`;
  out += `Files with highest churn and cross-module entanglement:\n\n`;
  for (const h of hotspots) {
    out += `- **\`${h.path}\`** (${h.cluster}): ${h.totalTouches} touches, bridges to ${h.crossModuleBridges} other modules\n`;
  }

  return out;
}
