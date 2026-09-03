// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createFixtureRepo, type FixtureRepo } from "../../tests/helpers/fixture-repo.js";
import { extract } from "../extract/index.js";
import { McpServer } from "./server.js";

describe("MCP Server", () => {
  let fixture: FixtureRepo;

  beforeAll(() => {
    fixture = createFixtureRepo([
      {
        message: "initial commit",
        files: {
          "src/auth.ts": "export const auth = 1;",
          "src/session.ts": "export const session = 1;",
          "packages/billing/token.ts": "export const token = 1;",
        },
      },
      {
        message: "auth and session together",
        files: {
          "src/auth.ts": "export const auth = 2;\n// update",
          "src/session.ts": "export const session = 2;\n// update",
        },
      },
      {
        message: "cross-module auth and billing",
        files: {
          "src/auth.ts": "export const auth = 3;\n// update 2",
          "packages/billing/token.ts": "export const token = 2;\n// update 2",
        },
      },
    ]);
  });

  afterAll(() => {
    fixture?.cleanup();
  });

  it("handles initialize method", async () => {
    const getDataset = async () =>
      extract({ repo: fixture.path, showProgress: false, deltaConfig: { maxFilesPerCommit: 80, minFileTotalTouches: 1, exclude: [] } });
    const server = new McpServer(fixture.path, getDataset);

    const responses: string[] = [];
    const mockStdout = {
      write: (s: string) => responses.push(s),
    };

    await server.processRawMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }),
      mockStdout,
    );

    expect(responses.length).toBe(1);
    const parsed = JSON.parse(responses[0]);
    expect(parsed.id).toBe(1);
    expect(parsed.result.protocolVersion).toBe("2024-11-05");
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.serverInfo.name).toBe("@cdli/holy-graph");
  });

  it("handles tools/list method", async () => {
    const getDataset = async () =>
      extract({ repo: fixture.path, showProgress: false, deltaConfig: { maxFilesPerCommit: 80, minFileTotalTouches: 1, exclude: [] } });
    const server = new McpServer(fixture.path, getDataset);

    const responses: string[] = [];
    const mockStdout = {
      write: (s: string) => responses.push(s),
    };

    await server.processRawMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
      mockStdout,
    );

    expect(responses.length).toBe(1);
    const parsed = JSON.parse(responses[0]);
    expect(parsed.id).toBe(2);
    expect(parsed.result.tools.length).toBe(5);
    const toolNames = parsed.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("holy_graph_get_cochange_neighbors");
    expect(toolNames).toContain("holy_graph_get_blast_radius");
    expect(toolNames).toContain("holy_graph_list_hotspots");
    expect(toolNames).toContain("holy_graph_get_module_graph");
    expect(toolNames).toContain("holy_graph_explain_architecture");
  });

  it("calls holy_graph_get_cochange_neighbors", async () => {
    const getDataset = async () =>
      extract({ repo: fixture.path, showProgress: false, deltaConfig: { maxFilesPerCommit: 80, minFileTotalTouches: 1, exclude: [] } });
    const server = new McpServer(fixture.path, getDataset);

    const responses: string[] = [];
    const mockStdout = {
      write: (s: string) => responses.push(s),
    };

    await server.processRawMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "holy_graph_get_cochange_neighbors",
          arguments: { path: "src/auth.ts" },
        },
      }),
      mockStdout,
    );

    expect(responses.length).toBe(1);
    const parsed = JSON.parse(responses[0]);
    expect(parsed.id).toBe(3);
    const content = JSON.parse(parsed.result.content[0].text);
    expect(content.target.path).toBe("src/auth.ts");
    expect(content.neighbors.length).toBeGreaterThanOrEqual(1);

    const neighborPaths = content.neighbors.map((n: { path: string }) => n.path);
    expect(neighborPaths).toContain("src/session.ts");
    expect(neighborPaths).toContain("packages/billing/token.ts");

    // Cross-module check
    const billingNeighbor = content.neighbors.find(
      (n: { path: string }) => n.path === "packages/billing/token.ts",
    );
    expect(billingNeighbor?.isCrossModule).toBe(true);
  });

  it("calls holy_graph_get_blast_radius", async () => {
    const getDataset = async () =>
      extract({ repo: fixture.path, showProgress: false, deltaConfig: { maxFilesPerCommit: 80, minFileTotalTouches: 1, exclude: [] } });
    const server = new McpServer(fixture.path, getDataset);

    const responses: string[] = [];
    const mockStdout = {
      write: (s: string) => responses.push(s),
    };

    await server.processRawMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "holy_graph_get_blast_radius",
          arguments: { paths: ["src/auth.ts"] },
        },
      }),
      mockStdout,
    );

    const parsed = JSON.parse(responses[0]);
    const content = JSON.parse(parsed.result.content[0].text);
    expect(content.analyzedFiles).toContain("src/auth.ts");
    expect(content.affectedModules).toContain("src");
    expect(content.riskAssessment.level).toBeDefined();
  });

  it("calls holy_graph_explain_architecture", async () => {
    const getDataset = async () =>
      extract({ repo: fixture.path, showProgress: false, deltaConfig: { maxFilesPerCommit: 80, minFileTotalTouches: 1, exclude: [] } });
    const server = new McpServer(fixture.path, getDataset);

    const responses: string[] = [];
    const mockStdout = {
      write: (s: string) => responses.push(s),
    };

    await server.processRawMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "holy_graph_explain_architecture",
          arguments: {},
        },
      }),
      mockStdout,
    );

    const parsed = JSON.parse(responses[0]);
    const markdown = parsed.result.content[0].text;
    expect(markdown).toContain("# Codebase Architecture Analysis — Holy Graph");
    expect(markdown).toContain("Primary Architectural Modules");
  });
});
