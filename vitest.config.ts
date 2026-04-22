// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Vitest configuration.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.mts", "tests/**/*.test.ts"],
    testTimeout: 10_000, // git operations can be slow in CI
  },
});
