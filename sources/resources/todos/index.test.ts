import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { todosCommand } from "@/commands/todos";

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

describe("todos command (registry-derived)", () => {
  // ---- error paths (released strings) ---------------------------------------

  it("requires a subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run([], ctx), "Missing subcommand. Use list.");
  });

  it("rejects an unknown subcommand", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["wat"], ctx), "Unknown todos subcommand: wat");
  });

  it("rejects a bad --limit on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      todosCommand.run(["list", "--limit", "0"], ctx),
      "--limit must be a positive integer"
    );
  });

  it("rejects unexpected positionals on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["list", "extra"], ctx), "Unexpected arguments: extra");
  });

  it("rejects an unknown option on list", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["list", "--nope"], ctx), "Unknown option: --nope");
  });

  it("rejects missing id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["get"], ctx), "Missing todo id.");
  });

  it("rejects a non-numeric id on get", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["get", "abc"], ctx), "Todo id must be a positive integer.");
  });

  it("rejects missing text on create", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["create"], ctx), "Missing todo text. Provide --text.");
  });

  it("rejects update with no fields", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(todosCommand.run(["update", "5"], ctx), "Provide at least one field to update.");
  });

  it("rejects update with no id before checking fields", async () => {
    const ctx = proxyContext(() => Response.json({}));
    // Released parseUpdateArgs reports the missing id BEFORE "at least one field".
    await expectError(todosCommand.run(["update"], ctx), "Missing todo id.");
  });

  it("rejects update with both --alarm-at and --clear-alarm", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      todosCommand.run(["update", "5", "--alarm-at", "2026-01-01T00:00:00Z", "--clear-alarm"], ctx),
      "Use either --alarm-at or --clear-alarm, not both."
    );
  });

  it("rejects a bad --completed on update", async () => {
    const ctx = proxyContext(() => Response.json({}));
    await expectError(
      todosCommand.run(["update", "5", "--completed", "maybe"], ctx),
      "--completed must be true or false"
    );
  });

  // ---- list success ---------------------------------------------------------

  it("lists todos as markdown with open/completed split and pagination", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        timezone: "UTC",
        next_cursor: "abc",
        todos: [
          { id: 1, text: "open one", alarm_at: null, completed: false, created_at: 1_700_000_000 },
          { id: 2, text: "done one", alarm_at: null, completed: true, created_at: 1_700_000_000 },
        ],
      })
    );
    const { logs, restore } = captureLogs();
    try {
      await todosCommand.run(["list"], ctx);
    } finally {
      restore();
    }
    const out = logs.join("\n");
    expect(out).toContain("# Todos");
    expect(out).toContain("## Open");
    expect(out).toContain("### Todo 1");
    expect(out).toContain("## Completed");
    expect(out).toContain("### Todo 2");
    expect(out).toContain("## Pagination");
    expect(out).toContain("- next_cursor: abc");
  });

  it("lists todos as raw JSON (includes completed) with --json", async () => {
    const body = {
      timezone: "UTC",
      next_cursor: "abc",
      todos: [
        { id: 1, text: "open one", alarm_at: null, completed: false, created_at: 1_700_000_000 },
        { id: 2, text: "done one", alarm_at: null, completed: true, created_at: 1_700_000_000 },
      ],
    };
    const ctx = proxyContext(() => Response.json(body));
    const { logs, restore } = captureLogs();
    try {
      await todosCommand.run(["list", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(body);
  });

  it("passes limit and cursor through to the list endpoint", async () => {
    let seen = "";
    const ctx = proxyContext((request) => {
      seen = new URL(request.url).search;
      return Response.json({ todos: [] });
    });
    const { restore } = captureLogs();
    try {
      await todosCommand.run(["list", "--limit", "5", "--cursor", "c1", "--json"], ctx);
    } finally {
      restore();
    }
    expect(seen).toBe("?limit=5&cursor=c1");
  });

  // ---- get / create / update / delete success -------------------------------

  it("gets a todo and renders the document", async () => {
    const ctx = proxyContext(() =>
      Response.json({
        timezone: "UTC",
        todo: { id: 9, text: "the todo", alarm_at: null, completed: false, created_at: 1_700_000_000 },
      })
    );
    const { logs, restore } = captureLogs();
    try {
      await todosCommand.run(["get", "9"], ctx);
    } finally {
      restore();
    }
    expect(logs.join("\n")).toContain("# Todo 9");
  });

  it("gets a todo as raw JSON with --json", async () => {
    const body = {
      timezone: "UTC",
      todo: { id: 9, text: "the todo", alarm_at: null, completed: false, created_at: 1_700_000_000 },
    };
    const ctx = proxyContext(() => Response.json(body));
    const { logs, restore } = captureLogs();
    try {
      await todosCommand.run(["get", "9", "--json"], ctx);
    } finally {
      restore();
    }
    expect(JSON.parse(logs.join("\n"))).toEqual(body);
  });

  it("creates a todo with --text and --alarm-at", async () => {
    let method = "";
    let bodyText = "";
    const ctx = proxyContext(async (request) => {
      method = request.method;
      bodyText = await request.text();
      return Response.json({ id: 3, text: "buy milk", alarm_at: "x", completed: false, created_at: 1 });
    });
    const { restore } = captureLogs();
    try {
      await todosCommand.run(["create", "--text", "buy milk", "--alarm-at", "2026-01-01T00:00:00Z", "--json"], ctx);
    } finally {
      restore();
    }
    expect(method).toBe("POST");
    expect(JSON.parse(bodyText)).toEqual({ text: "buy milk", alarm_at: "2026-01-01T00:00:00Z" });
  });

  it("updates a todo clearing the alarm", async () => {
    let bodyText = "";
    let method = "";
    const ctx = proxyContext(async (request) => {
      method = request.method;
      bodyText = await request.text();
      return Response.json({ id: 5, text: "t", alarm_at: null, completed: true, created_at: 1 });
    });
    const { restore } = captureLogs();
    try {
      await todosCommand.run(["update", "5", "--completed", "true", "--clear-alarm", "--json"], ctx);
    } finally {
      restore();
    }
    expect(method).toBe("PUT");
    expect(JSON.parse(bodyText)).toEqual({ completed: true, alarm_at: null });
  });

  it("deletes a todo", async () => {
    let method = "";
    const ctx = proxyContext((request) => {
      method = request.method;
      return Response.json({ ok: true });
    });
    const { restore } = captureLogs();
    try {
      await todosCommand.run(["delete", "5", "--json"], ctx);
    } finally {
      restore();
    }
    expect(method).toBe("DELETE");
  });
});
