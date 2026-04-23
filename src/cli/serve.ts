// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Zero-config serve mode. Extracts the target repo and serves the built
// renderer (dist/index.html) plus the extracted /data.json over HTTP.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type { Dataset } from "../schema/v1.js";
import { extract } from "../extract/index.js";
import type { LoadedConfig } from "../config/loader.js";
import { errors } from "./errors.js";

export interface ServeOptions {
  repo: string;
  port: number;
  since?: string;
  config: LoadedConfig;
  rendererHtmlPath?: string;
}

export async function runServe(opts: ServeOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const rendererHtmlPath = opts.rendererHtmlPath ?? defaultRendererHtml();
  if (!existsSync(rendererHtmlPath)) {
    throw errors.rendererMissing(rendererHtmlPath);
  }

  const dataset: Dataset = await extract({
    repo: opts.repo,
    since: opts.since,
    deltaConfig: opts.config.extract,
  });
  const datasetBody = JSON.stringify(dataset);

  const html = readFileSync(rendererHtmlPath, "utf8");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url === "/data.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(datasetBody);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  const port = await listenWithFallback(server, opts.port);
  const url = `http://localhost:${port}`;
  return {
    url,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

async function listenWithFallback(
  server: ReturnType<typeof createServer>,
  preferredPort: number,
): Promise<number> {
  const maxAttempts = 10;
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = preferredPort + offset;
    const ok = await new Promise<boolean>((settle) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE") settle(false);
        else settle(false);
      };
      server.once("error", onError);
      server.listen(candidate, () => {
        server.off("error", onError);
        settle(true);
      });
    });
    if (ok) {
      if (offset > 0) {
        process.stderr.write(
          errors.portInUse(preferredPort, candidate).message + "\n",
        );
      }
      return candidate;
    }
  }
  throw errors.invalidArgs(`could not bind to any port in ${preferredPort}..${preferredPort + maxAttempts - 1}`);
}

function defaultRendererHtml(): string {
  const cliEntry = process.argv[1] ?? "";
  return resolve(cliEntry, "..", "..", "index.html");
}
