// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Regression test: whatever we ship, the extract output must keep these shape invariants.
// Runs against public/data.json (committed, produced by the current extract). If this
// test fails after the refactor, the refactor broke backward compatibility.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { SCHEMA_VERSION } from "../schema/version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, "../../public/data.json"), "utf8");
const data = JSON.parse(raw);

describe("extract output shape (regression anchor)", () => {
  it("carries the current SCHEMA_VERSION", () => {
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("has a meta object with required fields and UPPER_SNAKE config keys", () => {
    expect(data.meta).toMatchObject({
      repo: expect.any(String),
      generatedAt: expect.any(String),
      totalCommits: expect.any(Number),
      firstCommit: expect.any(String),
      lastCommit: expect.any(String),
      diskRadius: expect.any(Number),
      config: expect.any(Object),
    });
    // External schema uses UPPER_SNAKE keys (TypeScript DeltaConfig is internally
    // camelCase). Keep this assertion — it caught a drift during Plan 1A.
    expect(data.meta.config).toHaveProperty("MAX_FILES_PER_COMMIT");
    expect(data.meta.config).toHaveProperty("MIN_FILE_TOTAL_TOUCHES");
  });

  it("clusters array — non-empty, each has id/label/color/size/position", () => {
    expect(Array.isArray(data.clusters)).toBe(true);
    expect(data.clusters.length).toBeGreaterThan(0);
    for (const c of data.clusters) {
      expect(c).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        size: expect.any(Number),
        position: expect.arrayContaining([expect.any(Number)]),
      });
      expect(c.position).toHaveLength(2);
    }
  });

  it("files array — non-empty, each has id/path/cluster/firstCommitIdx/totalTouches", () => {
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBeGreaterThan(0);
    for (const f of data.files) {
      expect(f).toMatchObject({
        id: expect.any(Number),
        path: expect.any(String),
        cluster: expect.any(String),
        firstCommitIdx: expect.any(Number),
        totalTouches: expect.any(Number),
      });
    }
  });

  it("commits array — non-empty, each has sha/short/ts/date/author/msg/touches", () => {
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThan(0);
    for (const c of data.commits) {
      expect(c).toMatchObject({
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        short: expect.stringMatching(/^[0-9a-f]{7}$/),
        ts: expect.any(Number),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        author: expect.any(String),
        msg: expect.any(String),
        touches: expect.any(Array),
      });
      for (const [fid, added, removed] of c.touches) {
        expect(typeof fid).toBe("number");
        expect(typeof added).toBe("number");
        expect(typeof removed).toBe("number");
      }
    }
  });

  it("clusterEdges array — shape is [clusterIdxA, clusterIdxB, weight]", () => {
    expect(Array.isArray(data.clusterEdges)).toBe(true);
    for (const e of data.clusterEdges) {
      expect(e).toHaveLength(3);
      const [a, b, w] = e;
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("number");
      expect(typeof w).toBe("number");
      expect(w).toBeGreaterThan(0);
    }
  });

  it("file firstCommitIdx is within bounds", () => {
    for (const f of data.files) {
      expect(f.firstCommitIdx).toBeGreaterThanOrEqual(0);
      expect(f.firstCommitIdx).toBeLessThan(data.commits.length);
    }
  });

  it("commit touches reference valid file ids", () => {
    for (const c of data.commits) {
      for (const [fid] of c.touches) {
        expect(fid).toBeGreaterThanOrEqual(0);
        expect(fid).toBeLessThan(data.files.length);
      }
    }
  });
});
