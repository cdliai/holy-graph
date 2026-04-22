// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Test helper: build a deterministic tmp git repo from a commit spec.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureCommit {
  /** Map of relative path → file content. Empty string deletes the file. */
  files: Record<string, string>;
  message: string;
  author?: string;
  /** Optional ISO timestamp; default is "now" at the time of the call. */
  date?: string;
}

export interface FixtureRepo {
  path: string;
  cleanup: () => void;
}

export function createFixtureRepo(commits: FixtureCommit[]): FixtureRepo {
  const path = mkdtempSync(join(tmpdir(), "holy-graph-fixture-"));
  const run = (args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8" });

  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "fixture@holy-graph.test"]);
  run(["config", "user.name", "Fixture"]);
  run(["config", "commit.gpgsign", "false"]);

  for (const commit of commits) {
    for (const [relPath, content] of Object.entries(commit.files)) {
      const abs = join(path, relPath);
      if (content === "") {
        rmSync(abs, { force: true });
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    run(["add", "-A"]);
    const env = {
      ...process.env,
      ...(commit.date
        ? { GIT_AUTHOR_DATE: commit.date, GIT_COMMITTER_DATE: commit.date }
        : {}),
    };
    execFileSync(
      "git",
      [
        "-C",
        path,
        "commit",
        "-q",
        "-m",
        commit.message,
        "--author",
        commit.author ?? "Fixture <fixture@holy-graph.test>",
      ],
      { env, encoding: "utf8" },
    );
  }

  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}
