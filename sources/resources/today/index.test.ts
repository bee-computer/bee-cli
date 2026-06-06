import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { makeCliCommand } from "@/commands/registry";
import { todayResource } from "@/resources/today";
import { jsonString } from "@/resources/json";

type BunServer = ReturnType<typeof Bun.serve>;

const activeServers: BunServer[] = [];

// Build the CLI command directly from the resource so the golden tests do not
// depend on the central RESOURCES registration (wired centrally in resources/index.ts).
const todayCommand = makeCliCommand(todayResource);

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

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return { logs, restore: () => logSpy.mockRestore() };
}

async function expectError(run: Promise<void>, message: string): Promise<void> {
  await expect(run).rejects.toThrow(message);
}

describe("today command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("rejects an unknown option", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todayCommand.run(["--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positional arguments", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todayCommand.run(["extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- brief (default) success paths ----------------------------------------

  it("renders the brief markdown by default", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/todayBrief") {
        return Response.json({ timezone: "America/New_York", summary: "Stand-up at 9" });
      }
      return Response.json({});
    });

    const { logs, restore } = captureLogs();
    try {
      await todayCommand.run([], ctx);
    } finally {
      restore();
    }

    const output = logs.join("\n");
    expect(output).toContain("# Today Brief");
    expect(output).toContain("Stand-up at 9");
  });

  it("prints the raw brief JSON with --json byte-identically", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/todayBrief") {
        return Response.json({ timezone: "America/New_York", summary: "Stand-up at 9" });
      }
      return Response.json({});
    });

    const { logs, restore } = captureLogs();
    try {
      await todayCommand.run(["--json"], ctx);
    } finally {
      restore();
    }

    const parsed = JSON.parse(logs.join("\n")) as Record<string, unknown>;
    expect(parsed).toEqual({ timezone: "America/New_York", summary: "Stand-up at 9" });
  });

  // ---- context (--context) success path -------------------------------------

  it("--context fetches the 5-GET aggregation and renders Today", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/v1/todayBrief":
          return Response.json({ summary: "brief" });
        case "/v1/conversations":
          return Response.json({ conversations: [] });
        case "/v1/daily":
          return Response.json({ daily_summaries: [] });
        case "/v1/journals":
          return Response.json({ journals: [] });
        case "/v1/todos":
          return Response.json({ todos: [] });
        default:
          return Response.json({});
      }
    });

    const { logs, restore } = captureLogs();
    try {
      await todayCommand.run(["--context", "--json"], ctx);
    } finally {
      restore();
    }

    const parsed = JSON.parse(logs.join("\n")) as Record<string, unknown>;
    expect(parsed).toHaveProperty("date");
    expect(parsed).toHaveProperty("todayBrief");
    expect(parsed).toHaveProperty("dailySummary");
    expect(parsed).toHaveProperty("activeTodos");
    expect(parsed).toHaveProperty("recentNotes");
    expect(parsed).toHaveProperty("recentConversations");
    expect(parsed["todayBrief"]).toEqual({ summary: "brief" });
  });
});

// ---- MCP bee_get_today (false twin: same aggregation, MCP surface) ----------
// Driven through the action directly (the resource is registered into RESOURCES
// centrally in resources/index.ts; this test stays independent of that wiring).

describe("bee_get_today action", () => {
  const action = todayResource.actions.find((candidate) => candidate.mcp?.name === "bee_get_today");

  it("exposes the verbatim mcp tool metadata", () => {
    expect(action?.mcp?.name).toBe("bee_get_today");
    expect(action?.mcp?.description).toBe(
      "Show today's Bee wearable context: daily summary, active todos, notes, and captured conversations."
    );
  });

  it("aggregates today context and returns it as JSON data", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/v1/todayBrief":
          return Response.json({ summary: "brief" });
        case "/v1/conversations":
          return Response.json({ conversations: [] });
        case "/v1/daily":
          return Response.json({ daily_summaries: [] });
        case "/v1/journals":
          return Response.json({ journals: [] });
        case "/v1/todos":
          return Response.json({ todos: [] });
        default:
          return Response.json({});
      }
    });

    if (!action) {
      throw new Error("bee_get_today action not found");
    }
    const input = action.coerceInput({}, "mcp");
    const result = await action.run(ctx, input);
    if (result.kind !== "json") {
      throw new Error("expected json result");
    }
    // The MCP adapter wraps result.data with jsonString; assert the shape here.
    const parsed = JSON.parse(jsonString(result.data)) as Record<string, unknown>;
    expect(parsed).toHaveProperty("date");
    expect(parsed["todayBrief"]).toEqual({ summary: "brief" });
  });
});
