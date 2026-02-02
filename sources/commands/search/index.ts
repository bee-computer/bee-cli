import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE =
  "bee [--staging] search conversations --query <text> [--limit N] [--cursor <cursor>]";

export const searchCommand: Command = {
  name: "search",
  description: "Search developer data.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use conversations.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "conversations":
        await handleConversations(rest, context);
        return;
      default:
        throw new Error(`Unknown search subcommand: ${subcommand}`);
    }
  },
};

type ConversationsOptions = {
  query: string;
  limit?: number;
  cursor?: string;
};

async function handleConversations(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseConversationsArgs(args);
  const body: { query: string; limit?: number; cursor?: string } = {
    query: options.query,
  };

  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.cursor !== undefined) {
    body.cursor = options.cursor;
  }

  const data = await requestDeveloperJson(context, "/v1/search/conversations", {
    method: "POST",
    json: body,
  });
  printJson(data);
}

function parseConversationsArgs(args: readonly string[]): ConversationsOptions {
  let query: string | undefined;
  let limit: number | undefined;
  let cursor: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--query") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--query requires a value");
      }
      query = value;
      i += 1;
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
      limit = parsed;
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--cursor requires a value");
      }
      cursor = value;
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

  if (!query) {
    throw new Error("Missing query. Provide --query.");
  }

  const options: ConversationsOptions = { query };
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (cursor !== undefined) {
    options.cursor = cursor;
  }

  return options;
}
