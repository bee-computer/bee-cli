import type { Command, CommandContext } from "@/commands/types";

const USAGE = "bee ping [--count N]";
const PING_PATH = "/v1/me";
const TIMEOUT_MS = 5000;

function parseCount(args: readonly string[]): number {
  let count = 1;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--count") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--count requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--count must be a positive integer");
      }
      count = parsed;
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

  return count;
}

async function pingServer(context: CommandContext): Promise<void> {
  const response = await context.client.fetch(PING_PATH, {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status < 200 || response.status >= 600) {
    throw new Error(`Unexpected response status: ${response.status}`);
  }
}

export const pingCommand: Command = {
  name: "ping",
  description: "Run a quick connectivity check.",
  usage: USAGE,
  run: async (args, context) => {
    const count = parseCount(args);

    for (let i = 0; i < count; i += 1) {
      await pingServer(context);
      console.log("pong");
    }
  },
};
