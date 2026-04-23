// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// HTML template manipulation for single-file export.
// Input: the Vite-built single-file `dist/index.html` (already has JS+CSS inlined).
// Output: the same HTML with a `<script type="application/json" id="holy-graph-data">`
//         tag injected before `</body>`, containing the serialized Dataset.

import type { Dataset } from "../schema/v1.js";

const INJECT_MARKER = "</body>";

/**
 * Escape characters that would break out of a JSON-in-HTML script tag.
 * - `<` must be escaped (an HTML parser would otherwise misread `</script>`).
 * - U+2028 and U+2029 must be escaped (invalid in JavaScript source).
 */
function safeJsonForScriptTag(data: Dataset): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function injectDataIntoHtml(html: string, data: Dataset): string {
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf(INJECT_MARKER);
  if (idx === -1) {
    throw new Error(
      `holy-graph: could not find </body> in renderer HTML — build output may be malformed.`,
    );
  }

  const inlineTag =
    `<script type="application/json" id="holy-graph-data">` +
    safeJsonForScriptTag(data) +
    `</script>\n`;

  return html.slice(0, idx) + inlineTag + html.slice(idx);
}