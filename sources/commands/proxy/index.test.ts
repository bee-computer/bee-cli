import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "@/commands/types";
import { saveToken } from "@/secureStore";
import { parseProxyArgs, startProxy } from "./index";

describe("proxy command", () => {
  const originalConfigDir = process.env["BEE_CONFIG_DIR"];
  const originalForceFileStore = process.env["BEE_FORCE_FILE_STORE"];
  type BunServer = ReturnType<typeof Bun.serve>;
  const activeServers: BunServer[] = [];
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bee-cli-proxy-command-"));
    process.env["BEE_CONFIG_DIR"] = tempDir;
    process.env["BEE_FORCE_FILE_STORE"] = "1";
  });

  afterEach(() => {
    for (const server of activeServers.splice(0, activeServers.length)) {
      server.stop(true);
    }
    if (originalConfigDir === undefined) {
      delete process.env["BEE_CONFIG_DIR"];
    } else {
      process.env["BEE_CONFIG_DIR"] = originalConfigDir;
    }
    if (originalForceFileStore === undefined) {
      delete process.env["BEE_FORCE_FILE_STORE"];
    } else {
      process.env["BEE_FORCE_FILE_STORE"] = originalForceFileStore;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("parses --socket with default path", () => {
    expect(parseProxyArgs(["--socket"])).toEqual({ socketPath: "~/.bee/proxy.sock" });
  });

  it("parses --socket with explicit path", () => {
    expect(parseProxyArgs(["--socket", "/tmp/custom.sock"])).toEqual({
      socketPath: "/tmp/custom.sock",
    });
  });

  it("parses --idle-timeout", () => {
    expect(parseProxyArgs(["--port", "9000", "--idle-timeout", "300"])).toEqual({
      port: 9000,
      idleTimeoutSeconds: 300,
    });
  });

  it("allows --idle-timeout 0 to disable idle request timeouts", () => {
    expect(parseProxyArgs(["--idle-timeout", "0"])).toEqual({
      idleTimeoutSeconds: 0,
    });
  });

  it("rejects invalid --idle-timeout values", () => {
    expect(() => parseProxyArgs(["--idle-timeout", "-1"])).toThrow(
      "--idle-timeout must be a non-negative integer"
    );
    expect(() => parseProxyArgs(["--idle-timeout"])).toThrow(
      "--idle-timeout requires a value"
    );
  });

  it("rejects --socket with --port", () => {
    expect(() => parseProxyArgs(["--socket", "/tmp/custom.sock", "--port", "9000"])).toThrow(
      "--port and --socket cannot be used together"
    );
  });

  it("starts unix socket proxy and forwards token auth", async () => {
    let seenAuthorization: string | null = null;
    let seenPath = "";
    await saveToken("prod", "proxy-test-token");

    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        seenAuthorization = request.headers.get("authorization");
        const url = new URL(request.url);
        seenPath = url.pathname;
        return Response.json({ ok: true });
      },
    });
    activeServers.push(upstream);

    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    const context: CommandContext = {
      env: "prod",
      client: {
        env: "prod",
        baseUrl,
        isProxy: false,
        fetch: (path, init) => fetch(new URL(path, baseUrl), init),
      },
    };

    const socketPath = join(tempDir, "local-proxy.sock");
    writeFileSync(socketPath, "stale");

    const proxy = await startProxy(context, { socketPath });
    activeServers.push(proxy);

    const response = await fetch("http://localhost/v1/me", {
      method: "GET",
      unix: socketPath,
    } as RequestInit & { unix: string });

    expect(response.ok).toBe(true);
    expect(seenPath).toBe("/v1/me");
    expect(seenAuthorization ?? "").toBe("Bearer proxy-test-token");
  });
});
