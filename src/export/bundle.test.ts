// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportHtml } from "./bundle.js";
import type { Dataset } from "../schema/v1.js";
import { SCHEMA_VERSION } from "../schema/version.mjs";

const makeDataset = (): Dataset => ({
  schemaVersion: SCHEMA_VERSION,
  meta: {
    repo: "/tmp/test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    totalCommits: 1,
    firstCommit: "2026-01-01T00:00:00.000Z",
    lastCommit: "2026-01-01T00:00:00.000Z",
    diskRadius: 90,
    config: { MAX_FILES_PER_COMMIT: 80, MIN_FILE_TOTAL_TOUCHES: 2 },
  },
  clusters: [],
  clusterEdges: [],
  files: [],
  commits: [],
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), "holy-graph-export-"));
  return dir;
}

describe("exportHtml", () => {
  it("injects data into a minimal HTML shell and writes the output", () => {
    const workdir = tmp();
    const rendererHtmlPath = join(workdir, "renderer.html");
    const outPath = join(workdir, "viz.html");
    writeFileSync(
      rendererHtmlPath,
      `<!doctype html><html><body><div id="app"></div></body></html>`,
    );
    const { bytes } = exportHtml(makeDataset(), { outPath, rendererHtmlPath });
    expect(bytes).toBeGreaterThan(0);
    const out = readFileSync(outPath, "utf8");
    expect(out).toContain(`id="holy-graph-data"`);
    expect(out).toContain(`"schemaVersion":1`);
    expect(out.indexOf(`holy-graph-data`)).toBeLessThan(out.indexOf(`</body>`));
  });

  it("refuses to overwrite an existing file without --force", () => {
    const workdir = tmp();
    const rendererHtmlPath = join(workdir, "renderer.html");
    const outPath = join(workdir, "viz.html");
    writeFileSync(rendererHtmlPath, `<!doctype html><html><body></body></html>`);
    writeFileSync(outPath, "existing");
    expect(() => exportHtml(makeDataset(), { outPath, rendererHtmlPath })).toThrow(
      /already exists. pass --force/,
    );
  });

  it("overwrites when force is set", () => {
    const workdir = tmp();
    const rendererHtmlPath = join(workdir, "renderer.html");
    const outPath = join(workdir, "viz.html");
    writeFileSync(rendererHtmlPath, `<!doctype html><html><body></body></html>`);
    writeFileSync(outPath, "existing");
    expect(() => exportHtml(makeDataset(), { outPath, rendererHtmlPath, force: true })).not.toThrow();
    const out = readFileSync(outPath, "utf8");
    expect(out).toContain(`holy-graph-data`);
  });

  it("errors if the renderer HTML is missing", () => {
    const workdir = tmp();
    const outPath = join(workdir, "viz.html");
    const rendererHtmlPath = join(workdir, "nope.html");
    expect(() => exportHtml(makeDataset(), { outPath, rendererHtmlPath })).toThrow(
      /renderer build not found/,
    );
  });

  it("escapes </script> sequences in data", () => {
    const workdir = tmp();
    const rendererHtmlPath = join(workdir, "renderer.html");
    const outPath = join(workdir, "viz.html");
    writeFileSync(rendererHtmlPath, `<!doctype html><html><body></body></html>`);
    const data = makeDataset();
    // Insert a nasty string into an author field
    data.commits = [
      {
        sha: "0".repeat(40),
        short: "0000000",
        ts: 0,
        date: "2026-01-01",
        author: "attacker</script><script>alert(1)</script>",
        msg: "evil",
        touches: [],
      },
    ];
    exportHtml(data, { outPath, rendererHtmlPath });
    const out = readFileSync(outPath, "utf8");
    // Inside the embedded JSON, `<` must have been escaped
    expect(out).not.toContain(`attacker</script>`);
    expect(out).toContain(`\\u003c/script>`);
  });
});
