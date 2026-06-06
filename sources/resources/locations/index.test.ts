import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { locationsCommand } from "@/commands/locations";

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

function captureLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return { logs, restore: () => spy.mockRestore() };
}

describe("locations command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run([], ctx), "Missing subcommand. Use recent or current.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run(["wat"], ctx), "Unknown locations subcommand: wat");
  });

  it("rejects a bad --limit on recent", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      locationsCommand.run(["recent", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects --limit without a value on recent", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run(["recent", "--limit"], ctx), "--limit requires a value");
  });

  it("rejects an unknown option on recent", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run(["recent", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals on recent", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run(["recent", "extra"], ctx), "Unexpected arguments: extra");
  });

  it("rejects unexpected positionals on current", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(locationsCommand.run(["current", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- success paths --------------------------------------------------------

  it("requests recent clusters with the released params and defaults", async () => {
    let seenUrl = "";
    const ctx = proxyContext((request) => {
      seenUrl = new URL(request.url).pathname + new URL(request.url).search;
      return Response.json({ clusters: [], timezone: null });
    });
    const { logs, restore } = captureLog();
    try {
      await locationsCommand.run(["recent", "--json"], ctx);
    } finally {
      restore();
    }
    expect(seenUrl).toBe("/v1/locations/clusters?limit=10&include_visits=false");
    expect(JSON.parse(logs.join("\n"))).toEqual({ clusters: [], timezone: null });
  });

  it("passes --limit and --visits through to the cluster request", async () => {
    let seenUrl = "";
    const ctx = proxyContext((request) => {
      seenUrl = new URL(request.url).search;
      return Response.json({ clusters: [] });
    });
    const { restore } = captureLog();
    try {
      await locationsCommand.run(["recent", "--limit", "5", "--visits", "--json"], ctx);
    } finally {
      restore();
    }
    expect(seenUrl).toBe("?limit=5&include_visits=true");
  });

  it("requests the current location endpoint", async () => {
    let seenPath = "";
    const ctx = proxyContext((request) => {
      seenPath = new URL(request.url).pathname;
      return Response.json({ latitude: 1, longitude: 2 });
    });
    const { logs, restore } = captureLog();
    try {
      await locationsCommand.run(["current", "--json"], ctx);
    } finally {
      restore();
    }
    expect(seenPath).toBe("/v1/locations/current");
    expect(JSON.parse(logs.join("\n"))).toEqual({ latitude: 1, longitude: 2 });
  });
});
