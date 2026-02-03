import type { Command, CommandContext } from "@/commands/types";
import { requireToken } from "@/commands/developerApi";

const USAGE = "bee proxy [--port N]";
const DEFAULT_PORT = 8787;
const MAX_PORT_ATTEMPTS = 50;

type ProxyOptions = {
  port?: number;
};

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

function parseProxyArgs(args: readonly string[]): ProxyOptions {
  let port: number | undefined;
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

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  const options: ProxyOptions = {};
  if (port !== undefined) {
    options.port = port;
  }
  return options;
}

async function startProxy(
  context: CommandContext,
  options: ProxyOptions
): Promise<void> {
  const token = await requireToken(context);
  const port = await pickPort(options.port);
  const hostname = "127.0.0.1";

  Bun.serve({
    hostname,
    port,
    fetch: async (request) => {
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
    },
  });

  const baseUrl = context.client.baseUrl;
  console.log(`Proxy listening on http://${hostname}:${port}`);
  console.log(`Forwarding /v1 requests to ${baseUrl}`);
  console.log("Press Ctrl+C to stop.");
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
