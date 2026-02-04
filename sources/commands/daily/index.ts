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
  "bee daily list [--limit N] [--cursor CURSOR] [--json]",
  "bee daily get <id> [--json]",
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
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseListArgs(remaining);
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
  if (format === "json") {
    printJson(data);
    return;
  }
  const payload = parseDailyList(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(payload.timezone);
  const lines: string[] = ["# Daily Summaries", ""];

  if (payload.daily_summaries.length === 0) {
    lines.push("- (none)", "");
  } else {
    payload.daily_summaries.forEach((summary, index) => {
      lines.push(...formatDailySummaryBlock(summary, nowMs, timeZone, "###"));
      if (index < payload.daily_summaries.length - 1) {
        lines.push("-----", "");
      }
    });
  }

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
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/daily/${id}`, {
    method: "GET",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const payload = parseDailyDetail(data);
  const timeZone = resolveTimeZone(payload?.timezone ?? null);
  if (!payload) {
    console.log(
      formatRecordMarkdown({
        title: "Daily Summary",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
    return;
  }
  console.log(formatDailyDetailDocument(payload.summary, nowMs, timeZone));
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

type DailySummary = {
  id: number;
  date: string | null;
  date_time: number | null;
  short_summary: string;
  summary: string | null;
  email_summary: string | null;
  calendar_summary: string | null;
  conversations_count: number | null;
  locations: Array<{
    id: number | null;
    latitude: number;
    longitude: number;
    address: string | null;
  }> | null;
  created_at: number | null;
};

type DailySummaryDetail = DailySummary & {
  conversations: Array<{
    id: number;
    start_time: number;
    end_time: number | null;
    short_summary: string | null;
    conversation_uuid: string;
    device_type: string;
    state: string;
    primary_location: {
      address: string | null;
      latitude: number;
      longitude: number;
    } | null;
    bookmarked: boolean;
  }> | null;
};

function parseDailyList(
  payload: unknown
): {
  daily_summaries: DailySummary[];
  next_cursor: string | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid daily response.");
  }
  const data = payload as {
    daily_summaries?: DailySummary[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.daily_summaries)) {
    throw new Error("Invalid daily response.");
  }
  return {
    daily_summaries: data.daily_summaries,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseDailyDetail(payload: unknown): {
  summary: DailySummaryDetail;
  timezone: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as {
    daily_summary?: DailySummaryDetail;
    timezone?: string;
  };
  if (!data.daily_summary) {
    return null;
  }
  return {
    summary: data.daily_summary,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function formatDailySummaryBlock(
  summary: DailySummary,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Daily Summary ${summary.id}`, "");
  const resolvedDate = resolveDailyDate(summary);
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- date: ${formatDateValue(resolvedDate, timeZone, nowMs)}`);
  lines.push("- short_summary:");
  lines.push(...formatQuotedText(summary.short_summary));
  lines.push("");
  return lines;
}

function formatDailyDetailDocument(
  summary: DailySummaryDetail,
  nowMs: number,
  timeZone: string
): string {
  const lines: string[] = [`# Daily Summary ${summary.id}`, ""];

  const resolvedDate = resolveDailyDate(summary);
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- date: ${formatDateValue(resolvedDate, timeZone, nowMs)}`);
  lines.push("");

  lines.push("## Short Summary", "");
  lines.push(...formatQuotedText(summary.short_summary), "");

  if (summary.summary) {
    lines.push("## Summary", "");
    lines.push(summary.summary.trim() || "(empty)", "");
  }

  if (summary.email_summary) {
    lines.push("## Email Summary", "");
    lines.push(summary.email_summary.trim() || "(empty)", "");
  }

  if (summary.calendar_summary) {
    lines.push("## Calendar Summary", "");
    lines.push(summary.calendar_summary.trim() || "(empty)", "");
  }

  lines.push("## Locations", "");
  if (summary.locations && summary.locations.length > 0) {
    for (const location of summary.locations) {
      const address = location.address ?? "unknown";
      lines.push(
        `- ${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`
      );
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Conversations", "");
  if (summary.conversations && summary.conversations.length > 0) {
    for (const conversation of summary.conversations) {
      lines.push(`### Conversation ${conversation.id}`, "");
      lines.push(formatTimeZoneHeader(timeZone));
      lines.push(
        `- start_time: ${formatDateValue(conversation.start_time, timeZone, nowMs)}`
      );
      lines.push(
        `- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`
      );
      lines.push(`- device_type: ${conversation.device_type}`);
      lines.push(`- state: ${conversation.state}`);
      lines.push(`- bookmarked: ${conversation.bookmarked ? "true" : "false"}`);
      if (conversation.primary_location) {
        const location = conversation.primary_location;
        const address = location.address ?? "unknown";
        lines.push(
          `- primary_location: ${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`
        );
      } else {
        lines.push("- primary_location: (none)");
      }
      lines.push("- short_summary:");
      lines.push(...formatQuotedText(conversation.short_summary ?? ""));
      lines.push("");
    }
  } else {
    lines.push("- (none)", "");
  }

  return lines.join("\n");
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function resolveDailyDate(
  summary: Pick<DailySummary, "date" | "date_time" | "created_at">
): number | string | null {
  if (summary.date) {
    return summary.date;
  }
  if (summary.date_time !== null) {
    return summary.date_time;
  }
  return summary.created_at ?? null;
}

function formatQuotedText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return ["> (empty)"];
  }
  return normalized.split(/\r?\n/).map((line) => `> ${line}`);
}
