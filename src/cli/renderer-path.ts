// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Shared renderer HTML path resolution. The bundled CLI lives at
// dist/cli/index.js; the Vite-built renderer sits at dist/index.html.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url always points at the actual module file, regardless of
// how the CLI was invoked (directly, via npx, or through a package-manager
// .bin shim). process.argv[1] does not: via a .bin shim it is
// node_modules/.bin/holy-graph, and two ".." steps from there land in
// node_modules/, not in the package's dist/ directory.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export function defaultRendererHtml(): string {
  // MODULE_DIR is dist/cli/ in the shipped bundle; ../index.html is dist/index.html.
  return resolve(MODULE_DIR, "..", "index.html");
}
