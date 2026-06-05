import { describe, expect, it } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { serveMcpHttp } from "@/mcp/httpServer";
import { handleMcpJsonRpc } from "@/mcp/server";

const context: CommandContext = {
  env: "prod",
  client: {
    env: "prod",
    baseUrl: "http://127.0.0.1/",
    isProxy: true,
    fetch: async () => Response.json({}),
  },
};

describe("MCP server", () => {
  it("responds to JSON-RPC requests with null IDs", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: null,
      method: "initialize",
      params: {},
    }, context);

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "Bee",
        },
      },
    });
  });

  it("rejects weak HTTP tokens before binding a port", async () => {
    await expect(serveMcpHttp(context, { token: "short" })).rejects.toThrow(
      "BEE_MCP_HTTP_TOKEN must be at least 32 characters."
    );
  });
});
