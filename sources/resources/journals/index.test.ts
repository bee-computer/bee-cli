import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { makeCliCommand } from "@/commands/registry";
import { journalsResource } from "@/resources/journals";

// Build the Command directly from the resource so the golden tests run even
// before journalsResource is registered in resources/index.ts.
// This exercises the exact same makeCliCommand path that @/commands/journals
// (resourceCommand("journals")) will use once registered.
const journalsCommand = makeCliCommand(journalsResource);

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
  journals: [
    {
      id: "journal-1",
      text: "First journal line one.\nFirst journal line two.",
      state: "READY",
      created_at: 1717459200,
      updated_at: 1717462800,
    },
    {
      id: "journal-2",
      text: null,
      state: "PREPARING",
      created_at: 1717545600,
      updated_at: 1717549200,
    },
  ],
  next_cursor: "CURSOR2",
  timezone: "America/New_York",
};

const DETAIL_RESPONSE = {
  id: "journal-7",
  text: "Detail body line.",
  state: "ANALYZING",
  created_at: 1717545600,
  updated_at: 1717549200,
  timezone: "America/New_York",
};

const SEARCH_RESPONSE = {
  results: [{ id: "journal-9", score: 0.9 }],
  timezone: "America/New_York",
};

describe("journals command (current behavior golden)", () => {
  // ---- dispatcher errors ----------------------------------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["wat"], ctx), "Unknown journals subcommand: wat");
  });

  // ---- list -----------------------------------------------------------------

  it("list --json prints the raw server response", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/journals") {
        return Response.json(LIST_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["list", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(LIST_RESPONSE);
  });

  it("list with no --limit omits the limit param entirely (released request shape)", async () => {
    let seenUrl = "";
    const ctx = proxyContext((request) => {
      seenUrl = request.url;
      return Response.json({ journals: [], timezone: "UTC" });
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["list"], ctx);
    } finally {
      restore();
    }
    const url = new URL(seenUrl);
    expect(url.pathname).toBe("/v1/journals");
    expect(url.searchParams.get("limit")).toBe(null);
    expect(url.searchParams.get("cursor")).toBe(null);
    expect(url.search).toBe("");
    expect(logs.join("\n")).toContain("- (none)");
  });

  it("list markdown renders journals with pagination", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("limit")).toBe("5");
      return Response.json(LIST_RESPONSE);
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["list", "--limit", "5"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Journals");
    expect(out).toContain("- timezone: America/New_York");
    expect(out).toContain("### Journal journal-1");
    expect(out).toContain("- state: READY");
    expect(out).toContain("First journal line one.");
    expect(out).toContain("First journal line two.");
    expect(out).toContain("### Journal journal-2");
    expect(out).toContain("- state: PREPARING");
    expect(out).toContain("(empty)");
    expect(out).toContain("-----");
    expect(out).toContain("## Pagination");
    expect(out).toContain("- next_cursor: CURSOR2");
  });

  it("list forwards a cursor", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("cursor")).toBe("ABC");
      return Response.json({ journals: [], timezone: "UTC" });
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["list", "--cursor", "ABC"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("- (none)");
  });

  it("list rejects a bad --limit", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      journalsCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("list rejects a missing --cursor value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["list", "--cursor"], ctx), "--cursor requires a value");
  });

  it("list rejects unknown option", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("list rejects unexpected positionals", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- search ---------------------------------------------------------------

  it("search posts query + limit to /v1/search/journals", async () => {
    let body: unknown;
    const ctx = proxyContext(async (request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/search/journals");
      expect(request.method).toBe("POST");
      body = await request.json();
      return Response.json(SEARCH_RESPONSE);
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["search", "--query", "weekend", "--limit", "5"], ctx);
    } finally {
      restore();
    }
    expect(body).toEqual({ query: "weekend", limit: 5 });
    expect(logs.join("\n")).toContain("# Journal Search");
  });

  it("search defaults limit to 10 when --limit is omitted", async () => {
    let body: unknown;
    const ctx = proxyContext(async (request) => {
      body = await request.json();
      return Response.json(SEARCH_RESPONSE);
    });
    const { restore } = captureLogs();
    try {
      await journalsCommand.run(["search", "--query", "weekend"], ctx);
    } finally {
      restore();
    }
    expect(body).toEqual({ query: "weekend", limit: 10 });
  });

  it("search --json prints the raw server response", async () => {
    const ctx = proxyContext(() => Response.json(SEARCH_RESPONSE));
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["search", "--query", "weekend", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(SEARCH_RESPONSE);
  });

  it("search requires --query", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["search"], ctx), "Missing query. Provide --query.");
  });

  it("search rejects an empty --query value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["search", "--query", "   "], ctx), "--query requires a value");
  });

  it("search accepts an over-max --limit (CLI does not cap; server/MCP clamps)", async () => {
    const ctx = proxyContext(() => Response.json({ results: [] }));
    const { restore } = captureLogs();
    try {
      await journalsCommand.run(["search", "--query", "x", "--limit", "50"], ctx);
    } finally {
      restore();
    }
  });

  // ---- get ------------------------------------------------------------------

  it("get --json prints the raw detail", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/journals/journal-7") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["get", "journal-7", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(DETAIL_RESPONSE);
  });

  it("get markdown renders the detail document", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/journals/journal-7") {
        return Response.json(DETAIL_RESPONSE);
      }
      return Response.json({});
    });
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["get", "journal-7"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Journal journal-7");
    expect(out).toContain("- timezone: America/New_York");
    expect(out).toContain("- state: ANALYZING");
    expect(out).toContain("- created_at:");
    expect(out).toContain("- updated_at:");
    expect(out).toContain("Detail body line.");
  });

  it("get markdown reports no data for an unparseable detail", async () => {
    const ctx = proxyContext(() => Response.json({ nope: true }));
    const { logs, restore } = captureLogs();
    try {
      await journalsCommand.run(["get", "journal-x"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toBe("# Journal journal-x\n\n- (no data)\n");
  });

  it("get rejects a missing id", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["get"], ctx), "Missing journal id.");
  });

  it("get rejects extra args", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(journalsCommand.run(["get", "a", "b"], ctx), "Unexpected arguments: a b");
  });
});
