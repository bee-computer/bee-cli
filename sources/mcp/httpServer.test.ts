import { afterEach, describe, expect, it } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { liveServerCount, serveMcpHttp } from "@/mcp/httpServer";

const context: CommandContext = {
  env: "prod",
  client: {
    env: "prod",
    baseUrl: "http://127.0.0.1/",
    isProxy: true,
    fetch: async () => Response.json({}),
  },
};

// A 32+ character token so validateToken accepts it.
const TOKEN = "0123456789abcdef0123456789abcdef";
// Explicit high port unlikely to collide with the default scan range.
const PORT = 18793;

let server: Awaited<ReturnType<typeof serveMcpHttp>> | null = null;

afterEach(() => {
  if (server) {
    server.stop(true);
    server = null;
  }
});

describe("MCP HTTP authorization", () => {
  it("rejects /health without a Bearer token (401)", async () => {
    server = await serveMcpHttp(context, { token: TOKEN, port: PORT });
    const response = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(response.status).toBe(401);
    await response.text();
  });

  it("accepts /health with the correct Bearer token (200)", async () => {
    server = await serveMcpHttp(context, { token: TOKEN, port: PORT });
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, name: "Bee MCP" });
  });

  it("rejects /health with a wrong Bearer token (401)", async () => {
    server = await serveMcpHttp(context, { token: TOKEN, port: PORT });
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { authorization: "Bearer wrong-token-value-padding-to-len" },
    });
    expect(response.status).toBe(401);
    await response.text();
  });
});

describe("MCP HTTP shutdown registration", () => {
  it("registers every started server, not just the first", async () => {
    const before = liveServerCount();
    const first = await serveMcpHttp(context, { token: TOKEN, port: PORT });
    const second = await serveMcpHttp(context, { token: TOKEN, port: PORT + 1 });
    try {
      expect(liveServerCount()).toBe(before + 2);
    } finally {
      first.stop(true);
      second.stop(true);
    }
  });
});
