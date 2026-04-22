// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION } from "./version.mjs";

describe("schema version", () => {
  it("is the literal 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
