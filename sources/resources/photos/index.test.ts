import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { photosCommand } from "@/commands/photos";

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

describe("photos command (registry-derived)", () => {
  // ---- error paths (released strings, byte-for-byte) ------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run([], ctx), "Missing subcommand. Use list or get.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["wat"], ctx), "Unknown photos subcommand: wat");
  });

  it("rejects missing photo id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["get"], ctx), "Provide exactly one photo id.");
  });

  it("rejects two photo ids on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["get", "1", "2"], ctx), "Provide exactly one photo id.");
  });

  it("rejects a non-numeric photo id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["get", "abc"], ctx), "Photo id must be a positive integer.");
  });

  it("rejects a bad --limit on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      photosCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects a malformed --date on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["list", "--date", "2026/01/01"], ctx), "--date must be YYYY-MM-DD");
  });

  it("rejects an unknown option on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects unexpected positionals on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(photosCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  // ---- success paths --------------------------------------------------------

  it("lists photos as JSON byte-identically to the tool projection", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/daily") {
        return Response.json({
          daily_summaries: [{
            id: 7,
            date: "2026-06-05",
            photos: [{ id: 11 }, { id: 12 }],
          }],
        });
      }
      return Response.json({});
    });

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await photosCommand.run(["list", "--json"], ctx);
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(logs.join("\n")) as { photos: unknown[] };
    expect(parsed.photos).toEqual([
      { id: 11, daily_summary_id: 7, date: "2026-06-05" },
      { id: 12, daily_summary_id: 7, date: "2026-06-05" },
    ]);
  });

  it("get --output writes the image and prints the released summary", async () => {
    const ctx = proxyContext((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/photos/5") {
        return new Response(Buffer.from("imgbytes"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      return Response.json({});
    });

    const out = `${process.env["TMPDIR"] ?? "/tmp"}/bee-photos-test-${Date.now()}.jpg`;
    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await photosCommand.run(["get", "5", "--output", out], ctx);
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.some((line) => line.includes(`Photo 5 written to`))).toBe(true);
    expect(logs.some((line) => line.includes("- mime_type: image/jpeg"))).toBe(true);
    expect(await Bun.file(out).text()).toBe("imgbytes");
  });
});
