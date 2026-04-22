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
