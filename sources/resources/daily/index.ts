// daily resource: CLI `daily list|get|find` on the shared resource architecture.
// Two MCP tools live here:
//   - bee_list_daily_summaries  (= the `list` action, MCP date-range variant)
//   - bee_get_daily_summary     (= the `find` action, id-or-date lookup)
// The CLI `get` subcommand has no MCP twin (it is a plain /v1/daily/{id} fetch),
// so its action omits the mcp block.
//
// Surface divergence in `list`: the CLI hits /v1/daily with a raw cursor and
// returns the server response (with next_cursor); the MCP tool clamps the page to
// max(limit,30), filters by startDate/endDate, and returns
// {daily_summaries, timezone}. coerceInput selects the variant by surface; run
// owns both endpoint shapes.
import { printJson } from "@/client/clientApi";
import { coerceLimit, coerceOptionalString, coerceRequiredId, optionalIdArg, optionalNumber } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { arrayProp, asRecord, itemDay, parseJson } from "@/resources/json";
import { idNumber, limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ActionResult, ResourceModule } from "@/resources/types";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  type OutputFormat,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee daily list [--limit N] [--cursor CURSOR] [--json]",
  "bee daily get <id> [--json]",
  "bee daily find <YYYY-MM-DD> [--json]",
].join("\n");

// ---- list (= bee_list_daily_summaries + CLI `daily list`) -------------------

type DailyListInput =
  | { variant: "cli"; limit: number | undefined; cursor: string | undefined }
  | { variant: "mcp"; limit: number; startDate: string | undefined; endDate: string | undefined };

const listDaily: ActionDefinition<DailyListInput> = {
  mcp: {
    name: "bee_list_daily_summaries",
    description:
      "List Bee daily summaries over a date range to find days with relevant captured conversations or activity.",
    inputSchema: objectSchema({
      properties: {
        startDate: { type: "string", description: "Start date as YYYY-MM-DD." },
        endDate: { type: "string", description: "End date as YYYY-MM-DD." },
        limit: limitSchema(30, "Maximum summaries to return."),
      },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--limit", kind: "int" },
      { name: "--cursor", kind: "string" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      if (format === "json") {
        printJson(result.data);
        return;
      }
      const payload = parseDailyList(result.data);
      const nowMs = Date.now();
      const timeZone = resolveTimeZone(payload.timezone);
      const lines: string[] = ["# Daily Summaries", ""];
      lines.push(formatTimeZoneHeader(timeZone), "");

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
        lines.push("-----", "");
        lines.push("## Pagination", "");
        lines.push(`- next_cursor: ${payload.next_cursor}`, "");
      }

      console.log(lines.join("\n"));
    },
  },
  coerceInput: (raw, surface): DailyListInput => {
    if (surface === "cli") {
      // CLI: parser already produced a positive int (or omitted it). No clamp.
      const limitValue = typeof raw["limit"] === "number" ? (raw["limit"] as number) : undefined;
      return { variant: "cli", limit: limitValue, cursor: coerceOptionalString(raw["cursor"]) };
    }
    return {
      variant: "mcp",
      limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 30 }),
      startDate: coerceOptionalString(raw["startDate"]),
      endDate: coerceOptionalString(raw["endDate"]),
    };
  },
  run: async (ctx, input) => {
    if (input.variant === "cli") {
      // Raw /v1/daily passthrough with optional limit + cursor.
      const params = new URLSearchParams();
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }
      const suffix = params.toString();
      const path = suffix ? `/v1/daily?${suffix}` : "/v1/daily";
      return { kind: "json", data: parseJson(await apiGet(ctx, path)) };
    }
    // MCP: clamp page to max(limit,30), filter by date range, project to
    // {daily_summaries, timezone}.
    const data = parseJson(await apiGet(ctx, `/v1/daily?limit=${Math.max(input.limit, 30)}`));
    const { startDate, endDate, limit: max } = input;
    const summaries = arrayProp(data, "daily_summaries")
      .filter((item) => {
        const key = itemDay(item);
        return (!startDate || (key !== null && key >= startDate)) &&
          (!endDate || (key !== null && key <= endDate));
      })
      .slice(0, max);
    return { kind: "json", data: { daily_summaries: summaries, timezone: asRecord(data).timezone ?? null } };
  },
};

// ---- get (= CLI `daily get <id>`; no MCP twin) ------------------------------

type DailyGetInput = { id: number };

const getDaily: ActionDefinition<DailyGetInput> = {
  cli: {
    subcommand: "get",
    // `id` is declared NON-required so the shared argv parser does NOT run
    // parseRequiredId itself (which would emit "Missing id." for zero args). The
    // two id failures use different casing, which a single arityMessage cannot
    // express:
    //   - zero args  -> "Missing daily summary id."
    //   - bad value  -> "Daily summary id must be a positive integer."
    //   - >1 token   -> "Unexpected arguments: <rest>" (generic arity)
    // So the id is validated in coerceInput (CLI surface) and the >1-token arity
    // falls through to the generic parser message.
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: renderDailyDetail,
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      const value = raw["id"];
      if (typeof value !== "string") {
        throw new Error("Missing daily summary id.");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Daily summary id must be a positive integer.");
      }
      return { id: parsed };
    }
    return { id: coerceRequiredId(raw["id"], surface) };
  },
  run: async (ctx, input) => {
    return { kind: "json", data: parseJson(await apiGet(ctx, `/v1/daily/${input.id}`)) };
  },
};

// ---- find (= bee_get_daily_summary + CLI `daily find <date>`) ---------------

type DailyFindInput = { id: number | null; date: string | undefined };

const findDaily: ActionDefinition<DailyFindInput> = {
  mcp: {
    name: "bee_get_daily_summary",
    description:
      "Get a Bee daily summary by ID or YYYY-MM-DD date, including context from conversations and other wearable-captured activity.",
    inputSchema: objectSchema({
      properties: {
        id: idNumber("Bee daily summary ID."),
        date: { type: "string", description: "Date as YYYY-MM-DD." },
      },
    }),
  },
  cli: {
    // `date` is declared as a non-id positional. The shared argv parser coerces
    // REQUIRED positionals with parseRequiredId (they are ids elsewhere), so a
    // date positional must be declared required:false and validated in
    // coerceInput, which owns the "Missing date." / "Date must be YYYY-MM-DD."
    // messages. 2+ tokens fall through to "Unexpected arguments: ...".
    subcommand: "find",
    positionals: [{ name: "date", required: false }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      if (format === "json") {
        printJson(result.data);
        return;
      }
      const data = result.data;
      if (
        data &&
        typeof data === "object" &&
        (data as { dailySummary?: unknown }).dailySummary === null
      ) {
        const date = (data as { date?: unknown }).date;
        console.log(`No daily summary found for ${typeof date === "string" ? date : ""}.`);
        return;
      }
      renderDailyDetail({ kind: "json", data }, format);
    },
  },
  coerceInput: (raw, surface): DailyFindInput => {
    if (surface === "cli") {
      // CLI `find <date>`: missing -> "Missing date.", malformed -> "Date must be
      // YYYY-MM-DD." (the >1 token case is already handled by the argv parser's
      // arity check -> "Unexpected arguments").
      const date = raw["date"];
      if (typeof date !== "string") {
        throw new Error("Missing date.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Date must be YYYY-MM-DD.");
      }
      return { id: null, date };
    }
    // MCP bee_get_daily_summary: id OR date.
    const id = optionalIdArg(raw["id"]);
    if (id !== null) {
      return { id, date: undefined };
    }
    const date = coerceOptionalString(raw["date"]);
    if (!date) {
      throw new Error("Provide id or date.");
    }
    return { id: null, date };
  },
  run: async (ctx, input) => {
    if (input.id !== null) {
      return { kind: "json", data: parseJson(await apiGet(ctx, `/v1/daily/${input.id}`)) };
    }
    const date = input.date as string;
    const data = parseJson(await apiGet(ctx, "/v1/daily?limit=100"));
    const match = arrayProp(data, "daily_summaries").find((item) => itemDay(item) === date);
    if (!match) {
      return { kind: "json", data: { date, dailySummary: null } };
    }
    const matchId = optionalNumber(asRecord(match).id);
    if (matchId === null) {
      return { kind: "json", data: { date, dailySummary: match } };
    }
    return { kind: "json", data: parseJson(await apiGet(ctx, `/v1/daily/${matchId}`)) };
  },
};

export const dailyResource: ResourceModule = {
  cliCommand: {
    name: "daily",
    description: "List daily summaries.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown daily subcommand: ",
  },
  actions: [listDaily, getDaily, findDaily],
};

// ---- markdown rendering -----------------------------------------------------

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

function renderDailyDetail(result: ActionResult, format: OutputFormat): void {
  if (result.kind !== "json") {
    return;
  }
  if (format === "json") {
    printJson(result.data);
    return;
  }
  const data = result.data;
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
  lines.push(`- date: ${formatDateValue(resolvedDate, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatQuotedText(summary.summary ?? ""));
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
    return ["(empty)"];
  }
  return normalized.split(/\r?\n/);
}
