// journals domain (= voice notes). Backs the CLI `journals` command
// (list/search/get) and the MCP voice-note tools.
import { printJson } from "@/client/clientApi";
import { printToolData } from "@/commands/mcpToolOutput";
import { coerceLimit, stringArg } from "@/resources/coerce";
import { apiGet, apiPost } from "@/resources/http";
import { parseJson } from "@/resources/json";
import { cursor, limit as limitSchema, objectSchema, query } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";
import {
  formatDateValue,
  formatTimeZoneHeader,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee journals list [--limit N] [--cursor <cursor>] [--json]",
  "bee journals search --query <text> [--limit N] [--json]",
  "bee journals get <id> [--json]",
].join("\n");

type JournalSummary = {
  id: string;
  text: string | null;
  state: "PREPARING" | "ANALYZING" | "READY";
  created_at: number;
  updated_at: number;
};

// ---- list (= bee_list_voice_notes) ----------------------------

type ListInput = { limit: number | undefined; cursor: string | undefined };

const listJournals: ActionDefinition<ListInput> = {
  mcp: {
    name: "bee_list_voice_notes",
    description:
      "List Bee voice notes or journal-style entries. Paginate with cursor using the returned next_cursor.",
    inputSchema: objectSchema({
      properties: { limit: limitSchema(50), cursor },
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

      const payload = parseJournalList(result.data);
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
    },
  },
  coerceInput: (raw, surface) => {
    // CLI: limit is undefined unless --limit was passed, so the request omits
    // ?limit entirely when not provided. MCP: default + clamp.
    const limit = surface === "cli"
      ? (typeof raw["limit"] === "number" ? raw["limit"] : undefined)
      : coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 50 });
    return {
      limit,
      cursor: typeof raw["cursor"] === "string" ? raw["cursor"] : undefined,
    };
  },
  run: async (ctx, input) => {
    // Only set params that were provided, and drop the leading "?" when none.
    const params = new URLSearchParams();
    if (input.limit !== undefined) {
      params.set("limit", String(input.limit));
    }
    if (input.cursor !== undefined) {
      params.set("cursor", input.cursor);
    }
    const suffix = params.toString();
    const path = suffix ? `/v1/journals?${suffix}` : "/v1/journals";
    return { kind: "json", data: parseJson(await apiGet(ctx, path)) };
  },
};

// ---- search (= bee_search_voice_notes) --------------------------------------

type SearchInput = { query: string; limit: number };

const searchJournals: ActionDefinition<SearchInput> = {
  mcp: {
    name: "bee_search_voice_notes",
    description:
      "Search Bee voice notes or journal-style entries server-side via the BM25 journals index. Returns the server response verbatim.",
    inputSchema: objectSchema({
      properties: { query, limit: limitSchema(50) },
      required: ["query"],
    }),
  },
  cli: {
    subcommand: "search",
    flags: [
      { name: "--query", kind: "string" },
      // CLI caps --limit at 20, rejecting >20 with "--limit must be an integer
      // between 1 and 20". The MCP schema (bee_search_voice_notes) allows up to
      // 50, and the MCP coercer clamps to [1,50].
      { name: "--limit", kind: "int", max: 20 },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Journal Search", result.data, format);
    },
  },
  coerceInput: (raw, surface) => {
    // CLI uses "Missing query. Provide --query." (the argv parser rejects an
    // empty/whitespace --query value with "--query requires a value" before here).
    // MCP uses stringArg -> "Missing query.".
    if (surface === "cli") {
      const value = typeof raw["query"] === "string" ? raw["query"] : undefined;
      if (value === undefined) {
        throw new Error("Missing query. Provide --query.");
      }
      return {
        query: value,
        limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 50 }),
      };
    }
    return {
      query: stringArg(raw["query"], "query"),
      limit: coerceLimit(raw["limit"], surface, { fallback: 10, min: 1, max: 50 }),
    };
  },
  run: async (ctx, input) => ({
    kind: "json",
    data: parseJson(await apiPost(ctx, "/v1/search/journals", {
      query: input.query,
      limit: input.limit,
    })),
  }),
};

// ---- get (= bee_get_voice_note) ---------------------------------------------

type GetInput = { id: string };

const getJournal: ActionDefinition<GetInput> = {
  mcp: {
    name: "bee_get_voice_note",
    description: "Get one Bee voice note or journal-style entry by ID.",
    inputSchema: objectSchema({
      properties: { id: { type: "string", description: "Bee voice note ID." } },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "get",
    // The journal id is a STRING, so it is not declared as a required numeric
    // positional (which would run parseRequiredId). It passes through as the raw
    // string and the "Missing journal id." check lives in coerceInput.
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: (result, format, _ctx, raw) => {
      if (result.kind !== "json") {
        return;
      }
      const id = String(raw["id"] ?? "").trim();
      if (format === "json") {
        printJson(result.data);
        return;
      }

      const payload = parseJournalDetail(result.data);
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
    },
  },
  coerceInput: (raw, surface) => {
    // Both surfaces require a non-empty string id, but the messages differ:
    // CLI throws "Missing journal id."; MCP throws "Missing id." (stringArg).
    if (surface === "cli") {
      const value = raw["id"];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("Missing journal id.");
      }
      return { id: value.trim() };
    }
    return { id: stringArg(raw["id"], "id") };
  },
  run: async (ctx, input) => ({
    kind: "json",
    data: parseJson(await apiGet(ctx, `/v1/journals/${encodeURIComponent(input.id)}`)),
  }),
};

export const journalsResource: ResourceModule = {
  cliCommand: {
    name: "journals",
    description: "List developer journals.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown journals subcommand: ",
  },
  actions: [listJournals, searchJournals, getJournal],
};

// ---- markdown helpers ----

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
