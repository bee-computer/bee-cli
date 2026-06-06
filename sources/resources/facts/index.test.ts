import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { factsCommand } from "@/commands/facts";

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

const SAMPLE_FACT = { id: 12, text: "Likes coffee", tags: ["beverage"], created_at: 0, confirmed: true };

describe("facts command (registry-derived)", () => {
  // ---- subcommand dispatch errors -------------------------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["wat"], ctx), "Unknown facts subcommand: wat");
  });

  // facts has NO `search` CLI subcommand (the released surface is frozen); the
  // bee_search_facts tool is MCP-only.
  it("rejects the search subcommand (not a released CLI verb)", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["search"], ctx), "Unknown facts subcommand: search");
  });

  // ---- list -----------------------------------------------------------------

  it("lists confirmed facts as markdown by default (no limit param, confirmed=true)", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/facts");
      expect(url.searchParams.get("confirmed")).toBe("true");
      expect(url.searchParams.get("limit")).toBe(null);
      return Response.json({
        facts: [{ ...SAMPLE_FACT, id: 1 }, { ...SAMPLE_FACT, id: 2, text: "  " }],
      });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["list"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toBe("# Confirmed Facts\n\n- Likes coffee\n- (empty)");
  });

  it("lists --unconfirmed with confirmed=false and the Pending Facts title + pagination", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("confirmed")).toBe("false");
      expect(url.searchParams.get("limit")).toBe("5");
      return Response.json({
        facts: [{ ...SAMPLE_FACT, id: 3, text: "Pending", confirmed: false }],
        next_cursor: "abc",
      });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["list", "--unconfirmed", "--limit", "5"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toBe(
      "# Pending Facts\n\n- Pending\n-----\n\n## Pagination\n\n- next_cursor: abc\n"
    );
  });

  it("lists facts as --json byte-identically to the server response", async () => {
    const payload = { facts: [SAMPLE_FACT], next_cursor: null };
    const ctx = proxyContext(() => Response.json(payload));
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["list", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(payload);
  });

  it("passes --cursor through to the server", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("cursor")).toBe("nextpage");
      expect(url.searchParams.get("confirmed")).toBe("true");
      return Response.json({ facts: [] });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["list", "--cursor", "nextpage"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toBe("# Confirmed Facts\n\n- (none)\n");
  });

  it("rejects a bad --limit on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      factsCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects --cursor without a value", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["list", "--cursor"], ctx), "--cursor requires a value");
  });

  it("rejects an unknown option on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- get ------------------------------------------------------------------

  it("gets a fact and renders the fact document (bare-fact shape)", async () => {
    const ctx = proxyContext((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/facts/9");
      return Response.json({ id: 9, text: "Hi", tags: ["t"], created_at: 0, confirmed: true });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["get", "9"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Fact 9");
    expect(out).toContain("- text: Hi");
    expect(out).toContain("- tags: t");
  });

  it("gets a fact wrapped under { fact, timezone }", async () => {
    const ctx = proxyContext(() => Response.json({ fact: SAMPLE_FACT, timezone: "UTC" }));
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["get", "12"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Fact 12");
    expect(out).toContain("- timezone: UTC");
  });

  it("rejects a missing fact id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["get"], ctx), "Missing fact id.");
  });

  it("rejects a non-numeric fact id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["get", "abc"], ctx), "Fact id must be a positive integer.");
  });

  it("rejects extra positionals on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["get", "1", "2"], ctx), "Unexpected arguments: 1 2");
  });

  // ---- create ---------------------------------------------------------------

  it("creates a fact via POST", async () => {
    const ctx = proxyContext(async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe("/v1/facts");
      expect(await request.json()).toEqual({ text: "New fact" });
      return Response.json({ id: 3, text: "New fact", tags: [], created_at: 0, confirmed: false });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["create", "--text", "New fact"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Fact 3");
  });

  it("rejects create without --text", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["create"], ctx), "Missing fact text. Provide --text.");
  });

  // ---- update ---------------------------------------------------------------

  it("updates a fact with text and confirmed", async () => {
    const ctx = proxyContext(async (request) => {
      expect(request.method).toBe("PUT");
      expect(new URL(request.url).pathname).toBe("/v1/facts/4");
      expect(await request.json()).toEqual({ text: "Edited", confirmed: false });
      return Response.json({ id: 4, text: "Edited", tags: [], created_at: 0, confirmed: false });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["update", "4", "--text", "Edited", "--confirmed", "false"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Fact 4");
  });

  it("updates a fact with only text (confirmed omitted from body)", async () => {
    const ctx = proxyContext(async (request) => {
      expect(await request.json()).toEqual({ text: "Edited" });
      return Response.json({ id: 4, text: "Edited", tags: [], created_at: 0, confirmed: true });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["update", "4", "--text", "Edited"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("- text: Edited");
  });

  it("rejects update without id", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["update", "--text", "x"], ctx), "Missing fact id.");
  });

  it("rejects update without --text", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["update", "4"], ctx), "Missing fact text. Provide --text.");
  });

  it("rejects update with bad --confirmed", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      factsCommand.run(["update", "4", "--text", "x", "--confirmed", "maybe"], ctx),
      "--confirmed must be true or false"
    );
  });

  // ---- delete ---------------------------------------------------------------

  it("deletes a fact via DELETE", async () => {
    const ctx = proxyContext((request) => {
      expect(request.method).toBe("DELETE");
      expect(new URL(request.url).pathname).toBe("/v1/facts/6");
      return Response.json({ id: 6, text: "Gone", tags: [], created_at: 0, confirmed: true });
    });
    const { logs, restore } = captureLogs();
    try {
      await factsCommand.run(["delete", "6"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Fact 6");
  });

  it("rejects delete without an id", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(factsCommand.run(["delete"], ctx), "Missing fact id.");
  });
});
