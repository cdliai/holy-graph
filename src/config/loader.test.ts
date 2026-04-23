// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "./loader.js";
import { CliError } from "../cli/errors.js";
import { DEFAULT_DELTA_CONFIG } from "../extract/deltas.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), "holy-graph-config-"));
  return dir;
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const cwd = tmp();
    const cfg = await loadConfig(cwd);
    expect(cfg.sourcePath).toBeNull();
    expect(cfg.port).toBe(5173);
    expect(cfg.extract.maxFilesPerCommit).toBe(DEFAULT_DELTA_CONFIG.maxFilesPerCommit);
    expect(cfg.since).toBeUndefined();
  });

  it("loads holy-graph.config.mjs with a default export", async () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, "holy-graph.config.mjs"),
      `export default { port: 3000, since: "2024-01-01" };\n`,
    );
    const cfg = await loadConfig(cwd);
    expect(cfg.sourcePath).toBe(join(cwd, "holy-graph.config.mjs"));
    expect(cfg.port).toBe(3000);
    expect(cfg.since).toBe("2024-01-01");
  });

  it("merges partial extract overrides into DEFAULT_DELTA_CONFIG", async () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, "holy-graph.config.mjs"),
      `export default { extract: { maxFilesPerCommit: 20 } };\n`,
    );
    const cfg = await loadConfig(cwd);
    expect(cfg.extract.maxFilesPerCommit).toBe(20);
    // Other extract defaults preserved
    expect(cfg.extract.minFileTotalTouches).toBe(DEFAULT_DELTA_CONFIG.minFileTotalTouches);
    expect(cfg.extract.exclude).toEqual(DEFAULT_DELTA_CONFIG.exclude);
  });

  it("loads an explicit --config path", async () => {
    const cwd = tmp();
    mkdirSync(join(cwd, "elsewhere"), { recursive: true });
    const cfgPath = join(cwd, "elsewhere", "my.config.mjs");
    writeFileSync(cfgPath, `export default { port: 9999 };\n`);
    const cfg = await loadConfig(cwd, cfgPath);
    expect(cfg.sourcePath).toBe(cfgPath);
    expect(cfg.port).toBe(9999);
  });

  it("throws CliError when an explicit --config path does not exist", async () => {
    const cwd = tmp();
    const err = await loadConfig(cwd, "/nowhere/missing.config.mjs").catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("CONFIG_PARSE_ERROR");
    expect(err.message).toMatch(/config file not found/);
  });

  it("rejects unknown top-level keys as CliError", async () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, "holy-graph.config.mjs"),
      `export default { foobar: 123 };\n`,
    );
    const err = await loadConfig(cwd).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("CONFIG_PARSE_ERROR");
    expect(err.message).toMatch(/unknown config key "foobar"/);
  });
});
