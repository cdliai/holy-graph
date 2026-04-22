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
