import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLoginArgs, validateProxyConnection } from "./index";

type BunServer = ReturnType<typeof Bun.serve>;

const activeServers: BunServer[] = [];
const cleanupPaths: string[] = [];

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true);
  }
  for (const path of cleanupPaths.splice(0, cleanupPaths.length)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("login command", () => {
  it("parses --proxy flag", () => {
    expect(parseLoginArgs(["--proxy", "http://127.0.0.1:8787"])).toEqual({
      proxy: "http://127.0.0.1:8787",
      tokenStdin: false,
      qr: false,
      noWait: false,
    });
  });

  it("parses --no-wait flag (defaults off)", () => {
    expect(parseLoginArgs([])).toEqual({ tokenStdin: false, qr: false, noWait: false });
    expect(parseLoginArgs(["--no-wait"])).toEqual({ tokenStdin: false, qr: false, noWait: true });
  });

  it("allows --no-wait with --qr", () => {
    expect(parseLoginArgs(["--no-wait", "--qr"])).toEqual({
      tokenStdin: false,
      qr: true,
      noWait: true,
    });
  });

  it("rejects --no-wait with --token", () => {
    expect(() => parseLoginArgs(["--no-wait", "--token", "abc"])).toThrow(
      "--no-wait cannot be used with --token or --token-stdin."
    );
  });

  it("rejects --no-wait with --token-stdin", () => {
    expect(() => parseLoginArgs(["--no-wait", "--token-stdin"])).toThrow(
      "--no-wait cannot be used with --token or --token-stdin."
    );
  });

  it("rejects --no-wait with --proxy", () => {
    expect(() => parseLoginArgs(["--no-wait", "--proxy", "http://127.0.0.1:8787"])).toThrow(
      "--no-wait cannot be used with --proxy."
    );
  });

  it("rejects --proxy with --token", () => {
    expect(() => parseLoginArgs(["--proxy", "http://127.0.0.1:8787", "--token", "abc"])).toThrow(
      "Use either --proxy or --token, not both."
    );
  });

  it("rejects --proxy with --token-stdin", () => {
    expect(() => parseLoginArgs(["--proxy", "/tmp/proxy.sock", "--token-stdin"])).toThrow(
      "Use either --proxy or --token-stdin, not both."
    );
  });

  it("validates HTTP proxy endpoint using /v1/me", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json({
          id: 42,
          first_name: "Test",
          last_name: "User",
        }),
    });
    activeServers.push(server);

    const user = await validateProxyConnection("prod", `http://127.0.0.1:${server.port}`);
    expect(user).toEqual({
      id: 42,
      first_name: "Test",
      last_name: "User",
    });
  });

  it("validates unix socket proxy endpoint using /v1/me", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-cli-login-proxy-"));
    cleanupPaths.push(dir);
    const socketPath = join(dir, "proxy.sock");

    const server = Bun.serve({
      unix: socketPath,
      fetch: () =>
        Response.json({
          id: 7,
          first_name: "Socket",
          last_name: null,
        }),
    });
    activeServers.push(server);

    const user = await validateProxyConnection("prod", socketPath);
    expect(user).toEqual({
      id: 7,
      first_name: "Socket",
      last_name: null,
    });
  });
});
