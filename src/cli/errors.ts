// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// User-facing error catalog per spec §8.4. Throw a CliError; main() formats
// it and exits with code 1 without a stack trace.

export type CliErrorCode =
  | "NO_GIT_DIR"
  | "SHALLOW_CLONE"
  | "EMPTY_REPO"
  | "EXPORT_EXISTS"
  | "PORT_IN_USE"
  | "CONFIG_PARSE_ERROR"
  | "INVALID_ARGS"
  | "RENDERER_MISSING";

export class CliError extends Error {
  constructor(public readonly code: CliErrorCode, message: string) {
    super(message);
    this.name = "CliError";
  }
}

export const errors = {
  noGitDir: (path: string): CliError =>
    new CliError(
      "NO_GIT_DIR",
      `holy-graph: no .git directory found at ${path}. run inside a git repository or pass a path.`,
    ),
  shallowClone: (commitCount: number): CliError =>
    new CliError(
      "SHALLOW_CLONE",
      `holy-graph: shallow clone detected; only ${commitCount} commits available.`,
    ),
  emptyRepo: (): CliError =>
    new CliError("EMPTY_REPO", `holy-graph: repo has no commits.`),
  exportExists: (path: string): CliError =>
    new CliError(
      "EXPORT_EXISTS",
      `holy-graph: ${path} already exists. pass --force to overwrite.`,
    ),
  portInUse: (requested: number, fallback: number): CliError =>
    new CliError(
      "PORT_IN_USE",
      `holy-graph: port ${requested} busy; serving on ${fallback}.`,
    ),
  configParseError: (path: string, reason: string): CliError =>
    new CliError("CONFIG_PARSE_ERROR", `holy-graph: failed to load ${path}: ${reason}`),
  invalidArgs: (reason: string): CliError =>
    new CliError("INVALID_ARGS", `holy-graph: ${reason}`),
  rendererMissing: (path: string): CliError =>
    new CliError(
      "RENDERER_MISSING",
      `holy-graph: renderer build not found at ${path}. Run "pnpm build" first.`,
    ),
};
