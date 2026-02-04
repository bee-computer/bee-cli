import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee todos list [--limit N] [--cursor <cursor>] [--json]",
  "bee todos get <id> [--json]",
  "bee todos create --text <text> [--alarm-at <iso>] [--json]",
  "bee todos update <id> [--text <text>] [--completed <true|false>] [--alarm-at <iso> | --clear-alarm] [--json]",
  "bee todos delete <id> [--json]",
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
      case "delete":
        await handleDelete(rest, context);
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseListArgs(remaining);
  const params = new URLSearchParams();

  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }

  const suffix = params.toString();
  const path = suffix ? `/v1/todos?${suffix}` : "/v1/todos";
  const data = await requestClientJson(context, path, { method: "GET" });
  if (format === "json") {
    printJson(data);
    return;
  }
  const payload = parseTodosList(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(payload.timezone);
  const open = payload.todos.filter((todo) => !todo.completed);
  const completed = payload.todos.filter((todo) => todo.completed);

  const lines: string[] = ["# Todos", ""];
  lines.push("## Open", "");
  lines.push(...formatTodosSection(open, nowMs, timeZone, "###"));
  lines.push("## Completed", "");
  lines.push(...formatTodosSection(completed, nowMs, timeZone, "###"));

  if (payload.next_cursor) {
    lines.push("-----", "");
    lines.push("## Pagination", "");
    lines.push(`- next_cursor: ${payload.next_cursor}`, "");
  }

  console.log(lines.join("\n"));
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
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/todos/${id}`, {
    method: "GET",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const { todo, timezone } = parseTodoResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (todo) {
    console.log(formatTodoDocument(todo, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Todo",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseCreateArgs(remaining);
  const body: { text: string; alarm_at?: string } = { text: options.text };
  if (options.alarmAt !== undefined) {
    body.alarm_at = options.alarmAt;
  }

  const data = await requestClientJson(context, "/v1/todos", {
    method: "POST",
    json: body,
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const { todo, timezone } = parseTodoResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (todo) {
    console.log(formatTodoDocument(todo, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Todo",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseUpdateArgs(remaining);
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

  const data = await requestClientJson(context, `/v1/todos/${options.id}`, {
    method: "PUT",
    json: body,
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const { todo, timezone } = parseTodoResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (todo) {
    console.log(formatTodoDocument(todo, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Todo",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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

async function handleDelete(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/todos/${id}`, {
    method: "DELETE",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const { todo, timezone } = parseTodoResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (todo) {
    console.log(formatTodoDocument(todo, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Todo",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
}

type Todo = {
  id: number;
  text: string;
  alarm_at: number | string | null;
  completed: boolean;
  created_at: number;
};

function parseTodosList(
  payload: unknown
): { todos: Todo[]; next_cursor: string | null; timezone: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid todos response.");
  }
  const data = payload as {
    todos?: Todo[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.todos)) {
    throw new Error("Invalid todos response.");
  }
  return {
    todos: data.todos,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseTodoResponse(payload: unknown): {
  todo: Todo | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { todo: null, timezone: null };
  }
  const record = payload as Partial<Todo> & { todo?: Todo; timezone?: string };
  if (record.todo) {
    return {
      todo: record.todo,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  const todoCandidate = record as Partial<Todo>;
  if (
    typeof todoCandidate.id === "number" &&
    typeof todoCandidate.text === "string" &&
    typeof todoCandidate.created_at === "number" &&
    typeof todoCandidate.completed === "boolean"
  ) {
    return {
      todo: todoCandidate as Todo,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  return {
    todo: null,
    timezone: typeof record.timezone === "string" ? record.timezone : null,
  };
}

function formatTodosSection(
  todos: Todo[],
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  if (todos.length === 0) {
    return ["- (none)", ""];
  }

  const lines: string[] = [];
  for (const todo of todos) {
    lines.push(...formatTodoBlock(todo, nowMs, timeZone, headingPrefix));
  }
  return lines;
}

function formatTodoDocument(
  todo: Todo,
  nowMs: number,
  timeZone: string
): string {
  return formatTodoBlock(todo, nowMs, timeZone, "#").join("\n");
}

function formatTodoBlock(
  todo: Todo,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Todo ${todo.id}`, "");
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- created_at: ${formatDateValue(todo.created_at, timeZone, nowMs)}`);
  lines.push(
    `- alarm_at: ${formatDateValue(todo.alarm_at ?? null, timeZone, nowMs)}`
  );
  lines.push(`- completed: ${todo.completed ? "true" : "false"}`);
  lines.push(`- text: ${todo.text.trim() || "(empty)"}`);
  lines.push("");
  return lines;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
