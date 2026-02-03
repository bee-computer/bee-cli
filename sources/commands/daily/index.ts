import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";

const USAGE = [
  "bee daily list [--limit N] [--cursor CURSOR]",
  "bee daily get <id>",
].join("\n");

export const dailyCommand: Command = {
  name: "daily",
  description: "List daily summaries.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use list.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "list":
        await handleList(rest, context);
        return;
      case "get":
        await handleGet(rest, context);
        return;
      default:
        throw new Error(`Unknown daily subcommand: ${subcommand}`);
    }
  },
};

type ListOptions = {
  limit?: number;
  cursor?: string;
};

async function handleList(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseListArgs(args);
  const params = new URLSearchParams();

  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const suffix = params.toString();
  const path = suffix ? `/v1/daily?${suffix}` : "/v1/daily";
  const data = await requestClientJson(context, path, { method: "GET" });
  printJson(data);
}

function parseListArgs(args: readonly string[]): ListOptions {
  const options: ListOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--limit") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--limit requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (arg === "--cursor") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--cursor requires a value");
      }
      if (value.trim().length === 0) {
        throw new Error("--cursor must be a non-empty string");
      }
      options.cursor = value;
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

  return options;
}

async function handleGet(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const id = parseId(args);
  const data = await requestClientJson(context, `/v1/daily/${id}`, {
    method: "GET",
  });
  printJson(data);
}

function parseId(args: readonly string[]): number {
  if (args.length === 0) {
    throw new Error("Missing daily summary id.");
  }
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }

  const parsed = Number.parseInt(args[0] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Daily summary id must be a positive integer.");
  }
  return parsed;
}
