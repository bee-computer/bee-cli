// The `today` resource holds two distinct capabilities that share a file for
// co-location only:
//
//   * todayBrief  — the CLI default. Hits /v1/todayBrief and renders the
//                   "Today Brief" markdown. It has NO mcp block.
//   * todayContext (= bee_get_today) — the 5-GET wearable-context aggregation. It
//                   has an mcp block; the CLI reaches it via the `--context` flag.
//
// Their run() and render() logic is deliberately kept SEPARATE (briefRun/briefRender
// vs contextRun/contextRender). They must NOT be unified: the default path and the
// --context path fetch different endpoints and project different shapes.
//
// The shared CLI dispatcher selects a single CLI action per command, so the lone
// CLI action (todayCli) branches on `--context` to the appropriate brief/context
// pair. The mcp side dispatches bee_get_today straight to contextRun.
import { printJson } from "@/client/clientApi";
import { printToolData } from "@/commands/mcpToolOutput";
import { apiGet } from "@/resources/http";
import { arrayProp, asRecord, itemDay, localDateKey, parseJson } from "@/resources/json";
import { emptySchema } from "@/resources/schema";
import type { ActionContext, ActionDefinition, ActionResult, ResourceModule } from "@/resources/types";
import { formatRecordMarkdown, type OutputFormat, resolveTimeZone } from "@/utils/markdown";

const USAGE = "bee today [--context] [--json]";

// ---- today brief (CLI default, /v1/todayBrief) ------------------------------

async function briefRun(ctx: ActionContext): Promise<ActionResult> {
  const data = parseJson(await apiGet(ctx, "/v1/todayBrief"));
  return { kind: "json", data };
}

function briefRender(result: ActionResult, format: OutputFormat): void {
  if (result.kind !== "json") {
    return;
  }
  if (format === "json") {
    printJson(result.data);
    return;
  }
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(parseTodayTimezone(result.data));
  console.log(
    formatRecordMarkdown({
      title: "Today Brief",
      record: normalizeRecord(result.data),
      timeZone,
      nowMs,
    })
  );
}

function parseTodayTimezone(value: unknown): string | null {
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

// ---- today context (= bee_get_today, 5-GET aggregation) ---------------------

async function contextRun(ctx: ActionContext): Promise<ActionResult> {
  const day = localDateKey(new Date());
  const [brief, conversations, daily, journals, todos] = await Promise.all([
    apiGet(ctx, "/v1/todayBrief"),
    apiGet(ctx, "/v1/conversations?limit=30"),
    apiGet(ctx, "/v1/daily?limit=30"),
    apiGet(ctx, "/v1/journals?limit=30"),
    apiGet(ctx, "/v1/todos?limit=50"),
  ]);
  return {
    kind: "json",
    data: {
      date: day,
      todayBrief: parseJson(brief),
      dailySummary: arrayProp(parseJson(daily), "daily_summaries").find((item) => itemDay(item) === day) ?? null,
      activeTodos: arrayProp(parseJson(todos), "todos").filter((item) => asRecord(item).completed !== true).slice(0, 10),
      recentNotes: arrayProp(parseJson(journals), "journals").filter((item) => itemDay(item) === day).slice(0, 5),
      recentConversations: arrayProp(parseJson(conversations), "conversations").filter((item) => itemDay(item) === day).slice(0, 5),
    },
  };
}

function contextRender(result: ActionResult, format: OutputFormat): void {
  if (result.kind !== "json") {
    return;
  }
  printToolData("Today", result.data, format);
}

// ---- todayContext: MCP-only action (bee_get_today) --------------------------

const todayContext: ActionDefinition<Record<string, never>> = {
  mcp: {
    name: "bee_get_today",
    description: "Show today's Bee wearable context: daily summary, active todos, notes, and captured conversations.",
    inputSchema: emptySchema,
  },
  coerceInput: () => ({}),
  run: (ctx) => contextRun(ctx),
};

// ---- todayCli: the single CLI entry point -----------------------------------
// `bee today` defaults to the brief; `--context` switches to the wearable-context
// aggregation. The two paths keep their own run/render (see the note at the top).

type TodayCliInput = { context: boolean };

const todayCli: ActionDefinition<TodayCliInput> = {
  cli: {
    flags: [{ name: "--context", kind: "bool" }],
    render: (result, format, _ctx, raw) => {
      if (raw["context"] === true) {
        contextRender(result, format);
        return;
      }
      briefRender(result, format);
    },
  },
  coerceInput: (raw) => ({ context: raw["context"] === true }),
  run: (ctx, input) => (input.context ? contextRun(ctx) : briefRun(ctx)),
};

export const todayResource: ResourceModule = {
  cliCommand: {
    name: "today",
    description:
      "Fetch today's brief (calendar events and emails). With --context, return Bee wearable context instead (daily summary, active todos, notes, captured conversations).",
    usage: USAGE,
  },
  actions: [todayContext, todayCli],
};
