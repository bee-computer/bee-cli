import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE = [
  "bee [--staging] facts list [--limit N] [--cursor <cursor>] [--confirmed <true|false>]",
  "bee [--staging] facts get <id>",
  "bee [--staging] facts create --text <text>",
  "bee [--staging] facts update <id> --text <text> [--confirmed <true|false>]",
].join("\n");

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
      case "get":
        await handleGet(rest, context);
        return;
      case "create":
        await handleCreate(rest, context);
        return;
      case "update":
        await handleUpdate(rest, context);
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

async function handleGet(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const id = parseId(args);
  const data = await requestDeveloperJson(context, `/v1/facts/${id}`, {
    method: "GET",
  });
  printJson(data);
}

function parseId(args: readonly string[]): number {
  if (args.length === 0) {
    throw new Error("Missing fact id.");
  }
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }

  const parsed = Number.parseInt(args[0] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Fact id must be a positive integer.");
  }
  return parsed;
}

type CreateOptions = {
  text: string;
};

async function handleCreate(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseCreateArgs(args);
  const data = await requestDeveloperJson(context, "/v1/facts", {
    method: "POST",
    json: { text: options.text },
  });
  printJson(data);
}

function parseCreateArgs(args: readonly string[]): CreateOptions {
  let text: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--text") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--text requires a value");
      }
      text = value;
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

  if (!text) {
    throw new Error("Missing fact text. Provide --text.");
  }

  return { text };
}

type UpdateOptions = {
  id: number;
  text: string;
  confirmed?: boolean;
};

async function handleUpdate(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseUpdateArgs(args);
  const body: { text: string; confirmed?: boolean } = { text: options.text };
  if (options.confirmed !== undefined) {
    body.confirmed = options.confirmed;
  }

  const data = await requestDeveloperJson(context, `/v1/facts/${options.id}`, {
    method: "PUT",
    json: body,
  });
  printJson(data);
}

function parseUpdateArgs(args: readonly string[]): UpdateOptions {
  let text: string | undefined;
  let confirmed: boolean | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--text") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--text requires a value");
      }
      text = value;
      i += 1;
      continue;
    }

    if (arg === "--confirmed") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--confirmed requires a value");
      }
      confirmed = parseBoolean(value, "--confirmed");
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error("Missing fact id.");
  }
  if (positionals.length > 1) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  if (!text) {
    throw new Error("Missing fact text. Provide --text.");
  }

  const options: UpdateOptions = {
    id: parseId([positionals[0] ?? ""]),
    text,
  };
  if (confirmed !== undefined) {
    options.confirmed = confirmed;
  }

  return options;
}

function parseBoolean(value: string, flagName: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${flagName} must be true or false`);
}
