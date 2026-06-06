// insights domain. Migrated onto the Resource Action Registry following the
// shared resource pattern. Two actions:
//   list (= bee_get_insights) and get (= bee_get_insight).
import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit, coerceOptionalString, coerceRequiredId, cursorSuffix } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { arrayProp, asRecord, parseJson } from "@/resources/json";
import { cursor as cursorSchema, idNumber, limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = [
  "bee insights list [--limit N] [--json]",
  "bee insights get <id> [--json]",
].join("\n");

// ---- list (= bee_get_insights) ----------------------------------------------

type InsightsListInput = { limit: number; cursor: string | undefined };

const listInsights: ActionDefinition<InsightsListInput> = {
  mcp: {
    name: "bee_get_insights",
    description: "List recent Bee insights. Paginate with cursor using the returned next_cursor.",
    inputSchema: objectSchema({
      properties: { limit: limitSchema(50, "Maximum insights to return."), cursor: cursorSchema },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--limit", kind: "int", max: 50 },
      // insights list gains --cursor (allowed since defaults are unchanged); the
      // tool already paginated, so this only adds an input path.
      { name: "--cursor", kind: "string" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Insights", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    // Released CLI passed an optional limit to the tool, which defaulted to 10 and
    // clamped to [1,50] via numberArg. coerceLimit reproduces both surfaces.
    limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 50 }),
    cursor: coerceOptionalString(raw["cursor"]),
  }),
  run: async (ctx, input) => {
    const data = parseJson(
      await apiGet(ctx, `/v1/insights?limit=${input.limit}${cursorSuffix(input.cursor)}`)
    );
    return { kind: "json", data };
  },
};

// ---- get (= bee_get_insight) ------------------------------------------------

type InsightGetInput = { id: number };

const getInsight: ActionDefinition<InsightGetInput> = {
  mcp: {
    name: "bee_get_insight",
    description: "Get one Bee insight by ID.",
    inputSchema: objectSchema({
      properties: { id: idNumber("Bee insight ID.") },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "get",
    positionals: [{ name: "id", required: true, label: "insight id" }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Insight", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({ id: coerceRequiredId(raw["id"], surface) }),
  run: async (ctx, input) => {
    const data = parseJson(await apiGet(ctx, "/v1/insights?limit=100"));
    const insight =
      arrayProp(data, "insights").find((item) => String(asRecord(item).id) === String(input.id)) ?? null;
    return { kind: "json", data: { insight, timezone: asRecord(data).timezone ?? null } };
  },
};

export const insightsResource: ResourceModule = {
  cliCommand: {
    name: "insights",
    description: "List Bee insights.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown insights subcommand: ",
  },
  actions: [listInsights, getInsight],
};
