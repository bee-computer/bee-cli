import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { parseJson } from "@/resources/json";
import { cursor, limit as limitSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

const USAGE = "bee external-access list [--limit N] [--cursor <cursor>] [--json]";

type ListExternalAccessInput = {
  limit: number | undefined;
  cursor: string | undefined;
};

const listExternalAccess: ActionDefinition<ListExternalAccessInput> = {
  mcp: {
    name: "bee_list_external_access",
    description:
      "List external services and data types that have accessed Bee data. Paginate with cursor using the returned next_cursor.",
    inputSchema: objectSchema({
      properties: {
        limit: limitSchema(100),
        cursor,
      },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--limit", kind: "int", max: 100 },
      { name: "--cursor", kind: "string" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("External Access", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    limit: surface === "cli"
      ? (typeof raw["limit"] === "number" ? raw["limit"] : undefined)
      : coerceLimit(raw["limit"], surface, { fallback: 20, min: 1, max: 100 }),
    cursor: typeof raw["cursor"] === "string" ? raw["cursor"] : undefined,
  }),
  run: async (ctx, input) => {
    const params = new URLSearchParams();
    if (input.limit !== undefined) {
      params.set("limit", String(input.limit));
    }
    if (input.cursor !== undefined) {
      params.set("cursor", input.cursor);
    }
    const query = params.toString();
    const path = query ? `/v1/external-access?${query}` : "/v1/external-access";
    return { kind: "json", data: parseJson(await apiGet(ctx, path)) };
  },
};

export const externalAccessResource: ResourceModule = {
  cliCommand: {
    name: "external-access",
    description: "List external services and data types that accessed Bee data.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown external-access subcommand: ",
  },
  actions: [listExternalAccess],
};
