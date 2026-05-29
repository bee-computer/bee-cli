import type { Command, CommandContext } from "@/commands/types";
import { requireClientToken } from "@/client/clientApi";
import {
  DEFAULT_PROXY_SOCKET_PATH,
  expandHomePath,
} from "@/utils/proxyAddress";
import { existsSync, unlinkSync } from "node:fs";

const USAGE = "bee proxy [--port N] [--idle-timeout SECONDS]\nbee proxy --socket [path] [--idle-timeout SECONDS]";
const DEFAULT_PORT = 8787;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;
const MAX_PORT_ATTEMPTS = 50;

type ProxyOptions = {
  port?: number;
  socketPath?: string;
  idleTimeoutSeconds?: number;
};

type ProxyFetch = (
  this: Bun.Server<undefined>,
  request: Request,
  server: Bun.Server<undefined>
) => Promise<Response>;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const proxyCommand: Command = {
  name: "proxy",
  description: "Start a local HTTP proxy for the Bee API.",
  usage: USAGE,
  run: async (args, context) => {
    const options = parseProxyArgs(args);
    await startProxy(context, options);
  },
};

export function parseProxyArgs(args: readonly string[]): ProxyOptions {
  let port: number | undefined;
  let socketPath: string | undefined;
  let idleTimeoutSeconds: number | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--port") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--port requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
      port = parsed;
      i += 1;
      continue;
    }

    if (arg === "--socket") {
      const nextValue = args[i + 1];
      if (nextValue === undefined || nextValue.startsWith("-")) {
        socketPath = DEFAULT_PROXY_SOCKET_PATH;
      } else {
        socketPath = nextValue;
        i += 1;
      }
      continue;
    }

    if (arg === "--idle-timeout") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--idle-timeout requires a value");
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--idle-timeout must be a non-negative integer");
      }
      idleTimeoutSeconds = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  if (port !== undefined && socketPath !== undefined) {
    throw new Error("--port and --socket cannot be used together");
  }

  const options: ProxyOptions = {};
  if (port !== undefined) {
    options.port = port;
  }
  if (socketPath !== undefined) {
    options.socketPath = socketPath;
  }
  if (idleTimeoutSeconds !== undefined) {
    options.idleTimeoutSeconds = idleTimeoutSeconds;
  }
  return options;
}

export async function startProxy(
  context: CommandContext,
  options: ProxyOptions
): Promise<ReturnType<typeof Bun.serve>> {
  const token = await requireClientToken(context);
  if (!token) {
    throw new Error('Not logged in. Run "bee login" first.');
  }

  const socketPath = options.socketPath ? expandHomePath(options.socketPath) : undefined;
  if (socketPath && existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const idleTimeout = options.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS;

  const fetchProxyRequest: ProxyFetch = async (request, server) => {
    server.timeout(request, idleTimeout);

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1")) {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers(request.headers);
    for (const header of HOP_BY_HOP_HEADERS) {
      headers.delete(header);
    }
    headers.delete("host");
    headers.delete("content-length");
    headers.set("authorization", `Bearer ${token}`);

    const init: RequestInit = {
      method: request.method,
      headers,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const response = await context.client.fetch(
      `${url.pathname}${url.search}`,
      init
    );

    const responseHeaders = new Headers(response.headers);
    for (const header of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(header);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  };

  let server: ReturnType<typeof Bun.serve>;
  let listenAddress: string;

  if (socketPath) {
    server = Bun.serve({
      unix: socketPath,
      fetch: fetchProxyRequest,
    });
    listenAddress = `unix://${socketPath}`;
  } else {
    const hostname = "127.0.0.1";
    const port = await pickPort(options.port);
    server = Bun.serve({
      hostname,
      port,
      idleTimeout,
      fetch: fetchProxyRequest,
    });
    listenAddress = `http://${hostname}:${port}`;
  }

  const baseUrl = context.client.baseUrl;
  console.log(`Proxy listening on ${listenAddress}`);
  console.log(`Forwarding /v1 requests to ${baseUrl}`);
  console.log("Press Ctrl+C to stop.");

  return server;
}

async function pickPort(requested?: number): Promise<number> {
  if (requested !== undefined) {
    const available = await isPortAvailable(requested);
    if (!available) {
      throw new Error(`Port ${requested} is in use. Choose another with --port.`);
    }
    return requested;
  }

  for (let offset = 0; offset <= MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = DEFAULT_PORT + offset;
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error("No free port found. Specify one with --port.");
}

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("ok"),
    });
    server.stop();
    return true;
  } catch (error) {
    if (isAddressInUseError(error)) {
      return false;
    }
    throw error;
  }
}

function isAddressInUseError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("EADDRINUSE");
  }
  return false;
}
