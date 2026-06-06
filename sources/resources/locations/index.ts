// locations domain: recent location clusters + current location.
// Each renderer uses printToolData; run() owns the single endpoint + params.
import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { parseJson } from "@/resources/json";
import { emptySchema, limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = [
  "bee locations recent [--limit N] [--visits] [--json]",
  "bee locations current [--json]",
].join("\n");

// ---- recent (= bee_get_recent_locations) ------------------------------------

type RecentLocationsInput = {
  limit: number;
  includeVisits: boolean;
};

const recentLocations: ActionDefinition<RecentLocationsInput> = {
  mcp: {
    name: "bee_get_recent_locations",
    description: "Show recent Bee location clusters.",
    inputSchema: objectSchema({
      properties: {
        limit: limitSchema(20),
        includeVisits: { type: "boolean", description: "Include individual visits inside each cluster." },
      },
    }),
  },
  cli: {
    subcommand: "recent",
    flags: [
      { name: "--limit", kind: "int", max: 20 },
      { name: "--visits", kind: "bool" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Recent Locations", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    // CLI: the argv parser already produced a positive int (or omitted, no clamp).
    // MCP: numberArg clamps to [1,20].
    limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 20 }),
    // CLI spells the flag --visits (key "visits"); MCP uses includeVisits. Accept
    // either so both surfaces map to one input.
    includeVisits: raw["visits"] === true || raw["includeVisits"] === true,
  }),
  run: async (ctx, input) => {
    const params = new URLSearchParams({
      limit: String(input.limit),
      include_visits: input.includeVisits ? "true" : "false",
    });
    const data = parseJson(await apiGet(ctx, `/v1/locations/clusters?${params.toString()}`));
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
    description: "Show recent or current Bee locations.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use recent or current.",
    unknownSubcommandPrefix: "Unknown locations subcommand: ",
  },
  actions: [recentLocations, currentLocation],
};
