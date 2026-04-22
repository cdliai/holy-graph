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
