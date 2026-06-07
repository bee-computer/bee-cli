import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { dailyCommand } from "@/commands/daily";
import { dailyResource } from "@/resources/daily";
import { jsonString } from "@/resources/json";

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

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return { logs, restore: () => spy.mockRestore() };
}

const LIST_RESPONSE = {
  daily_summaries: [
    {
      id: 1,
      date: "2026-06-04",
      date_time: null,
      short_summary: "Day one short.",
      summary: "Day one full summary.",
      email_summary: null,
      calendar_summary: null,
      conversations_count: 2,
      locations: null,
      created_at: 1717459200,
    },
    {
      id: 2,
      date: "2026-06-05",
      date_time: null,
      short_summary: "Day two short.",
      summary: "Day two full summary.",
      email_summary: null,
      calendar_summary: null,
      conversations_count: 0,
      locations: null,
      created_at: 1717545600,
    },
  ],
  next_cursor: "CURSOR2",
  timezone: "America/New_York",
};

const DETAIL_RESPONSE = {
  daily_summary: {
    id: 7,
    date: "2026-06-05",
    date_time: null,
    short_summary: "Short detail.",
    summary: "Full detail summary.",
    email_summary: "Email body.",
    calendar_summary: "Calendar body.",
    conversations_count: 1,
    locations: [
      { id: 10, latitude: 40.1234567, longitude: -73.7654321, address: "Some Place" },
    ],
    created_at: 1717545600,
    conversations: [
      {
        id: 99,
        start_time: 1717545600,
        end_time: 1717549200,
        short_summary: "Talked about things.",
        conversation_uuid: "uuid-99",
        device_type: "wearable",
        state: "completed",
        primary_location: { address: "Cafe", latitude: 40.5, longitude: -73.5 },
        bookmarked: true,
      },
    ],
  },
  timezone: "America/New_York",
};

describe("daily command (current behavior golden)", () => {
  // ---- dispatcher errors ----------------------------------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["wat"], ctx), "Unknown daily subcommand: wat");
  });

  // ---- list -----------------------------------------------------------------

  it("list --json prints the raw server response", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        return Response.json(LIST_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["list", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(LIST_RESPONSE);
  });

  it("list markdown renders summaries with pagination", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("limit")).toBe("5");
      return Response.json(LIST_RESPONSE);
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["list", "--limit", "5"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Daily Summaries");
    expect(out).toContain("### Daily Summary 1");
    expect(out).toContain("### Daily Summary 2");
    expect(out).toContain("Day one full summary.");
    expect(out).toContain("## Pagination");
    expect(out).toContain("- next_cursor: CURSOR2");
  });

  it("list forwards a cursor", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("cursor")).toBe("ABC");
      return Response.json({ daily_summaries: [], timezone: "UTC" });
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["list", "--cursor", "ABC"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("- (none)");
  });

  it("list rejects a bad --limit", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      dailyCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("list rejects a missing --cursor value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["list", "--cursor"], ctx), "--cursor requires a value");
  });

  it("list rejects unknown option", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("list rejects unexpected positionals", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- get ------------------------------------------------------------------

  it("get --json prints the raw detail", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily/7") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["get", "7", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(DETAIL_RESPONSE);
  });

  it("get markdown renders the detail document", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily/7") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["get", "7"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Daily Summary 7");
    expect(out).toContain("## Short Summary");
    expect(out).toContain("Short detail.");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Email Summary");
    expect(out).toContain("## Calendar Summary");
    expect(out).toContain("## Locations");
    expect(out).toContain("- Some Place (40.12346, -73.76543)");
    expect(out).toContain("## Conversations");
    expect(out).toContain("### Conversation 99");
    expect(out).toContain("- bookmarked: true");
  });

  it("get rejects a missing id", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["get"], ctx), "Missing daily summary id.");
  });

  it("get rejects a non-numeric id", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["get", "abc"], ctx), "Daily summary id must be a positive integer.");
  });

  it("get rejects extra args", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["get", "1", "2"], ctx), "Unexpected arguments: 1 2");
  });

  // ---- find -----------------------------------------------------------------

  it("find by date resolves via the matched summary id", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        // find filters server-side with from=to=<date> (no client scan).
        expect(url.searchParams.get("from")).toBe("2026-06-05");
        expect(url.searchParams.get("to")).toBe("2026-06-05");
        return Response.json(LIST_RESPONSE);
      }
      if (url.pathname === "/v1/daily/2") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["find", "2026-06-05"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Daily Summary 7");
  });

  it("find --json prints the resolved detail", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        return Response.json(LIST_RESPONSE);
      }
      if (url.pathname === "/v1/daily/2") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["find", "2026-06-05", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(DETAIL_RESPONSE);
  });

  it("find reports no summary for an unmatched date", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        return Response.json(LIST_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await dailyCommand.run(["find", "2020-01-01"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toBe("No daily summary found for 2020-01-01.");
  });

  it("find rejects a malformed date", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["find", "2026/01/01"], ctx), "Date must be YYYY-MM-DD.");
  });

  it("find rejects a missing date", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(dailyCommand.run(["find"], ctx), "Missing date.");
  });
});

// ---- MCP bee_list_daily_summaries (date-range, server-filtered) -------------

describe("bee_list_daily_summaries action", () => {
  const action = dailyResource.actions.find(
    (candidate) => candidate.mcp?.name === "bee_list_daily_summaries"
  );

  it("requests /v1/daily with from/to and returns the summaries directly", async () => {
    const captured: { from: string | null; to: string | null; limit: string | null } = {
      from: null,
      to: null,
      limit: null,
    };
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        captured.from = url.searchParams.get("from");
        captured.to = url.searchParams.get("to");
        captured.limit = url.searchParams.get("limit");
        return Response.json(LIST_RESPONSE);
      }
      return Response.json({});
    });

    if (!action) {
      throw new Error("bee_list_daily_summaries action not found");
    }
    const input = action.coerceInput(
      { startDate: "2026-06-04", endDate: "2026-06-05", limit: 30 },
      "mcp"
    );
    const result = await action.run(ctx, input);
    if (result.kind !== "json") {
      throw new Error("expected json result");
    }
    expect(captured.from).toBe("2026-06-04");
    expect(captured.to).toBe("2026-06-05");
    expect(captured.limit).toBe("30");
    const parsed = JSON.parse(jsonString(result.data)) as {
      daily_summaries: unknown[];
      timezone: string;
    };
    expect(parsed.daily_summaries).toHaveLength(2);
    expect(parsed.timezone).toBe("America/New_York");
  });
});
