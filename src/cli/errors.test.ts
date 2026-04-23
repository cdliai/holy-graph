// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, expect, it } from "vitest";
import { CliError, errors } from "./errors.js";

describe("CliError catalog", () => {
  it("tags the error with its code", () => {
    const e = errors.noGitDir("/tmp/x");
    expect(e).toBeInstanceOf(CliError);
    expect(e.code).toBe("NO_GIT_DIR");
    expect(e.name).toBe("CliError");
  });

  it.each([
    ["noGitDir", errors.noGitDir("/tmp/x"), /no \.git directory found at \/tmp\/x/],
    ["emptyRepo", errors.emptyRepo(), /repo has no commits/],
    ["exportExists", errors.exportExists("out.html"), /out\.html already exists/],
    ["portInUse", errors.portInUse(5173, 5174), /port 5173 busy; serving on 5174/],
    ["invalidArgs", errors.invalidArgs("bad --out"), /holy-graph: bad --out/],
    ["rendererMissing", errors.rendererMissing("/p/dist/index.html"), /renderer build not found/],
    ["shallowClone", errors.shallowClone(42), /shallow clone detected; only 42 commits/],
    ["configParseError", errors.configParseError("/c.mjs", "bad syntax"), /failed to load \/c\.mjs: bad syntax/],
  ])("%s formats as expected", (_, err, re) => {
    expect(err.message).toMatch(re);
  });
});
