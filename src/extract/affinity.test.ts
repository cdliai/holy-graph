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
