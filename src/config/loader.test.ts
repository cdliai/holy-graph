// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "./loader.js";
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

  it("throws when an explicit --config path does not exist", async () => {
    const cwd = tmp();
    await expect(loadConfig(cwd, "/nowhere/missing.config.mjs")).rejects.toThrow(
      /config file not found/,
    );
  });

  it("rejects unknown top-level keys", async () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, "holy-graph.config.mjs"),
      `export default { foobar: 123 };\n`,
    );
    await expect(loadConfig(cwd)).rejects.toThrow(/unknown config key "foobar"/);
  });
});
