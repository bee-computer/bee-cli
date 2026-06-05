import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  callBeeTextTool,
  parsePositiveInt,
  printToolData,
} from "@/commands/mcpToolOutput";
import {
  formatDateValue,
  formatTimeZoneHeader,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee journals list [--limit N] [--cursor <cursor>] [--json]",
  "bee journals search --query <text> [--limit N] [--json]",
  "bee journals get <id> [--json]",
].join("\n");

export const journalsCommand: Command = {
  name: "journals",
  description: "List developer journals.",
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
      case "search":
        await handleSearch(rest, context);
        return;
      case "get":
        await handleGet(rest, context);
        return;
      default:
        throw new Error(`Unknown journals subcommand: ${subcommand}`);
    }
  },
};

type SearchOptions = {
  query: string;
  limit?: number;
};

async function handleSearch(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseSearchArgs(remaining);
  const data = await callBeeTextTool(context, "bee_search_voice_notes", {
    query: options.query,
    limit: options.limit,
  });
  printToolData("Journal Search", data, format);
}

function parseSearchArgs(args: readonly string[]): SearchOptions {
  let query: string | undefined;
  let limit: number | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--query") {
      const value = args[i + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("--query requires a value");
      }
      query = value;
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      limit = parsePositiveInt(args[i + 1], "--limit", 20);
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

  const options: SearchOptions = { query };
  if (limit !== undefined) {
    options.limit = limit;
  }
  return options;
}

type ListOptions = {
  limit?: number;
  cursor?: string;
};

type JournalSummary = {
  id: string;
  text: string | null;
  state: "PREPARING" | "ANALYZING" | "READY";
  created_at: number;
  updated_at: number;
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
  const path = suffix ? `/v1/journals?${suffix}` : "/v1/journals";
  const data = await requestClientJson(context, path, { method: "GET" });
  if (format === "json") {
    printJson(data);
    return;
  }

  const payload = parseJournalList(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(payload.timezone);
  const lines: string[] = ["# Journals", "", formatTimeZoneHeader(timeZone), ""];

  if (payload.journals.length === 0) {
    lines.push("- (none)", "");
  } else {
    payload.journals.forEach((journal, index) => {
      lines.push(...formatJournalSummaryBlock(journal, nowMs, timeZone, "###"));
      if (index < payload.journals.length - 1) {
        lines.push("-----", "");
      }
    });
  }

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
  const data = await requestClientJson(context, `/v1/journals/${id}`, {
    method: "GET",
  });
  if (format === "json") {
    printJson(data);
    return;
  }

  const payload = parseJournalDetail(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(payload?.timezone ?? null);
  const journal = payload?.journal;
  if (!journal) {
    console.log(`# Journal ${id}\n\n- (no data)\n`);
    return;
  }

  const lines: string[] = [`# Journal ${journal.id}`, ""];
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- state: ${journal.state}`);
  lines.push(`- created_at: ${formatDateValue(journal.created_at, timeZone, nowMs)}`);
  lines.push(`- updated_at: ${formatDateValue(journal.updated_at, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatJournalText(journal.text));
  lines.push("");

  console.log(lines.join("\n"));
}

function parseId(args: readonly string[]): string {
  if (args.length === 0) {
    throw new Error("Missing journal id.");
  }
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }
  return args[0] ?? "";
}

function parseJournalList(payload: unknown): {
  journals: JournalSummary[];
  next_cursor: string | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid journals response.");
  }
  const data = payload as {
    journals?: JournalSummary[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.journals)) {
    throw new Error("Invalid journals response.");
  }
  return {
    journals: data.journals,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseJournalDetail(payload: unknown): {
  journal: JournalSummary;
  timezone: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as JournalSummary & { timezone?: string };
  if (
    typeof data.id !== "string" ||
    typeof data.state !== "string" ||
    typeof data.created_at !== "number" ||
    typeof data.updated_at !== "number"
  ) {
    return null;
  }
  return {
    journal: {
      id: data.id,
      text: data.text ?? null,
      state: data.state as JournalSummary["state"],
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function formatJournalSummaryBlock(
  journal: JournalSummary,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Journal ${journal.id}`, "");
  lines.push(`- state: ${journal.state}`);
  lines.push(`- created_at: ${formatDateValue(journal.created_at, timeZone, nowMs)}`);
  lines.push(`- updated_at: ${formatDateValue(journal.updated_at, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatJournalText(journal.text));
  lines.push("");
  return lines;
}

function formatJournalText(text: string | null): string[] {
  const normalized = text?.trim() ?? "";
  if (!normalized) {
    return ["(empty)"];
  }
  return normalized.split(/\r?\n/);
}
