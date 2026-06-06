// Golden tests for the `status` domain.
//
// FALSE TWINS: the CLI `status` command and the MCP `bee_status` tool are NOT
// mirrored. They are captured separately here:
//  - CLI `status`  -> fetchClientMe + /me + masked token + proxy details, and the
//    released "status does not accept arguments." rejection. It is intentionally
//    kept hand-written (it does not flow through the generic registry dispatcher,
//    which would strip --json via parseOutputFlag and change released behavior).
//  - bee_status    -> local token/proxy/mode JSON state, no HTTP call.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { statusCommand } from "@/commands/status";
import { statusResource } from "@/resources/status";

type BunServer = ReturnType<typeof Bun.serve>;

const activeServers: BunServer[] = [];

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true);
  }
});

function proxyContext(handler: (request: Request) => Response | Promise<Response>): CommandContext {
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  activeServers.push(upstream);
  return {
    env: "prod",
    client: createProxyClient("prod", { address: `http://127.0.0.1:${upstream.port}` }),
  };
}

async function expectError(run: Promise<void>, message: string): Promise<void> {
  await expect(run).rejects.toThrow(message);
}

// Resolve the bee_status MCP action from the resource for direct unit testing.
const beeStatusAction = statusResource.actions.find((action) => action.mcp?.name === "bee_status");

describe("status CLI command (false twin: NOT registry-derived)", () => {
  it("rejects any arguments with the released message", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(statusCommand.run(["foo"], ctx), "status does not accept arguments.");
  });

  it("rejects --json with the same released message", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(statusCommand.run(["--json"], ctx), "status does not accept arguments.");
  });

  it("shows proxy connection details and verified user", async () => {
    const ctx = proxyContext(() =>
      Response.json({ id: 1, first_name: "Proxy", last_name: "User" })
    );

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await statusCommand.run([], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(logs[0]).toBe("API: production (https://app-api-developer.ce.bee.amazon.dev/)");
    expect(logs.some((line) => line.startsWith("Connected via proxy:"))).toBe(true);
    expect(logs).toContain("Verified as Proxy User (id 1).");
  });
});

describe("bee_status MCP action (false twin: local state, no HTTP)", () => {
  it("is exposed as an MCP-only action with the released schema", () => {
    expect(beeStatusAction).toBeDefined();
    expect(beeStatusAction?.mcp?.name).toBe("bee_status");
    expect(beeStatusAction?.mcp?.description).toBe(
      "Check whether Bee CLI is signed in and ready."
    );
    expect(beeStatusAction?.mcp?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    // Intentionally NO cli surface (false twin).
    expect(beeStatusAction?.cli).toBeUndefined();
  });

  it("reports connected/read-write state in proxy mode (no HTTP call)", async () => {
    const ctx = proxyContext(() => {
      throw new Error("bee_status must not make any HTTP request");
    });
    if (!beeStatusAction) {
      throw new Error("bee_status action missing");
    }
    const input = beeStatusAction.coerceInput({}, "mcp");
    const result = await beeStatusAction.run(ctx, input);
    expect(result.kind).toBe("json");
    if (result.kind !== "json") {
      throw new Error("expected json result");
    }
    expect(result.data).toEqual({
      connected: true,
      mode: "stdio-mcp",
      access: "read-write",
      environment: "prod",
    });
  });
});
