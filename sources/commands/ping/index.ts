import type { Command } from "@/commands/types";

const USAGE = "bee ping [--count N]";

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

export const pingCommand: Command = {
  name: "ping",
  description: "Run a quick connectivity check.",
  usage: USAGE,
  run: async (args, context) => {
    void context;
    const count = parseCount(args);

    for (let i = 0; i < count; i += 1) {
      console.log("pong");
    }
  },
};
