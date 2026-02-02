import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE = [
  "bee [--staging] todos list [--limit N] [--cursor <cursor>]",
  "bee [--staging] todos get <id>",
  "bee [--staging] todos create --text <text> [--alarm-at <iso>]",
  "bee [--staging] todos update <id> [--text <text>] [--completed <true|false>] [--alarm-at <iso> | --clear-alarm]",
].join("\n");

export const todosCommand: Command = {
  name: "todos",
  description: "List developer todos.",
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
        throw new Error(`Unknown todos subcommand: ${subcommand}`);
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
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }

  const suffix = params.toString();
  const path = suffix ? `/v1/todos?${suffix}` : "/v1/todos";
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
  const data = await requestDeveloperJson(context, `/v1/todos/${id}`, {
    method: "GET",
  });
  printJson(data);
}

function parseId(args: readonly string[]): number {
  if (args.length === 0) {
    throw new Error("Missing todo id.");
  }
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }

  return parseIdValue(args[0] ?? "");
}

type CreateOptions = {
  text: string;
  alarmAt?: string;
};

async function handleCreate(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseCreateArgs(args);
  const body: { text: string; alarm_at?: string } = { text: options.text };
  if (options.alarmAt !== undefined) {
    body.alarm_at = options.alarmAt;
  }

  const data = await requestDeveloperJson(context, "/v1/todos", {
    method: "POST",
    json: body,
  });
  printJson(data);
}

function parseCreateArgs(args: readonly string[]): CreateOptions {
  let text: string | undefined;
  let alarmAt: string | undefined;
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

    if (arg === "--alarm-at") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--alarm-at requires a value");
      }
      alarmAt = value;
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
    throw new Error("Missing todo text. Provide --text.");
  }

  const options: CreateOptions = { text };
  if (alarmAt !== undefined) {
    options.alarmAt = alarmAt;
  }

  return options;
}

type UpdateOptions = {
  id: number;
  text?: string;
  completed?: boolean;
  alarmAt?: string | null;
};

async function handleUpdate(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const options = parseUpdateArgs(args);
  const body: {
    text?: string;
    completed?: boolean;
    alarm_at?: string | null;
  } = {};

  if (options.text !== undefined) {
    body.text = options.text;
  }
  if (options.completed !== undefined) {
    body.completed = options.completed;
  }
  if (options.alarmAt !== undefined) {
    body.alarm_at = options.alarmAt;
  }

  const data = await requestDeveloperJson(context, `/v1/todos/${options.id}`, {
    method: "PUT",
    json: body,
  });
  printJson(data);
}

function parseUpdateArgs(args: readonly string[]): UpdateOptions {
  let text: string | undefined;
  let completed: boolean | undefined;
  let alarmAt: string | null | undefined;
  let clearAlarm = false;
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

    if (arg === "--completed") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--completed requires a value");
      }
      completed = parseBoolean(value, "--completed");
      i += 1;
      continue;
    }

    if (arg === "--alarm-at") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--alarm-at requires a value");
      }
      alarmAt = value;
      i += 1;
      continue;
    }

    if (arg === "--clear-alarm") {
      clearAlarm = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error("Missing todo id.");
  }
  if (positionals.length > 1) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  if (clearAlarm && alarmAt !== undefined) {
    throw new Error("Use either --alarm-at or --clear-alarm, not both.");
  }

  if (clearAlarm) {
    alarmAt = null;
  }

  if (text === undefined && completed === undefined && alarmAt === undefined) {
    throw new Error("Provide at least one field to update.");
  }

  const options: UpdateOptions = {
    id: parseIdValue(positionals[0] ?? ""),
  };

  if (text !== undefined) {
    options.text = text;
  }
  if (completed !== undefined) {
    options.completed = completed;
  }
  if (alarmAt !== undefined) {
    options.alarmAt = alarmAt;
  }

  return options;
}

function parseIdValue(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Todo id must be a positive integer.");
  }
  return parsed;
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
