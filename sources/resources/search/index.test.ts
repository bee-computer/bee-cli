import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { searchCommand } from "@/commands/search";

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
  const logSpy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return { logs, restore: () => logSpy.mockRestore() };
}

describe("search command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("requires a query", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(searchCommand.run([], ctx), "Missing query. Provide --query.");
  });

  it("rejects --query without a value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(searchCommand.run(["--query"], ctx), "--query requires a value");
  });

  it("rejects a non-positive --limit", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("accepts an over-max --limit (released CLI does not cap; server clamps)", async () => {
    const ctx = proxyContext(() => Response.json({ results: [] }));
    const { restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "hi", "--limit", "101", "--json"], ctx);
    } finally {
      restore();
    }
  });

  it("rejects an invalid --filter", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--filter", "todos"], ctx),
      "--filter must be conversations, daily, facts, or all"
    );
  });

  it("rejects an invalid --scope", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--scope", "facts"], ctx),
      "--scope must be conversations or all"
    );
  });

  it("rejects an invalid --sort", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--sort", "oldest"], ctx),
      "--sort must be relevance or mostRecent"
    );
  });

  it("rejects an invalid --sortBy", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--sortBy", "oldest"], ctx),
      "--sort must be relevance or mostRecent"
    );
  });

  it("rejects keyword-only flags combined with --neural", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--neural", "--filter", "facts"], ctx),
      "--filter, --scope, and --sort cannot be used with --neural."
    );
  });

  it("rejects --cursor", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--cursor", "abc"], ctx),
      "--cursor is no longer supported. Use --since/--until."
    );
  });

  it("rejects --since without --neural", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--since", "1000000000000"], ctx),
      "--since and --until can only be used with --neural."
    );
  });

  it("rejects --until without --neural", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--until", "1000000000000"], ctx),
      "--since and --until can only be used with --neural."
    );
  });

  it("rejects a non-numeric --since with --neural", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--neural", "--since", "soon"], ctx),
      "--since must be a valid epoch timestamp"
    );
  });

  it("rejects a non-numeric --until with --neural", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      searchCommand.run(["--query", "hi", "--neural", "--until", "soon"], ctx),
      "--until must be a valid epoch timestamp"
    );
  });

  it("rejects unknown options", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(searchCommand.run(["--query", "hi", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(searchCommand.run(["--query", "hi", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- keyword success paths ------------------------------------------------

  it("keyword search posts /v1/search/conversations with defaults and prints JSON", async () => {
    let captured: { path: string; body: unknown } | null = null;
    const ctx = proxyContext(async (request) => {
      const url = new URL(request.url);
      captured = { path: url.pathname, body: await request.json() };
      return Response.json({ results: [], total: 0 });
    });

    const { logs, restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee", "--json"], ctx);
    } finally {
      restore();
    }

    expect(captured!.path).toBe("/v1/search/conversations");
    expect(captured!.body).toEqual({
      query: "coffee",
      limit: 20,
      filter: "all",
      sortBy: "relevance",
    });
    expect(JSON.parse(logs.join("\n"))).toEqual({ results: [], total: 0 });
  });

  it("keyword search honors --limit --filter --sort", async () => {
    let captured: unknown = null;
    const ctx = proxyContext(async (request) => {
      captured = await request.json();
      return Response.json({ results: [] });
    });

    const { restore } = captureLogs();
    try {
      await searchCommand.run(
        ["--query", "coffee", "--limit", "5", "--filter", "facts", "--sort", "mostRecent", "--json"],
        ctx
      );
    } finally {
      restore();
    }

    expect(captured).toEqual({
      query: "coffee",
      limit: 5,
      filter: "facts",
      sortBy: "mostRecent",
    });
  });

  it("--scope all maps to filter all", async () => {
    let captured: { filter?: unknown } = {};
    const ctx = proxyContext(async (request) => {
      captured = (await request.json()) as { filter?: unknown };
      return Response.json({ results: [] });
    });
    const { restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "x", "--scope", "all", "--json"], ctx);
    } finally {
      restore();
    }
    expect(captured.filter).toBe("all");
  });

  it("--scope conversations maps to filter conversations", async () => {
    let captured: { filter?: unknown } = {};
    const ctx = proxyContext(async (request) => {
      captured = (await request.json()) as { filter?: unknown };
      return Response.json({ results: [] });
    });
    const { restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "x", "--scope", "conversations", "--json"], ctx);
    } finally {
      restore();
    }
    expect(captured.filter).toBe("conversations");
  });

  it("keyword search renders markdown via printToolData", async () => {
    const ctx = proxyContext(() => Response.json({ results: [], total: 0 }));
    const { logs, restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Bee Search");
  });

  // ---- neural success paths -------------------------------------------------

  it("neural search posts /v1/search/conversations/neural without defaults", async () => {
    let captured: { path: string; body: unknown } | null = null;
    const ctx = proxyContext(async (request) => {
      const url = new URL(request.url);
      captured = { path: url.pathname, body: await request.json() };
      return Response.json({ results: [], total: 0 });
    });

    const { restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee", "--neural", "--json"], ctx);
    } finally {
      restore();
    }

    expect(captured!.path).toBe("/v1/search/conversations/neural");
    expect(captured!.body).toEqual({ query: "coffee" });
  });

  it("neural search includes limit/since/until when provided", async () => {
    let captured: unknown = null;
    const ctx = proxyContext(async (request) => {
      captured = await request.json();
      return Response.json({ results: [] });
    });

    const { restore } = captureLogs();
    try {
      await searchCommand.run(
        ["--query", "coffee", "--neural", "--limit", "3", "--since", "1000", "--until", "2000", "--json"],
        ctx
      );
    } finally {
      restore();
    }

    expect(captured).toEqual({ query: "coffee", limit: 3, since: 1000, until: 2000 });
  });

  it("neural search renders the conversation markdown with answers", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        results: [
          {
            id: 42,
            detailed_summary: "We talked about coffee.",
            start_time: "2026-06-05T10:00:00Z",
          },
        ],
        total: 1,
        timezone: "America/New_York",
      })
    );

    const { logs, restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee", "--neural"], ctx);
    } finally {
      restore();
    }

    const out = logs.join("\n");
    expect(out).toContain("# Conversation Search Results");
    expect(out).toContain("### Conversation 42");
    expect(out).toContain("answer: We talked about coffee.");
    expect(out).toContain("## Summary");
    expect(out).toContain("- total: 1");
  });

  it("neural search renders (none) for empty results", async () => {
    const ctx = proxyContext(() => Response.json({ results: [], total: 0 }));
    const { logs, restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee", "--neural"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Conversation Search Results");
    expect(out).toContain("- (none)");
    expect(out).toContain("- total: 0");
  });

  it("neural search falls back to record markdown when results is not an array", async () => {
    const ctx = proxyContext(() => Response.json({ message: "no neural results", timezone: "UTC" }));
    const { logs, restore } = captureLogs();
    try {
      await searchCommand.run(["--query", "coffee", "--neural"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Conversation Search Results");
    expect(out).toContain("no neural results");
  });
});
