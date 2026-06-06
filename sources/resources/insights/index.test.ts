import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { insightsCommand } from "@/commands/insights";

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

describe("insights command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run(["wat"], ctx), "Unknown insights subcommand: wat");
  });

  it("rejects a bad --limit on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      insightsCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects an unknown option on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  it("rejects unexpected positionals on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run(["get", "1", "2"], ctx), "Unexpected arguments: 1 2");
  });

  it("rejects a non-numeric insight id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(insightsCommand.run(["get", "abc"], ctx), "insight id must be a positive integer.");
  });

  // ---- success paths --------------------------------------------------------

  it("lists insights with the default limit and prints JSON verbatim", async () => {
    let requestedPath = "";
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      requestedPath = `${url.pathname}${url.search}`;
      return Response.json({ insights: [{ id: 1, title: "A" }], timezone: "UTC" });
    });

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await insightsCommand.run(["list", "--json"], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(requestedPath).toBe("/v1/insights?limit=10");
    const parsed = JSON.parse(logs.join("\n")) as { insights: unknown[]; timezone: string };
    expect(parsed.insights).toEqual([{ id: 1, title: "A" }]);
    expect(parsed.timezone).toBe("UTC");
  });

  it("honors --limit on list", async () => {
    let requestedPath = "";
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      requestedPath = `${url.pathname}${url.search}`;
      return Response.json({ insights: [], timezone: "UTC" });
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await insightsCommand.run(["list", "--limit", "5", "--json"], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(requestedPath).toBe("/v1/insights?limit=5");
  });

  it("gets one insight by id as JSON via /v1/insights/:id", async () => {
    let requestedPath = "";
    const ctx = proxyContext((request) => {
      requestedPath = new URL(request.url).pathname;
      return Response.json({ id: 2, title: "B", timezone: "UTC" });
    });

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await insightsCommand.run(["get", "2", "--json"], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(requestedPath).toBe("/v1/insights/2");
    const parsed = JSON.parse(logs.join("\n")) as { id: number; title: string; timezone: string };
    expect(parsed).toEqual({ id: 2, title: "B", timezone: "UTC" });
  });
});
