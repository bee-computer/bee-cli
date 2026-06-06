import { describe, expect, it } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { serveMcpHttp } from "@/mcp/httpServer";
import { handleMcpJsonRpc } from "@/mcp/server";
import { BEE_MCP_TOOLS } from "@/mcp/toolDefinitions";

const context: CommandContext = {
  env: "prod",
  client: {
    env: "prod",
    baseUrl: "http://127.0.0.1/",
    isProxy: true,
    fetch: async () => Response.json({}),
  },
};

function contextReturning(payload: unknown): CommandContext {
  return {
    env: "prod",
    client: {
      env: "prod",
      baseUrl: "http://127.0.0.1/",
      isProxy: true,
      fetch: async () => Response.json(payload),
    },
  };
}

type CapturedRequest = { path: string; body: unknown };

function capturingContext(captured: CapturedRequest[], payload: unknown): CommandContext {
  return {
    env: "prod",
    client: {
      env: "prod",
      baseUrl: "http://127.0.0.1/",
      isProxy: true,
      fetch: async (path: string, init?: RequestInit) => {
        const rawBody = init?.body;
        captured.push({
          path,
          body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
        });
        return Response.json(payload);
      },
    },
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  context: CommandContext
): Promise<string> {
  const response = await handleMcpJsonRpc({
    jsonrpc: "2.0",
    id: 100,
    method: "tools/call",
    params: { name, arguments: args },
  }, context) as { result?: { isError?: boolean; content: Array<{ text: string }> } };
  expect(response.result?.isError).toBeUndefined();
  return response.result?.content[0]?.text ?? "";
}

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

  it("requires an HTTP token when none is provided", async () => {
    const saved = process.env["BEE_MCP_HTTP_TOKEN"];
    delete process.env["BEE_MCP_HTTP_TOKEN"];
    try {
      await expect(serveMcpHttp(context, {})).rejects.toThrow("An auth token is required");
    } finally {
      if (saved !== undefined) {
        process.env["BEE_MCP_HTTP_TOKEN"] = saved;
      }
    }
  });

  it("lists the Bee MCP tools", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }, context);

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: BEE_MCP_TOOLS },
    });
  });

  it("dispatches tools/call to callBeeTool and returns canned data", async () => {
    const facts = { facts: [{ id: 1, text: "remember milk", confirmed: true }] };
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "bee_list_facts", arguments: { limit: 5 } },
    }, contextReturning(facts)) as {
      result: { content: Array<{ type: string; text: string }> };
    };

    const text = response.result.content[0]?.text ?? "";
    expect(JSON.parse(text)).toMatchObject(facts);
  });

  it("returns tool execution failures as isError results, not protocol errors", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      // requiredIdArg throws on a missing id -> should become an isError tool result.
      params: { name: "bee_complete_todo", arguments: {} },
    }, context) as {
      error?: unknown;
      result?: { isError?: boolean; content: Array<{ text: string }> };
    };

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content[0]?.text).toContain("id");
  });

  it("clamps an out-of-range limit instead of failing the tool call", async () => {
    const fetched: string[] = [];
    const clampContext: CommandContext = {
      env: "prod",
      client: {
        env: "prod",
        baseUrl: "http://127.0.0.1/",
        isProxy: true,
        fetch: async (path: string) => {
          fetched.push(path);
          return Response.json({ todos: [] });
        },
      },
    };
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "bee_list_todos", arguments: { limit: 999 } },
    }, clampContext) as { error?: unknown; result?: { isError?: boolean } };

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBeUndefined();
    // limit is clamped to the schema max (50), not passed through as 999.
    expect(fetched.some((path) => path.includes("limit=50"))).toBe(true);
  });

  it("rejects a tools/call with an unknown extra property as isError", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "bee_list_facts", arguments: { limit: 5, bogus: true } },
    }, contextReturning({ facts: [] })) as {
      error?: unknown;
      result?: { isError?: boolean; content: Array<{ text: string }> };
    };

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content[0]?.text).toContain("bogus");
  });

  it("rejects a tools/call exceeding a string maxLength as isError", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "bee_search", arguments: { query: "a".repeat(501) } },
    }, contextReturning({ results: [] })) as {
      error?: unknown;
      result?: { isError?: boolean; content: Array<{ text: string }> };
    };

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content[0]?.text).toContain("characters");
  });

  it("bee_search (keyword) POSTs /v1/search/conversations and returns results verbatim", async () => {
    const captured: CapturedRequest[] = [];
    const serverBody = {
      results: [{ id: "c1", type: "conversation", score: 1, summary: "s", created_at: 1, corrections: [] }],
      next_cursor: null,
      search_mode: "bm25",
      timezone: "UTC",
    };
    const text = await callTool(
      "bee_search",
      { query: "coffee", limit: 5, filter: "conversations", sortBy: "mostRecent" },
      capturingContext(captured, serverBody)
    );

    const post = captured.find((entry) => entry.path === "/v1/search/conversations");
    expect(post?.body).toEqual({ query: "coffee", limit: 5, filter: "conversations", sortBy: "mostRecent" });
    // Body is returned verbatim from the server, with no federation/returned/matched fields.
    expect(JSON.parse(text)).toEqual(serverBody);
  });

  it("bee_search defaults to filter 'all', sortBy 'relevance', keyword mode", async () => {
    const captured: CapturedRequest[] = [];
    await callTool("bee_search", { query: "coffee" }, capturingContext(captured, { results: [] }));
    const post = captured.find((entry) => entry.path === "/v1/search/conversations");
    expect(post?.body).toEqual({ query: "coffee", limit: 20, filter: "all", sortBy: "relevance" });
  });

  it("bee_search semantic mode POSTs /v1/search/conversations/neural with query+limit only", async () => {
    const captured: CapturedRequest[] = [];
    await callTool(
      "bee_search",
      { query: "coffee", limit: 7, mode: "semantic" },
      capturingContext(captured, { results: [], total: 0, timezone: "UTC" })
    );
    const post = captured.find((entry) => entry.path === "/v1/search/conversations/neural");
    expect(post?.body).toEqual({ query: "coffee", limit: 7 });
  });

  it("bee_search_facts POSTs /v1/search/conversations with filter 'facts'", async () => {
    const captured: CapturedRequest[] = [];
    await callTool("bee_search_facts", { query: "allergy" }, capturingContext(captured, { results: [] }));
    const post = captured.find((entry) => entry.path === "/v1/search/conversations");
    expect(post?.body).toEqual({ query: "allergy", limit: 20, filter: "facts" });
  });

  it("bee_search_voice_notes POSTs /v1/search/journals", async () => {
    const captured: CapturedRequest[] = [];
    const serverBody = { results: [], available: true, total: 0 };
    const text = await callTool(
      "bee_search_voice_notes",
      { query: "meeting", limit: 3 },
      capturingContext(captured, serverBody)
    );
    const post = captured.find((entry) => entry.path === "/v1/search/journals");
    expect(post?.body).toEqual({ query: "meeting", limit: 3 });
    expect(JSON.parse(text)).toEqual(serverBody);
  });

  it("rejects an oversized batch with a single -32600 error", async () => {
    const batch = Array.from({ length: 51 }, (_value, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "ping",
      params: {},
    }));
    const response = await handleMcpJsonRpc(batch, context) as {
      error?: { code: number; message: string };
    };

    expect(response.error?.code).toBe(-32600);
    expect(response.error?.message).toContain("Batch too large");
  });

  it("reports a missing method field clearly", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 9,
      params: {},
    }, context) as { error?: { code: number; message: string } };

    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toContain("Missing 'method'");
  });

  it("returns null for notifications (id === undefined)", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    }, context);

    expect(response).toBeNull();
  });

  it("returns an array of responses for a batch request", async () => {
    const response = await handleMcpJsonRpc([
      { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
      { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
    ], context);

    expect(Array.isArray(response)).toBe(true);
    expect(response).toMatchObject([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });

  it("returns -32601 for an unknown method", async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "does/not/exist",
      params: {},
    }, context);

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601 },
    });
  });
});
