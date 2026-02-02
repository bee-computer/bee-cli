import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE = "bee [--staging] facts list [--limit N] [--cursor <cursor>] [--confirmed <true|false>]";

export const factsCommand: Command = {
  name: "facts",
  description: "List developer facts.",
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
      default:
        throw new Error(`Unknown facts subcommand: ${subcommand}`);
    }
  },
};

type ListOptions = {
  limit?: number;
  cursor?: string;
  confirmed?: "true" | "false";
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
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }
  if (options.confirmed !== undefined) {
    params.set("confirmed", options.confirmed);
  }

  const suffix = params.toString();
  const path = suffix ? `/v1/facts?${suffix}` : "/v1/facts";
  const data = await requestDeveloperJson(context, path, { method: "GET" });
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
      options.cursor = value;
      i += 1;
      continue;
    }

    if (arg === "--confirmed") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--confirmed requires a value");
      }
      const normalized = value.toLowerCase();
      if (normalized !== "true" && normalized !== "false") {
        throw new Error("--confirmed must be true or false");
      }
      options.confirmed = normalized;
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
