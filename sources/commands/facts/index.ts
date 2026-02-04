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
  "bee facts list [--limit N] [--cursor <cursor>] [--confirmed <true|false>] [--json]",
  "bee facts get <id> [--json]",
  "bee facts create --text <text> [--json]",
  "bee facts update <id> --text <text> [--confirmed <true|false>] [--json]",
  "bee facts delete <id> [--json]",
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
      case "delete":
        await handleDelete(rest, context);
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseListArgs(remaining);
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
  const data = await requestClientJson(context, path, { method: "GET" });
  if (format === "json") {
    printJson(data);
    return;
  }
  const payload = parseFactsList(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone();
  const confirmed = payload.facts.filter((fact) => fact.confirmed);
  const pending = payload.facts.filter((fact) => !fact.confirmed);

  const lines: string[] = ["# Facts", ""];
  lines.push("## Confirmed", "");
  lines.push(...formatFactsSection(confirmed, nowMs, timeZone, "###"));
  lines.push("## Pending", "");
  lines.push(...formatFactsSection(pending, nowMs, timeZone, "###"));

  if (payload.next_cursor) {
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
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/facts/${id}`, {
    method: "GET",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const timeZone = resolveTimeZone();
  const fact = parseFactPayload(data);
  if (fact) {
    console.log(formatFactDocument(fact, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Fact",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseCreateArgs(remaining);
  const data = await requestClientJson(context, "/v1/facts", {
    method: "POST",
    json: { text: options.text },
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const timeZone = resolveTimeZone();
  const fact = parseFactPayload(data);
  if (fact) {
    console.log(formatFactDocument(fact, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Fact",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseUpdateArgs(remaining);
  const body: { text: string; confirmed?: boolean } = { text: options.text };
  if (options.confirmed !== undefined) {
    body.confirmed = options.confirmed;
  }

  const data = await requestClientJson(context, `/v1/facts/${options.id}`, {
    method: "PUT",
    json: body,
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const timeZone = resolveTimeZone();
  const fact = parseFactPayload(data);
  if (fact) {
    console.log(formatFactDocument(fact, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Fact",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
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

async function handleDelete(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/facts/${id}`, {
    method: "DELETE",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const timeZone = resolveTimeZone();
  const fact = parseFactPayload(data);
  if (fact) {
    console.log(formatFactDocument(fact, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Fact",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
}

type Fact = {
  id: number;
  text: string;
  tags: string[];
  created_at: number;
  confirmed: boolean;
};

function parseFactsList(
  payload: unknown
): { facts: Fact[]; next_cursor: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid facts response.");
  }
  const data = payload as {
    facts?: Fact[];
    next_cursor?: string | null;
  };
  if (!Array.isArray(data.facts)) {
    throw new Error("Invalid facts response.");
  }
  return {
    facts: data.facts,
    next_cursor: data.next_cursor ?? null,
  };
}

function parseFactPayload(payload: unknown): Fact | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ("fact" in payload) {
    const fact = (payload as { fact?: Fact }).fact;
    if (fact) {
      return fact;
    }
  }

  const record = payload as Partial<Fact>;
  if (
    typeof record.id === "number" &&
    typeof record.text === "string" &&
    typeof record.created_at === "number" &&
    typeof record.confirmed === "boolean" &&
    Array.isArray(record.tags)
  ) {
    return record as Fact;
  }

  return null;
}

function formatFactsSection(
  facts: Fact[],
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  if (facts.length === 0) {
    return ["- (none)", ""];
  }

  const lines: string[] = [];
  for (const fact of facts) {
    lines.push(...formatFactBlock(fact, nowMs, timeZone, headingPrefix));
  }
  return lines;
}

function formatFactDocument(
  fact: Fact,
  nowMs: number,
  timeZone: string
): string {
  return formatFactBlock(fact, nowMs, timeZone, "#").join("\n");
}

function formatFactBlock(
  fact: Fact,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Fact ${fact.id}`, "");
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- created_at: ${formatDateValue(fact.created_at, timeZone, nowMs)}`);
  lines.push(`- confirmed: ${fact.confirmed ? "true" : "false"}`);
  lines.push(`- tags: ${fact.tags.length > 0 ? fact.tags.join(", ") : "(none)"}`);
  lines.push(`- text: ${fact.text.trim() || "(empty)"}`);
  lines.push("");
  return lines;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
