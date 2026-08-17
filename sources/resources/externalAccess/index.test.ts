import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { makeCliCommand } from "@/commands/registry";
import { externalAccessResource } from "@/resources/externalAccess";

const externalAccessCommand = makeCliCommand(externalAccessResource);

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

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return { logs, restore: () => spy.mockRestore() };
}

const RESPONSE = {
  external_access: [
    {
      id: "ck1234567890123456789012",
      service: "google",
      type: "calendar",
      description: "Read calendar events",
      summary: null,
      created_at: 1_776_508_800_000,
      updated_at: 1_776_508_900_000,
    },
  ],
  next_cursor: "v1-1776508800000-ck1234567890123456789012",
  timezone: "America/Los_Angeles",
};

describe("external-access command", () => {
  it("requires the list subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expect(externalAccessCommand.run([], ctx)).rejects.toThrow(
      "Missing subcommand. Use list."
    );
  });

  it("lists external access without overriding the server default limit", async () => {
    let requestUrl = "";
    const ctx = proxyContext((request) => {
      requestUrl = request.url;
      return Response.json(RESPONSE);
    });
    const { logs, restore } = captureLogs();
    try {
      await externalAccessCommand.run(["list"], ctx);
    } finally {
      restore();
    }

    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/v1/external-access");
    expect(url.search).toBe("");
    const output = logs.join("\n");
    expect(output).toContain("# External Access");
    expect(output).toContain("- timezone: America/Los_Angeles");
    expect(output).toContain("- service: google");
    expect(output).toContain("- type: calendar");
  });

  it("forwards limit and cursor", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Response.json({ external_access: [], next_cursor: null, timezone: "UTC" });
    });
    const { restore } = captureLogs();
    try {
      await externalAccessCommand.run(
        ["list", "--limit", "10", "--cursor", "next-page"],
        ctx
      );
    } finally {
      restore();
    }
  });

  it("prints the raw response as JSON", async () => {
    const ctx = proxyContext(() => Response.json(RESPONSE));
    const { logs, restore } = captureLogs();
    try {
      await externalAccessCommand.run(["list", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(RESPONSE);
  });
});
