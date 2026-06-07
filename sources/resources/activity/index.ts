import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit } from "@/resources/coerce";
import { apiGet, optionalApiJson } from "@/resources/http";
import { arrayProp, asRecord, jsonString, parseJson, timeValue } from "@/resources/json";
import { limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = "bee activity [--limit N] [--json]";

// ---- recent (= bee_get_recent_activity) -------------------------------------

type ActivityRecentInput = { limit: number };

const recentActivity: ActionDefinition<ActivityRecentInput> = {
  mcp: {
    name: "bee_get_recent_activity",
    description: "Show recent activity captured by Bee: conversations, summaries, notes, todos, and insights.",
    inputSchema: objectSchema({
      properties: { limit: limitSchema(20) },
    }),
  },
  cli: {
    // single-verb command: no subcommand, so the dispatcher selects the lone action.
    flags: [{ name: "--limit", kind: "int", max: 20 }],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Recent Activity", result.data, format);
    },
  },
  // CLI omitted --limit -> fallback 10 (no clamp). MCP clamps to [1,20] via
  // numberArg with the same fallback.
  coerceInput: (raw, surface) => ({
    limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 20 }),
  }),
  run: async (ctx, input) => {
    const { limit } = input;
    const [conversations, daily, journals, todos] = await Promise.all([
      apiGet(ctx, `/v1/conversations?limit=${limit}`),
      apiGet(ctx, `/v1/daily?limit=${limit}`),
      apiGet(ctx, `/v1/journals?limit=${limit}`),
      apiGet(ctx, `/v1/todos?limit=${limit}`),
    ]);
    const insights = await optionalApiJson(ctx, `/v1/insights?limit=${limit}`);
    const activity = [
      ...arrayProp(parseJson(conversations), "conversations").map((item) => ({ type: "conversation", at: asRecord(item).start_time, ...asRecord(item) })),
      ...arrayProp(parseJson(daily), "daily_summaries").map((item) => ({ type: "daily_summary", at: asRecord(item).date_time ?? asRecord(item).created_at, ...asRecord(item) })),
      ...arrayProp(parseJson(journals), "journals").map((item) => ({ type: "voice_note", at: asRecord(item).created_at, ...asRecord(item) })),
      ...arrayProp(parseJson(todos), "todos").map((item) => ({ type: "todo", at: asRecord(item).created_at, ...asRecord(item) })),
      ...arrayProp(insights, "insights").map((item) => ({ type: "insight", at: asRecord(item).generated_at, ...asRecord(item) })),
    ].sort((left, right) => timeValue(right.at) - timeValue(left.at)).slice(0, limit);
    // Round-trip through jsonString/parseJson so undefined `at` fields are
    // stripped identically on both surfaces: the MCP adapter re-serializes data,
    // and printToolData renders this exact object.
    return { kind: "json", data: parseJson(jsonString({ activity })) };
  },
};

export const activityResource: ResourceModule = {
  cliCommand: {
    name: "activity",
    description: "Show recent Bee activity across conversations, summaries, notes, todos, and insights.",
    usage: USAGE,
  },
  actions: [recentActivity],
};
