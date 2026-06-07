import type { CommandContext } from "@/commands/types";
import { handleMcpJsonRpc, MAX_MCP_MESSAGE_BYTES } from "@/mcp/server";
import type { JsonValue } from "@/mcp/types";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_HTTP_PORT = 8790;
const MAX_PORT_ATTEMPTS = 50;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;

export type McpHttpOptions = {
  port?: number;
  token?: string;
};

export async function serveMcpHttp(
  context: CommandContext,
  options: McpHttpOptions
): Promise<ReturnType<typeof Bun.serve>> {
  const hostname = "127.0.0.1";
  const token = options.token ?? process.env["BEE_MCP_HTTP_TOKEN"];
  if (!token) {
    throw new Error(
      "An auth token is required. Pass --token <value> or set BEE_MCP_HTTP_TOKEN " +
      "(at least 32 characters; e.g. `openssl rand -hex 32`)."
    );
  }
  validateToken(token);
  const idleTimeout = DEFAULT_IDLE_TIMEOUT_SECONDS;

  const serverOptions: ServerOptions = {
    hostname,
    idleTimeout,
    fetch: async (request, activeServer) => {
      activeServer.timeout(request, idleTimeout);
      return await handleHttpRequest(request, context, token);
    },
  };
  if (options.port !== undefined) {
    serverOptions.port = options.port;
  }
  const { server, port } = startServer(serverOptions);

  const endpoint = `http://${hostname}:${port}/mcp`;
  console.log("Bee MCP HTTP server is running.");
  console.log(`Endpoint: ${endpoint}`);
  console.log("Use POST with JSON-RPC 2.0. Press Ctrl+C to stop.");
  console.log('Authenticate with your configured token: "Authorization: Bearer <token>".');

  registerShutdownHandlers(server);

  return server;
}

const liveServers = new Set<ReturnType<typeof Bun.serve>>();
let shutdownHandlersRegistered = false;

function registerShutdownHandlers(server: ReturnType<typeof Bun.serve>): void {
  liveServers.add(server);

  if (shutdownHandlersRegistered) {
    return;
  }
  shutdownHandlersRegistered = true;

  const shutdown = (): void => {
    for (const live of liveServers) {
      live.stop(true);
    }
    liveServers.clear();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Exposed for tests: number of servers currently tracked for shutdown. */
export function liveServerCount(): number {
  return liveServers.size;
}

type ServerOptions = {
  hostname: string;
  idleTimeout: number;
  port?: number;
  fetch: (
    request: Request,
    server: Bun.Server<undefined>
  ) => Promise<Response>;
};

function startServer(options: ServerOptions): {
  server: ReturnType<typeof Bun.serve>;
  port: number;
} {
  if (options.port !== undefined) {
    const server = tryStartServer(options, options.port);
    if (!server) {
      throw new Error(`Port ${options.port} is in use. Choose another with --port.`);
    }
    return { server, port: options.port };
  }

  for (let offset = 0; offset <= MAX_PORT_ATTEMPTS; offset += 1) {
    const port = DEFAULT_HTTP_PORT + offset;
    const server = tryStartServer(options, port);
    if (server) {
      return { server, port };
    }
  }

  throw new Error("No free port found. Specify one with --port.");
}

function tryStartServer(
  options: ServerOptions,
  port: number
): ReturnType<typeof Bun.serve> | null {
  try {
    return Bun.serve({
      hostname: options.hostname,
      port,
      idleTimeout: options.idleTimeout,
      maxRequestBodySize: MAX_MCP_MESSAGE_BYTES,
      fetch: options.fetch,
    });
  } catch (error) {
    if (isAddressInUseError(error)) {
      return null;
    }
    throw error;
  }
}

async function handleHttpRequest(
  request: Request,
  context: CommandContext,
  token: string
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== "/mcp" && url.pathname !== "/health") {
    return new Response("Not Found", { status: 404 });
  }

  if (!isLocalRequest(request)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!isAuthorized(request, token)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": "Bearer",
      },
    });
  }

  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, name: "Bee MCP" });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        allow: "POST",
        "cache-control": "no-store",
      },
    });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_MCP_MESSAGE_BYTES) {
      return new Response("Payload Too Large", { status: 413 });
    }
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_MCP_MESSAGE_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return jsonResponse({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    }, 400);
  }

  const result = await handleMcpJsonRpc(parsed, context);
  if (result === null) {
    return new Response(null, {
      status: 202,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  return jsonResponse(result);
}

function isAuthorized(request: Request, token: string): boolean {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, ...parts] = authHeader.split(" ");
    const bearer = parts.join(" ").trim();
    if (scheme?.toLowerCase() === "bearer" && secureEqual(bearer, token)) {
      return true;
    }
  }

  return false;
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isAllowedHost(host: string | null): boolean {
  if (host === null) {
    return false;
  }
  const withoutPort = stripPort(host);
  return ALLOWED_HOSTS.has(withoutPort.toLowerCase());
}

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

function isLocalRequest(request: Request): boolean {
  if (!isAllowedHost(request.headers.get("host"))) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return isAllowedHost(originHost);
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function jsonResponse(value: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function validateToken(token: string): void {
  if (token.length < 32) {
    throw new Error("BEE_MCP_HTTP_TOKEN must be at least 32 characters.");
  }
}

function isAddressInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("eaddrinuse") ||
    (message.includes("failed to start server") &&
      message.includes("port") &&
      message.includes("use"));
}
