// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Renderer build config. Produces a single-file dist/index.html with all
// JS+CSS inlined — the CLI's export command reads that file, injects data,
// and emits the final shareable artifact.

import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    target: "es2022",
    // Emit a single .html with everything inlined — simpler than wiring
    // asset inlining ourselves in the export command.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [viteSingleFile()],
});
