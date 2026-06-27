import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import { createProxyClient } from "@/client";
import { validateCommand, setCommandRegistry } from "./index";

type BunServer = ReturnType<typeof Bun.serve>;

const activeServers: BunServer[] = [];

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true);
  }
});

function createMockContext(server: BunServer): CommandContext {
  return {
    env: "prod",
    client: createProxyClient("prod", {
      address: `http://127.0.0.1:${server.port}`,
    }),
  };
}

describe("validate command", () => {
  it("returns valid:true for known command with auth", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    activeServers.push(server);

    setCommandRegistry([
      { name: "facts", description: "test", usage: "test", run: async () => {} },
    ]);

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      await validateCommand.run(["facts"], createMockContext(server));
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(logs.join(""));
    expect(parsed.valid).toBe(true);
  });

  it("returns valid:false for unknown command", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    activeServers.push(server);

    setCommandRegistry([
      { name: "facts", description: "test", usage: "test", run: async () => {} },
    ]);

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      await validateCommand.run(["boguscmd"], createMockContext(server));
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(logs.join(""));
    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toContain("Unknown command");
    expect(parsed.code).toBe(3);
  });

  it("returns valid:false when no command specified", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    activeServers.push(server);

    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      await validateCommand.run([], createMockContext(server));
    } finally {
      logSpy.mockRestore();
    }

    const parsed = JSON.parse(logs.join(""));
    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toBe("No command specified");
  });
});
