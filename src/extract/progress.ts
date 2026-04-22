// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Single-line progress reporter. TTY-aware: renders a carriage-return-updated
// line when attached to a terminal, silent in pipes / CI / non-TTY environments.

export interface Progress {
  start(label: string, total?: number): void;
  update(current: number, suffix?: string): void;
  done(final?: string): void;
}

export function createProgress(stream: NodeJS.WriteStream = process.stderr): Progress {
  const isTty = stream.isTTY === true;
  let label = "";
  let total = 0;
  let lastRenderMs = 0;

  return {
    start(nextLabel, nextTotal) {
      label = nextLabel;
      total = nextTotal ?? 0;
      lastRenderMs = 0;
      if (isTty) stream.write(`${label}…\r`);
    },
    update(current, suffix) {
      if (!isTty) return;
      // Throttle to ~20 Hz so we don't flood the terminal.
      const now = Date.now();
      if (now - lastRenderMs < 50) return;
      lastRenderMs = now;
      const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
      const pctStr = total > 0 ? ` ${pct}%` : "";
      stream.write(`\r${label}${pctStr} ${suffix ?? ""}\x1b[K`);
    },
    done(final) {
      if (isTty) stream.write(`\r${final ?? `${label} done`}\x1b[K\n`);
      else if (final) stream.write(`${final}\n`);
    },
  };
}
