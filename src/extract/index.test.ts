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
    // Enough commits so the renamed file exceeds minFileTotalTouches=2 (default)
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
