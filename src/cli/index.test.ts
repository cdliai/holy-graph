// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createFixtureRepo, type FixtureRepo } from "../../tests/helpers/fixture-repo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../../dist/cli/index.js");
const RENDERER_HTML = resolve(__dirname, "../../dist/index.html");

// Short CLI runs use execFileSync for simplicity; the serve-mode test below
// needs to keep the process alive across fetches so it uses spawn directly.
function runSync(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(CLI, args, { encoding: "utf8" });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      exitCode: e.status ?? 1,
    };
  }
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`CLI build missing at ${CLI}. Run "pnpm build" first.`);
  }
  if (!existsSync(RENDERER_HTML)) {
    throw new Error(`Renderer build missing at ${RENDERER_HTML}. Run "pnpm build" first.`);
  }
});

let repo: FixtureRepo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
});

describe("holy-graph CLI", () => {
  it("--help exits 0 and prints usage", () => {
    const { stdout, exitCode } = runSync(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("--out");
  });

  it("--version exits 0 and prints a version string", () => {
    const { stdout, exitCode } = runSync(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("exits 1 with NO_GIT_DIR when target isn't a git repo", () => {
    repo = createFixtureRepo([{ files: { "a.txt": "x" }, message: "init" }]);
    // Point at a non-git directory
    const parent = resolve(repo.path, "..");
    const { stderr, exitCode } = runSync([parent]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/no \.git directory found/);
  });

  it("exports a single-file HTML to --out", async () => {
    repo = createFixtureRepo([
      { files: { "a.ts": "alpha\nbeta\n" }, message: "init" },
      { files: { "a.ts": "alpha\nbeta\ngamma\n", "b.ts": "beta" }, message: "two" },
      { files: { "a.ts": "alpha\nbeta\ngamma\ndelta\n" }, message: "touch a" },
      { files: { "b.ts": "beta\ngamma\n" }, message: "touch b" },
    ]);
    const out = resolve(repo.path, "viz.html");
    const { stdout, exitCode } = runSync([repo.path, "--out", out]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/wrote .* KB/);
    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, "utf8");
    expect(html).toContain(`id="holy-graph-data"`);
    expect(html).toContain(`"schemaVersion":1`);
  });

  it("refuses to overwrite --out without --force", () => {
    repo = createFixtureRepo([
      { files: { "a.ts": "alpha\nbeta\n" }, message: "init" },
      { files: { "a.ts": "alpha\nbeta\ngamma\n" }, message: "touch" },
    ]);
    const out = resolve(repo.path, "viz.html");
    runSync([repo.path, "--out", out]);
    const { stderr, exitCode } = runSync([repo.path, "--out", out]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/already exists/);
  });

  it("accepts --out with --force", () => {
    repo = createFixtureRepo([
      { files: { "a.ts": "alpha\nbeta\n" }, message: "init" },
      { files: { "a.ts": "alpha\nbeta\ngamma\n" }, message: "touch" },
    ]);
    const out = resolve(repo.path, "viz.html");
    const first = runSync([repo.path, "--out", out]);
    expect(first.exitCode).toBe(0);
    const second = runSync([repo.path, "--out", out, "--force"]);
    expect(second.exitCode).toBe(0);
    rmSync(out);
  });

  it("rejects a malformed --port", () => {
    repo = createFixtureRepo([{ files: { "a.txt": "x" }, message: "init" }]);
    const { stderr, exitCode } = runSync([repo.path, "--port", "not-a-number"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--port must be an integer/);
  });
});

describe("holy-graph CLI serve mode", () => {
  it("starts a server and responds to / and /data.json", async () => {
    repo = createFixtureRepo([
      { files: { "a.ts": "alpha\nbeta\ngamma\n" }, message: "init" },
      { files: { "a.ts": "alpha\nbeta\ngamma\ndelta\n", "b.ts": "beta\n" }, message: "two" },
      { files: { "a.ts": "alpha\nbeta\ngamma\ndelta\nepsilon\n" }, message: "three" },
      { files: { "b.ts": "beta\ngamma\n" }, message: "touch b" },
    ]);
    const proc = spawn(CLI, [repo.path, "--port", "17173"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      // Wait for server readiness (first "[holy-graph] serving" line)
      await new Promise<void>((settle, reject) => {
        const timer = setTimeout(() => reject(new Error("server never started")), 10_000);
        proc.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("serving at")) {
            clearTimeout(timer);
            settle();
          }
        });
        proc.stderr.on("data", () => {});
      });

      const rootRes = await fetch("http://localhost:17173/");
      expect(rootRes.status).toBe(200);
      const rootBody = await rootRes.text();
      expect(rootBody.toLowerCase()).toContain("<!doctype html>");

      const dataRes = await fetch("http://localhost:17173/data.json");
      expect(dataRes.status).toBe(200);
      const data = (await dataRes.json()) as { schemaVersion: number };
      expect(data.schemaVersion).toBe(1);
    } finally {
      proc.kill("SIGINT");
      await new Promise<void>((r) => proc.on("exit", () => r()));
    }
  });
});
