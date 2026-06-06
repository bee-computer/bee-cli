// locations domain: location clusters + recent visit feed + current location.
// Each renderer uses printToolData; run() owns the single endpoint + params.
import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit, coerceOptionalString } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { parseJson } from "@/resources/json";
import { emptySchema, limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = [
  "bee locations clusters [--limit N] [--min-visits N] [--visits] [--json]",
  "bee locations recent [--from <date>] [--to <date>] [--limit N] [--json]",
  "bee locations current [--json]",
].join("\n");

const DATE_HINT = "Date as YYYY-MM-DD or an ISO timestamp (interpreted in your timezone).";

// ---- clusters (= bee_get_location_clusters) ---------------------------------

type LocationClustersInput = {
  limit: number;
  minVisits: number | undefined;
  includeVisits: boolean;
};

const locationClusters: ActionDefinition<LocationClustersInput> = {
  mcp: {
    name: "bee_get_location_clusters",
    description: "Show Bee location clusters: places grouped by visit frequency. Lower minVisits to surface places visited only once or twice (default 3).",
    inputSchema: objectSchema({
      properties: {
        limit: limitSchema(20),
        minVisits: { type: "number", minimum: 1, maximum: 1000, description: "Minimum visits for a place to appear. Defaults to 3." },
        includeVisits: { type: "boolean", description: "Include individual visits inside each cluster." },
      },
    }),
  },
  cli: {
    subcommand: "clusters",
    flags: [
      { name: "--limit", kind: "int", max: 20 },
      { name: "--min-visits", kind: "int", max: 1000 },
      { name: "--visits", kind: "bool" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Location Clusters", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    // CLI: the argv parser already produced a positive int (or omitted, no clamp).
    // MCP: numberArg clamps to [1,20].
    limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 20 }),
    // Optional on both surfaces; when omitted the server default (3) applies.
    minVisits: typeof raw["minVisits"] === "number" ? raw["minVisits"] : undefined,
    // CLI spells the flag --visits (key "visits"); MCP uses includeVisits. Accept
    // either so both surfaces map to one input.
    includeVisits: raw["visits"] === true || raw["includeVisits"] === true,
  }),
  run: async (ctx, input) => {
    const params = new URLSearchParams({
      limit: String(input.limit),
      include_visits: input.includeVisits ? "true" : "false",
    });
    if (input.minVisits !== undefined) {
      params.set("min_visits", String(input.minVisits));
    }
    const data = parseJson(await apiGet(ctx, `/v1/locations/clusters?${params.toString()}`));
    return { kind: "json", data };
  },
};

// ---- recent (= bee_get_recent_visits) ---------------------------------------
// A chronological feed of individual visits (newest first), distinct from the
// frequency-grouped clusters view. Supports an optional date range; the server
// defaults to a recent window when from/to are omitted.

type RecentVisitsInput = {
  from: string | undefined;
  to: string | undefined;
  limit: number;
};

const recentVisits: ActionDefinition<RecentVisitsInput> = {
  mcp: {
    name: "bee_get_recent_visits",
    description: "List individual Bee location visits in reverse-chronological order (each with start/end time, duration, and address). Use 'from'/'to' to scope a date range; omit for the most recent window. For places grouped by frequency, use bee_get_location_clusters instead.",
    inputSchema: objectSchema({
      properties: {
        from: { type: "string", description: `Start of range. ${DATE_HINT}` },
        to: { type: "string", description: `End of range. ${DATE_HINT}` },
        limit: limitSchema(50),
      },
    }),
  },
  cli: {
    subcommand: "recent",
    flags: [
      { name: "--from", kind: "string" },
      { name: "--to", kind: "string" },
      { name: "--limit", kind: "int", max: 100 },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Recent Visits", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    from: coerceOptionalString(raw["from"]),
    to: coerceOptionalString(raw["to"]),
    // CLI: argv parser produced a positive int (or omitted). MCP: clamp to [1,100].
    limit: coerceLimit(raw["limit"], surface, { fallback: 20, min: 1, max: 100 }),
  }),
  run: async (ctx, input) => {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.from !== undefined) {
      params.set("from", input.from);
    }
    if (input.to !== undefined) {
      params.set("to", input.to);
    }
    const data = parseJson(await apiGet(ctx, `/v1/locations/recent?${params.toString()}`));
    return { kind: "json", data };
  },
};

// ---- current (= bee_get_current_location) -----------------------------------

type CurrentLocationInput = Record<string, never>;

const currentLocation: ActionDefinition<CurrentLocationInput> = {
  mcp: {
    name: "bee_get_current_location",
    description: "Show Bee's latest known location. Very sensitive.",
    inputSchema: emptySchema,
  },
  cli: {
    subcommand: "current",
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Current Location", result.data, format);
    },
  },
  coerceInput: () => ({}),
  run: async (ctx) => {
    const data = parseJson(await apiGet(ctx, "/v1/locations/current"));
    return { kind: "json", data };
  },
};

export const locationsResource: ResourceModule = {
  cliCommand: {
    name: "locations",
    description: "Show Bee location clusters or current location.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use clusters, recent, or current.",
    unknownSubcommandPrefix: "Unknown locations subcommand: ",
  },
  actions: [locationClusters, recentVisits, currentLocation],
};
