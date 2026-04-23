// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// CLI bundle config — compiles src/cli/index.ts (with its extract/config/export
// dependencies) into a single executable dist/cli/index.js with a shebang.

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  outDir: "dist/cli",
  target: "node20",
  platform: "node",
  clean: false, // Preserve dist/index.html from vite build
  shims: true, // provide __dirname etc. in ESM
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Everything TypeScript under src/ is bundled into the CLI.
  // Node built-ins (node:*) are externalized automatically by tsup.
});
