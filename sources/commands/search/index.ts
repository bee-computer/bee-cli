import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatRecordMarkdown,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE =
  "bee search --query <text> [--limit N] [--since <epochMs>] [--until <epochMs>] [--neural] [--json]";

export const searchCommand: Command = {
  name: "search",
  description: "Search developer data.",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    const options = parseSearchArgs(remaining);
    await handleSearch(options, format, context);
  },
};

type SearchOptions = {
  query: string;
  limit?: number;
  since?: number;
  until?: number;
  neural: boolean;
};

async function handleSearch(
  options: SearchOptions,
  format: "markdown" | "json",
  context: CommandContext
): Promise<void> {
  const body: { query: string; limit?: number; since?: number; until?: number } =
    {
      query: options.query,
    };

  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.since !== undefined) {
    body.since = options.since;
  }
  if (options.until !== undefined) {
    body.until = options.until;
  }

  const endpoint = options.neural
    ? "/v1/search/conversations/neural"
    : "/v1/search/conversations";
  const data = await requestClientJson(context, endpoint, {
    method: "POST",
    json: body,
  });
  if (format === "json") {
    printJson(data);
    return;
  }

  const nowMs = Date.now();
  const payload = parseSearchResults(data);
  const title = options.neural
    ? "Conversation Search Results"
    : "Search Results";
  if (!payload) {
    const timeZone = resolveTimeZone(parseSearchTimezone(data));
    console.log(
      formatRecordMarkdown({
        title,
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
    return;
  }

  const lines: string[] = [`# ${title}`, ""];
  if (payload.results.length === 0) {
    lines.push("- (none)", "");
  } else {
    const timeZone = resolveTimeZone(payload.timezone);
    for (const result of payload.results) {
      if (options.neural) {
        const { record, summary } = normalizeConversationRecord(result);
        lines.push(
          formatConversationRecordMarkdown({
            title: `Conversation ${result.id ?? "unknown"}`,
            record,
            summary,
            timeZone,
            nowMs,
            headingLevel: 3,
          }).trimEnd()
        );
        lines.push("");
        continue;
      }
      lines.push(
        formatRecordMarkdown({
          title: `Result ${result.id ?? "unknown"}`,
          record: result,
          timeZone,
          nowMs,
          headingLevel: 3,
        }).trimEnd()
      );
      lines.push("");
    }
  }

  if (payload.total !== null) {
    lines.push("-----", "");
    lines.push("## Summary", "");
    lines.push(`- total: ${payload.total}`, "");
  }

  console.log(lines.join("\n"));
}

function parseSearchArgs(args: readonly string[]): SearchOptions {
  let query: string | undefined;
  let limit: number | undefined;
  let since: number | undefined;
  let until: number | undefined;
  let neural = false;
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
      throw new Error("--cursor is no longer supported. Use --since/--until.");
    }

    if (arg === "--neural") {
      neural = true;
      continue;
    }

    if (arg === "--since") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--since requires a value");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error("--since must be a valid epoch timestamp");
      }
      since = parsed;
      i += 1;
      continue;
    }

    if (arg === "--until") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--until requires a value");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error("--until must be a valid epoch timestamp");
      }
      until = parsed;
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

  const options: SearchOptions = { query, neural };
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (since !== undefined) {
    options.since = since;
  }
  if (until !== undefined) {
    options.until = until;
  }

  return options;
}

type SearchResultItem = Record<string, unknown> & {
  id?: number | string;
};

function formatConversationRecordMarkdown(options: {
  title: string;
  record: Record<string, unknown>;
  summary: string;
  timeZone: string;
  nowMs: number;
  headingLevel: number;
}): string {
  const { summary } = options;
  const base = formatRecordMarkdown(options).trimEnd();
  return `${base}\n\nsummary: ${summary}`;
}

function normalizeConversationRecord(
  conversation: SearchResultItem
): { record: Record<string, unknown>; summary: string } {
  const record: Record<string, unknown> = { ...conversation };
  const detailedRaw = record["detailed_summary"];
  const shortRaw = record["short_summary"];
  const summaryRaw = record["summary"];

  delete record["detailed_summary"];
  delete record["short_summary"];
  delete record["summary"];
  delete record["fields"];

  const detailedText = normalizeSummaryText(detailedRaw);
  const shortText = normalizeSummaryText(shortRaw);
  const summaryText = normalizeSummaryText(summaryRaw);
  const summary =
    detailedText ?? shortText ?? summaryText ?? "(no explicit answer)";

  return { record, summary };
}

function normalizeSummaryText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSearchResults(
  payload: unknown
): {
  results: SearchResultItem[];
  total: number | null;
  timezone: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as {
    results?: unknown;
    total?: unknown;
    timezone?: unknown;
  };
  if (!Array.isArray(data.results)) {
    return null;
  }
  return {
    results: data.results as SearchResultItem[],
    total: typeof data.total === "number" ? data.total : null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseSearchTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { timezone?: unknown };
  return typeof record.timezone === "string" ? record.timezone : null;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
