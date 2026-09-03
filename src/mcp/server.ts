// @cdli/holy-graph — FSL-1.1-Apache-2.0 — (c) 2026 CDLI
// Lightweight, zero-dependency MCP stdio server implementing JSON-RPC 2.0.
// Compatible with Cursor, Claude Code, Antigravity, and any MCP client.

import type { Dataset } from "../schema/v1.js";
import {
  TOOL_DEFINITIONS,
  handleGetCochangeNeighbors,
  handleGetBlastRadius,
  handleListHotspots,
  handleGetModuleGraph,
  handleExplainArchitecture,
} from "./tools.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class McpServer {
  constructor(
    private readonly repo: string,
    private readonly datasetProvider: () => Promise<Dataset>,
  ) {}

  /** Start listening for JSON-RPC messages on standard input. */
  start(stdin = process.stdin, stdout = process.stdout): void {
    let buffer = "";

    stdin.setEncoding("utf8");
    stdin.on("data", async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      // Retain incomplete trailing line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        await this.processRawMessage(trimmed, stdout);
      }
    });

    stdin.on("end", async () => {
      if (buffer.trim()) {
        await this.processRawMessage(buffer.trim(), stdout);
      }
    });
  }

  /** Process a single raw JSON-RPC string message and send response. */
  async processRawMessage(
    raw: string,
    stdout: { write: (s: string) => void },
  ): Promise<void> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(raw);
    } catch (err) {
      this.sendError(stdout, null, -32700, "Parse error");
      return;
    }

    // Ignore notifications (messages without id)
    if (req.id === undefined) {
      if (req.method === "notifications/initialized") {
        process.stderr.write("[holy-graph mcp] client initialized\n");
      }
      return;
    }

    try {
      const result = await this.handleMethod(req.method, req.params ?? {});
      this.sendResult(stdout, req.id, result);
    } catch (err) {
      this.sendError(stdout, req.id, -32603, (err as Error).message);
    }
  }

  /** Dispatch method calls according to the MCP specification. */
  async handleMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "@cdli/holy-graph",
            version: "1.0.0",
          },
        };

      case "ping":
        return {};

      case "tools/list":
        return {
          tools: TOOL_DEFINITIONS,
        };

      case "tools/call": {
        const toolName = String(params.name ?? "");
        const args = (params.arguments as Record<string, unknown>) ?? {};
        const dataset = await this.datasetProvider();

        switch (toolName) {
          case "holy_graph_get_cochange_neighbors": {
            const path = String(args.path ?? "");
            const limit = typeof args.limit === "number" ? args.limit : undefined;
            const res = handleGetCochangeNeighbors(dataset, { path, limit });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(res, null, 2),
                },
              ],
            };
          }

          case "holy_graph_get_blast_radius": {
            const paths = Array.isArray(args.paths) ? (args.paths as string[]) : undefined;
            const minAffinity =
              typeof args.minAffinity === "number" ? args.minAffinity : undefined;
            const res = handleGetBlastRadius(dataset, this.repo, { paths, minAffinity });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(res, null, 2),
                },
              ],
            };
          }

          case "holy_graph_list_hotspots": {
            const limit = typeof args.limit === "number" ? args.limit : undefined;
            const cluster = typeof args.cluster === "string" ? args.cluster : undefined;
            const res = handleListHotspots(dataset, { limit, cluster });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(res, null, 2),
                },
              ],
            };
          }

          case "holy_graph_get_module_graph": {
            const res = handleGetModuleGraph(dataset);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(res, null, 2),
                },
              ],
            };
          }

          case "holy_graph_explain_architecture": {
            const markdown = handleExplainArchitecture(dataset);
            return {
              content: [
                {
                  type: "text",
                  text: markdown,
                },
              ],
            };
          }

          default:
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Unknown tool: "${toolName}". Use tools/list to inspect available tools.`,
                },
              ],
            };
        }
      }

      default:
        throw new Error(`Method not found: "${method}"`);
    }
  }

  private sendResult(
    stdout: { write: (s: string) => void },
    id: string | number | null,
    result: unknown,
  ): void {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    stdout.write(JSON.stringify(res) + "\n");
  }

  private sendError(
    stdout: { write: (s: string) => void },
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
    stdout.write(JSON.stringify(res) + "\n");
  }
}
