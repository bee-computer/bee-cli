import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { conversationsCommand } from "@/commands/conversations";

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

function captureStdout(run: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  return run()
    .then(() => logs)
    .finally(() => {
      logSpy.mockRestore();
    });
}

describe("conversations command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["wat"], ctx), "Unknown conversations subcommand: wat");
  });

  it("rejects an unknown option on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  it("rejects a missing --cursor value on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["list", "--cursor"], ctx), "--cursor requires a value");
  });

  it("rejects a bad --limit on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      conversationsCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects a missing id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["get"], ctx), "Missing conversation id.");
  });

  it("rejects a non-numeric id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["get", "abc"], ctx), "conversation id must be a positive integer.");
  });

  it("rejects a missing id on transcript", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["transcript"], ctx), "Missing conversation id.");
  });

  it("rejects a missing id on related", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["related"], ctx), "Missing conversation id.");
  });

  it("rejects two ids on related", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["related", "1", "2"], ctx), "Unexpected arguments: 1 2");
  });

  it("rejects extra args on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(conversationsCommand.run(["get", "1", "2"], ctx), "Unexpected arguments: 1 2");
  });

  it("rejects a bad --limit on related", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      conversationsCommand.run(["related", "5", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  // ---- list success paths ---------------------------------------------------

  it("lists conversations as JSON byte-identically to the server response", async () => {
    const payload = {
      conversations: [
        {
          id: 1,
          start_time: 1_717_500_000_000,
          end_time: null,
          created_at: 1_717_500_000_000,
          summary: "Talked about the project.",
          state: "COMPLETED",
        },
      ],
      next_cursor: "abc",
      timezone: "America/New_York",
    };
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/conversations");
      return Response.json(payload);
    });

    const logs = await captureStdout(() => conversationsCommand.run(["list", "--json"], ctx));
    expect(JSON.parse(logs.join("\n"))).toEqual(payload);
  });

  it("passes limit and cursor query params on list", async () => {
    let seen = "";
    const ctx = proxyContext((request) => {
      seen = new URL(request.url).search;
      return Response.json({ conversations: [], next_cursor: null, timezone: "UTC" });
    });
    await captureStdout(() => conversationsCommand.run(["list", "--limit", "3", "--cursor", "xyz", "--json"], ctx));
    expect(seen).toBe("?limit=3&cursor=xyz");
  });

  it("renders an empty conversation list as markdown", async () => {
    const ctx = proxyContext(() =>
      Response.json({ conversations: [], next_cursor: null, timezone: "UTC" })
    );
    const logs = await captureStdout(() => conversationsCommand.run(["list"], ctx));
    const out = logs.join("\n");
    expect(out).toContain("# Conversations");
    expect(out).toContain("- (none)");
  });

  it("renders a conversation list with pagination footer", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        conversations: [
          {
            id: 9,
            start_time: 1_717_500_000_000,
            end_time: 1_717_500_900_000,
            created_at: 1_717_500_000_000,
            summary: "A summary.",
            state: "COMPLETED",
          },
        ],
        next_cursor: "nc",
        timezone: "UTC",
      })
    );
    const logs = await captureStdout(() => conversationsCommand.run(["list"], ctx));
    const out = logs.join("\n");
    expect(out).toContain("### Conversation 9");
    expect(out).toContain("`bee conversations get 9`");
    expect(out).toContain("## Pagination");
    expect(out).toContain("- next_cursor: nc");
  });

  // ---- get success paths ----------------------------------------------------

  it("gets a conversation as JSON byte-identically to the server response", async () => {
    const payload = {
      conversation: {
        id: 3,
        start_time: 1_717_500_000_000,
        end_time: 1_717_500_900_000,
        device_type: "Bee",
        summary: "Full summary",
        short_summary: "Short",
        state: "COMPLETED",
        created_at: 1_717_500_000_000,
        updated_at: 1_717_500_900_000,
        transcriptions: [],
        suggested_links: [],
        primary_location: null,
      },
      timezone: "UTC",
    };
    const ctx = proxyContext((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/conversations/3");
      return Response.json(payload);
    });
    const logs = await captureStdout(() => conversationsCommand.run(["get", "3", "--json"], ctx));
    expect(JSON.parse(logs.join("\n"))).toEqual(payload);
  });

  it("renders a conversation detail document as markdown", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        conversation: {
          id: 3,
          start_time: 1_717_500_000_000,
          end_time: 1_717_500_900_000,
          device_type: "Bee",
          summary: "Full summary",
          short_summary: "Short",
          state: "COMPLETED",
          created_at: 1_717_500_000_000,
          updated_at: 1_717_500_900_000,
          transcriptions: [
            {
              id: 1,
              realtime: false,
              utterances: [
                {
                  id: 1,
                  realtime: false,
                  start: null,
                  end: null,
                  spoken_at: 1_717_500_000_000,
                  text: "Hello there",
                  speaker: "SPEAKER_1",
                  created_at: 1_717_500_000_000,
                },
              ],
            },
          ],
          suggested_links: [{ url: "https://example.com", created_at: 1_717_500_000_000 }],
          primary_location: {
            address: "123 Main St",
            latitude: 40.7128,
            longitude: -74.006,
            created_at: 1_717_500_000_000,
          },
        },
        timezone: "UTC",
      })
    );
    const logs = await captureStdout(() => conversationsCommand.run(["get", "3"], ctx));
    const out = logs.join("\n");
    expect(out).toContain("# Conversation 3");
    expect(out).toContain("## Short Summary");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Primary Location");
    expect(out).toContain("123 Main St (40.71280, -74.00600)");
    expect(out).toContain("## Suggested Links");
    expect(out).toContain("https://example.com");
    expect(out).toContain("## Utterances");
    expect(out).toContain("- SPEAKER_1: Hello there");
  });

  it("falls back to formatRecordMarkdown when detail has no conversation", async () => {
    const ctx = proxyContext(() => Response.json({ foo: "bar" }));
    const logs = await captureStdout(() => conversationsCommand.run(["get", "3"], ctx));
    const out = logs.join("\n");
    expect(out).toContain("# Conversation");
  });

  // ---- transcript success path ----------------------------------------------

  it("renders a transcript as markdown via the tool projection", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        conversation: {
          id: 4,
          transcriptions: [
            {
              id: 1,
              realtime: false,
              utterances: [{ id: 1, text: "Hi", speaker: "SPEAKER_1" }],
            },
          ],
        },
      })
    );
    const logs = await captureStdout(() => conversationsCommand.run(["transcript", "4"], ctx));
    const out = logs.join("\n");
    expect(out).toContain("# Conversation Transcript");
  });

  // ---- related success path -------------------------------------------------

  it("renders related conversations from /v1/conversations/:id/related", async () => {
    let requestedPath = "";
    const ctx = proxyContext((request) => {
      requestedPath = new URL(request.url).pathname;
      if (requestedPath === "/v1/conversations/4/related") {
        return Response.json({
          conversations: [{ id: 5, short_summary: "Related A" }, { id: 6, short_summary: "Related B" }],
          timezone: "UTC",
        });
      }
      return Response.json({});
    });
    const logs = await captureStdout(() => conversationsCommand.run(["related", "4", "--limit", "5"], ctx));
    const out = logs.join("\n");
    expect(requestedPath).toBe("/v1/conversations/4/related");
    expect(out).toContain("# Related Conversations");
  });

  it("limits related conversations client-side", async () => {
    const ctx = proxyContext((request) => {
      if (new URL(request.url).pathname === "/v1/conversations/4/related") {
        return Response.json({
          conversations: [{ id: 5 }, { id: 6 }, { id: 7 }],
          timezone: "UTC",
        });
      }
      return Response.json({});
    });
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    try {
      await conversationsCommand.run(["related", "4", "--limit", "2", "--json"], ctx);
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(logs.join("\n")) as { conversations: unknown[] };
    expect(parsed.conversations).toHaveLength(2);
  });
});
