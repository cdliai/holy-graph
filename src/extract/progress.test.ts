// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI

import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createProgress } from "./progress.js";

function mockTtyStream(isTty: boolean) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  }) as Writable & { isTTY?: boolean };
  stream.isTTY = isTty;
  return { stream: stream as unknown as NodeJS.WriteStream, chunks };
}

describe("createProgress", () => {
  it("is silent in non-TTY mode", () => {
    const { stream, chunks } = mockTtyStream(false);
    const p = createProgress(stream);
    p.start("Parsing", 100);
    p.update(50);
    p.done();
    expect(chunks).toEqual([]);
  });

  it("writes a final summary in non-TTY mode when provided", () => {
    const { stream, chunks } = mockTtyStream(false);
    const p = createProgress(stream);
    p.start("Parsing");
    p.done("Parsing: 1234 commits");
    expect(chunks.join("")).toContain("Parsing: 1234 commits");
  });

  it("renders a label on start in TTY mode", () => {
    const { stream, chunks } = mockTtyStream(true);
    const p = createProgress(stream);
    p.start("Parsing", 10);
    expect(chunks.join("")).toContain("Parsing");
  });
});
