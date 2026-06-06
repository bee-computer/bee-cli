// search domain. ONE action backs both the CLI `bee search` command and the
// bee_search MCP tool. The endpoint/body/projection live once in run().
//
// Surface divergence:
//  - MCP bee_search exposes keyword (BM25, /v1/search/conversations) and
//    semantic (neural, /v1/search/conversations/neural with {query, limit}).
//  - CLI search exposes keyword (same endpoint/body as MCP keyword, defaulted
//    limit) plus a richer neural path (--neural) that adds optional
//    --since/--until and renders bespoke conversation markdown. CLI-only flags
//    (--scope alias, --sort alias, --cursor trap) are validated in coerceInput.
import { printJson } from "@/client/clientApi";
import { printToolData } from "@/commands/mcpToolOutput";
import {
  filterArg,
  numberArg,
  sortByArg,
  stringArg,
} from "@/resources/coerce";
import { apiPost } from "@/resources/http";
import { parseJson } from "@/resources/json";
import { enumOf, limit as limitSchema, objectSchema, query as querySchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";
import {
  formatRecordMarkdown,
  resolveTimeZone,
} from "@/utils/markdown";

const LIMIT_MAX = 100;

const USAGE =
  "bee search --query <text> [--limit N] [--filter conversations|daily|facts|all] [--sort relevance|mostRecent] [--neural] [--since <epochMs>] [--until <epochMs>] [--scope conversations|all] [--json]";

type SearchFilter = "all" | "conversations" | "daily" | "facts";
type SearchSort = "relevance" | "mostRecent";

// Canonical input. `mode` selects the endpoint inside run(); the neural-only
// since/until are carried as optionals (only the CLI --neural path sets them).
type SearchInput = {
  mode: "keyword" | "semantic";
  query: string;
  // Keyword/semantic body always carries a (defaulted) limit on the keyword
  // path; the CLI neural path leaves it optional (no default applied).
  keyword: { limit: number; filter: SearchFilter; sortBy: SearchSort };
  neural: { limit?: number; since?: number; until?: number };
};

const searchAction: ActionDefinition<SearchInput> = {
  mcp: {
    name: "bee_search",
    description:
      "Search Bee ambient wearable context server-side. Conversations, daily summaries, and facts are searched server-side via a BM25 keyword index (use the filter argument to scope). Set mode to 'semantic' for neural search over conversations only (filter and sortBy do not apply in semantic mode). Todos and insights are NOT searchable here; use bee_list_todos and bee_get_insights instead. Returns the server response verbatim. Use for questions about what the user discussed, heard, did, or captured.",
    inputSchema: objectSchema({
      properties: {
        query: querySchema,
        limit: limitSchema(LIMIT_MAX),
        filter: enumOf(
          ["all", "conversations", "daily", "facts"],
          "Scope the BM25 search (keyword mode only). Defaults to 'all'."
        ),
        sortBy: enumOf(
          ["relevance", "mostRecent"],
          "Order results by relevance or recency (keyword mode only). Defaults to 'relevance'."
        ),
        mode: enumOf(
          ["keyword", "semantic"],
          "'keyword' for BM25 search (default), 'semantic' for neural search over conversations only."
        ),
      },
      required: ["query"],
    }),
  },
  cli: {
    // Single-verb command: no subcommand, the dispatcher selects this lone action.
    flags: [
      { name: "--query", kind: "string" },
      { name: "--limit", kind: "int", max: LIMIT_MAX },
      { name: "--filter", kind: "string" },
      { name: "--scope", kind: "string" },
      { name: "--sort", kind: "string" },
      { name: "--sortBy", kind: "string" },
      { name: "--neural", kind: "bool" },
      { name: "--since", kind: "string" },
      { name: "--until", kind: "string" },
      // --cursor is a deprecated trap that always throws in coerceInput; declared
      // as a value-taking flag so the released message wins over "Unknown option".
      { name: "--cursor", kind: "string" },
    ],
    render: (result, format, _ctx, raw) => {
      if (result.kind !== "json") {
        return;
      }
      // Neural path uses the bespoke conversation renderer; keyword path uses the
      // shared printToolData("Bee Search", ...).
      if (raw["neural"] === true) {
        renderNeural(result.data, format);
        return;
      }
      printToolData("Bee Search", result.data, format);
    },
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      return coerceCliInput(raw);
    }
    return coerceMcpInput(raw);
  },
  run: async (ctx, input) => {
    if (input.mode === "semantic") {
      const body: { query: string; limit?: number; since?: number; until?: number } = {
        query: input.query,
      };
      if (input.neural.limit !== undefined) {
        body.limit = input.neural.limit;
      }
      if (input.neural.since !== undefined) {
        body.since = input.neural.since;
      }
      if (input.neural.until !== undefined) {
        body.until = input.neural.until;
      }
      const data = parseJson(await apiPost(ctx, "/v1/search/conversations/neural", body));
      return { kind: "json", data };
    }
    const data = parseJson(
      await apiPost(ctx, "/v1/search/conversations", {
        query: input.query,
        limit: input.keyword.limit,
        filter: input.keyword.filter,
        sortBy: input.keyword.sortBy,
      })
    );
    return { kind: "json", data };
  },
};

// ---- coercion ---------------------------------------------------------------

// MCP bee_search: lenient. limit clamps to [1,100] defaulting 20; filter/sortBy/
// mode validated via the enum coercers. Semantic mode posts neural with just
// {query, limit}.
function coerceMcpInput(raw: { readonly [key: string]: unknown }): SearchInput {
  const query = stringArg(raw["query"], "query");
  const limit = numberArg(raw["limit"], 20, 1, LIMIT_MAX);
  const filter = filterArg(raw["filter"]);
  const sortBy = sortByArg(raw["sortBy"]);
  const mode = modeArg(raw["mode"]);
  return {
    mode,
    query,
    keyword: { limit, filter, sortBy },
    // semantic (neural) MCP body carries the defaulted limit.
    neural: { limit },
  };
}

// CLI search: the argv parser already validated --query (non-empty) and --limit
// (int 1..100). The remaining surface-only flags are validated here.
function coerceCliInput(raw: { readonly [key: string]: unknown }): SearchInput {
  if (raw["cursor"] !== undefined) {
    throw new Error("--cursor is no longer supported. Use --since/--until.");
  }

  const query = typeof raw["query"] === "string" ? raw["query"] : undefined;
  const limit = typeof raw["limit"] === "number" ? raw["limit"] : undefined;
  const neural = raw["neural"] === true;

  let filter: SearchFilter | undefined;
  if (raw["filter"] !== undefined) {
    filter = parseFilter(raw["filter"]);
  }
  if (raw["scope"] !== undefined) {
    filter = parseScope(raw["scope"]);
  }

  let sortBy: SearchSort | undefined;
  if (raw["sort"] !== undefined) {
    sortBy = parseSort(raw["sort"]);
  }
  if (raw["sortBy"] !== undefined) {
    sortBy = parseSort(raw["sortBy"]);
  }

  const since = parseEpoch(raw["since"], "--since");
  const until = parseEpoch(raw["until"], "--until");

  if (!query) {
    throw new Error("Missing query. Provide --query.");
  }

  if (!neural && (since !== undefined || until !== undefined)) {
    throw new Error("--since and --until can only be used with --neural.");
  }

  if (neural) {
    const neuralBody: { limit?: number; since?: number; until?: number } = {};
    if (limit !== undefined) {
      neuralBody.limit = limit;
    }
    if (since !== undefined) {
      neuralBody.since = since;
    }
    if (until !== undefined) {
      neuralBody.until = until;
    }
    return {
      mode: "semantic",
      query,
      keyword: { limit: limit ?? 20, filter: filter ?? "all", sortBy: sortBy ?? "relevance" },
      neural: neuralBody,
    };
  }

  // Keyword path: an omitted limit defaults to 20 and sortBy to "relevance".
  return {
    mode: "keyword",
    query,
    keyword: {
      limit: limit ?? 20,
      filter: filter ?? "all",
      sortBy: sortBy ?? "relevance",
    },
    neural: {},
  };
}

function parseFilter(value: unknown): SearchFilter {
  if (
    value === "all" ||
    value === "conversations" ||
    value === "daily" ||
    value === "facts"
  ) {
    return value;
  }
  throw new Error("--filter must be conversations, daily, facts, or all");
}

function parseScope(value: unknown): SearchFilter {
  if (value !== "conversations" && value !== "all") {
    throw new Error("--scope must be conversations or all");
  }
  return value === "all" ? "all" : "conversations";
}

function parseSort(value: unknown): SearchSort {
  if (value !== "relevance" && value !== "mostRecent") {
    throw new Error("--sort must be relevance or mostRecent");
  }
  return value;
}

function parseEpoch(value: unknown, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a valid epoch timestamp`);
  }
  return parsed;
}

// mode coercer kept local so the search domain owns its only enum.
function modeArg(value: unknown): "keyword" | "semantic" {
  if (value === undefined || value === null) {
    return "keyword";
  }
  if (value === "keyword" || value === "semantic") {
    return value;
  }
  throw new Error("mode must be one of: keyword, semantic.");
}

// ---- neural markdown rendering ----

type SearchResultItem = Record<string, unknown> & { id?: number | string };

function renderNeural(data: unknown, format: "markdown" | "json"): void {
  if (format === "json") {
    printJson(data);
    return;
  }

  const nowMs = Date.now();
  const payload = parseSearchResults(data);
  const title = "Conversation Search Results";
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
    for (const [index, result] of payload.results.entries()) {
      if (index > 0) {
        lines.push("-----", "");
      }
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
    }
  }

  if (payload.total !== null) {
    lines.push("-----", "");
    lines.push("## Summary", "");
    lines.push(`- total: ${payload.total}`, "");
  }

  console.log(lines.join("\n"));
}

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
  return `${base}\n\nanswer: ${summary}`;
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

export const searchResource: ResourceModule = {
  cliCommand: {
    name: "search",
    description: "Search developer data.",
    usage: USAGE,
  },
  actions: [searchAction],
};
