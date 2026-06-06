import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { activityCommand } from "@/commands/activity";

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

function activityHandler(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/v1/conversations") {
    return Response.json({ conversations: [{ id: 1, start_time: "2026-06-05T10:00:00Z", short_summary: "Chat" }] });
  }
  if (url.pathname === "/v1/daily") {
    return Response.json({ daily_summaries: [{ id: 2, date_time: "2026-06-05T08:00:00Z" }] });
  }
  if (url.pathname === "/v1/journals") {
    return Response.json({ journals: [{ id: 3, created_at: "2026-06-05T09:00:00Z" }] });
  }
  if (url.pathname === "/v1/todos") {
    return Response.json({ todos: [{ id: 4, created_at: "2026-06-05T07:00:00Z" }] });
  }
  if (url.pathname === "/v1/insights") {
    return Response.json({ insights: [{ id: 5, generated_at: "2026-06-05T11:00:00Z" }] });
  }
  return Response.json({});
}

describe("activity command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("rejects an unknown option", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(activityCommand.run(["--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(activityCommand.run(["extra"], ctx), "Unexpected arguments: extra");
  });

  it("rejects a non-positive --limit", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      activityCommand.run(["--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("accepts an over-max --limit (CLI does not cap; server/MCP clamps)", async () => {
    const ctx = proxyContext(() => Response.json({}));
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await activityCommand.run(["--limit", "21"], ctx);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects a missing --limit value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(activityCommand.run(["--limit"], ctx), "--limit requires a value");
  });

  // ---- success paths --------------------------------------------------------

  it("lists recent activity as JSON sorted by time descending", async () => {
    const ctx = proxyContext(activityHandler);

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await activityCommand.run(["--json"], ctx);
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(logs.join("\n")) as { activity: Array<{ type: string; id: number }> };
    expect(parsed.activity.map((item) => item.type)).toEqual([
      "insight",
      "conversation",
      "voice_note",
      "daily_summary",
      "todo",
    ]);
    expect(parsed.activity[0]).toMatchObject({ type: "insight", id: 5, at: "2026-06-05T11:00:00Z" });
  });

  it("renders markdown with the Recent Activity heading", async () => {
    const ctx = proxyContext(activityHandler);

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await activityCommand.run([], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.join("\n")).toContain("# Recent Activity");
  });
});
