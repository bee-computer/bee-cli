// facts domain: full CRUD on the shared resource architecture. Endpoint/method/
// body/pagination and the fact formatters live here once; both the CLI `facts`
// command and the MCP bee_*_fact tools derive from these ActionDefinitions.
//
// Surface divergence:
//  - CLI `list` always sets confirmed=true|false; MCP bee_list_facts omits
//    confirmed when includeUnconfirmed is true.
//  - bee_search_facts is MCP-only; the `facts` CLI command has no search
//    subcommand, so that action declares no cli block.
//  - bee_update_fact (MCP) fetches the existing text when text is omitted; the
//    CLI `facts update` requires --text and never fetches.
import { printJson } from "@/client/clientApi";
import type { JsonObject } from "@/mcp/types";
import {
  coerceLimit,
  coerceOptionalString,
  coerceRequiredId,
  cursorSuffix,
  hasOwn,
  stringArg,
} from "@/resources/coerce";
import { apiDelete, apiGet, apiPost, apiPut } from "@/resources/http";
import { asRecord, parseJson } from "@/resources/json";
import {
  cursor as cursorSchema,
  idNumber,
  limit as limitSchema,
  objectSchema,
  query as querySchema,
} from "@/resources/schema";
import type { ActionDefinition, ResourceModule } from "@/resources/types";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee facts list [--limit N] [--cursor <cursor>] [--unconfirmed] [--json]",
  "bee facts get <id> [--json]",
  "bee facts create --text <text> [--json]",
  "bee facts update <id> --text <text> [--confirmed <true|false>] [--json]",
  "bee facts delete <id> [--json]",
].join("\n");

// ---- shared fact types + formatters ----

type Fact = {
  id: number;
  text: string;
  tags: string[];
  created_at: number;
  confirmed: boolean;
};

function parseFactsList(
  payload: unknown
): { facts: Fact[]; next_cursor: string | null; timezone: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid facts response.");
  }
  const data = payload as {
    facts?: Fact[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.facts)) {
    throw new Error("Invalid facts response.");
  }
  return {
    facts: data.facts,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseFactResponse(payload: unknown): {
  fact: Fact | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { fact: null, timezone: null };
  }
  const record = payload as Partial<Fact> & { fact?: Fact; timezone?: string };
  if (record.fact) {
    return {
      fact: record.fact,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  const factCandidate = record as Partial<Fact>;
  if (
    typeof factCandidate.id === "number" &&
    typeof factCandidate.text === "string" &&
    typeof factCandidate.created_at === "number" &&
    typeof factCandidate.confirmed === "boolean" &&
    Array.isArray(factCandidate.tags)
  ) {
    return {
      fact: factCandidate as Fact,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  return {
    fact: null,
    timezone: typeof record.timezone === "string" ? record.timezone : null,
  };
}

function formatFactsList(facts: Fact[]): string[] {
  if (facts.length === 0) {
    return ["- (none)", ""];
  }
  return facts.map((fact) => `- ${fact.text.trim() || "(empty)"}`);
}

function formatFactDocument(fact: Fact, nowMs: number, timeZone: string): string {
  return formatFactBlock(fact, nowMs, timeZone, "#").join("\n");
}

function formatFactBlock(
  fact: Fact,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Fact ${fact.id}`, "");
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- created_at: ${formatDateValue(fact.created_at, timeZone, nowMs)}`);
  lines.push(`- confirmed: ${fact.confirmed ? "true" : "false"}`);
  lines.push(`- tags: ${fact.tags.length > 0 ? fact.tags.join(", ") : "(none)"}`);
  lines.push(`- text: ${fact.text.trim() || "(empty)"}`);
  lines.push("");
  return lines;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

// Parses the CLI id positional for get/update/delete. The shared argv parser
// declares the id positional as NOT required so it does not emit the generic
// "Missing id." string; this helper owns the fact-specific errors:
//   - absent           -> "Missing fact id."
//   - non-positive-int -> "Fact id must be a positive integer."
// MCP uses coerceRequiredId instead ("Expected an integer id >= 1.").
function coerceCliFactId(value: unknown): number {
  if (value === undefined) {
    throw new Error("Missing fact id.");
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Fact id must be a positive integer.");
  }
  return parsed;
}

// Shared render for single-fact responses (get/create/update/delete): renders the
// fact document, falling back to formatRecordMarkdown when the shape is unknown.
function renderFactDocument(data: unknown, format: "markdown" | "json"): void {
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const { fact, timezone } = parseFactResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (fact) {
    console.log(formatFactDocument(fact, nowMs, timeZone));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Fact",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
}

// ---- list (= bee_list_facts) -----------------------------------------------

// confirmedParam captures the surface divergence in the canonical input:
//  - CLI: "true" when listing confirmed, "false" when --unconfirmed (always set).
//  - MCP: "true" when confirmed-only, undefined when includeUnconfirmed (omitted).
// limit is `number | undefined`: the CLI omits it from the query when --limit is
// absent; MCP always clamps a default.
type FactsListInput = {
  limit: number | undefined;
  confirmedParam: "true" | "false" | undefined;
  cursor: string | undefined;
};

const listFacts: ActionDefinition<FactsListInput> = {
  mcp: {
    name: "bee_list_facts",
    description: "List saved Bee facts. Paginate with cursor using the returned next_cursor.",
    inputSchema: objectSchema({
      properties: {
        limit: limitSchema(50),
        includeUnconfirmed: {
          type: "boolean",
          description: "Include facts Bee has not confirmed yet.",
        },
        cursor: cursorSchema,
      },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--limit", kind: "int" },
      { name: "--cursor", kind: "string" },
      { name: "--unconfirmed", kind: "bool" },
    ],
    render: (result, format, _ctx, raw) => {
      if (result.kind !== "json") {
        return;
      }
      if (format === "json") {
        printJson(result.data);
        return;
      }
      const payload = parseFactsList(result.data);
      // Title depends on the --unconfirmed flag (bag key "unconfirmed"), which the
      // server JSON does not carry; read it from raw so result.data stays the raw
      // server shape for --json.
      const title = raw["unconfirmed"] === true ? "Pending Facts" : "Confirmed Facts";
      const lines: string[] = [`# ${title}`, ""];
      lines.push(...formatFactsList(payload.facts));
      if (payload.next_cursor) {
        lines.push("-----", "");
        lines.push("## Pagination", "");
        lines.push(`- next_cursor: ${payload.next_cursor}`, "");
      }
      console.log(lines.join("\n"));
    },
  },
  coerceInput: (raw, surface) => {
    // CLI flag is --unconfirmed (bag key "unconfirmed"); MCP arg is
    // includeUnconfirmed. Read the surface-appropriate key.
    const unconfirmed =
      surface === "cli" ? raw["unconfirmed"] === true : raw["includeUnconfirmed"] === true;
    if (surface === "cli") {
      // Omit limit param when --limit absent; always set confirmed (true|false).
      // The argv parser already validated --limit.
      return {
        limit: typeof raw["limit"] === "number" ? (raw["limit"] as number) : undefined,
        confirmedParam: unconfirmed ? "false" : "true",
        cursor: coerceOptionalString(raw["cursor"]),
      };
    }
    // MCP bee_list_facts: clamp limit to [1,50]; omit confirmed when
    // includeUnconfirmed.
    return {
      limit: coerceLimit(raw["limit"], surface, { fallback: 20, min: 1, max: 50 }),
      confirmedParam: unconfirmed ? undefined : "true",
      cursor: coerceOptionalString(raw["cursor"]),
    };
  },
  run: async (ctx, input) => {
    const params: string[] = [];
    if (input.limit !== undefined) {
      params.push(`limit=${input.limit}`);
    }
    if (input.confirmedParam !== undefined) {
      params.push(`confirmed=${input.confirmedParam}`);
    }
    const base = params.join("&");
    const suffix = `${base}${cursorSuffix(input.cursor)}`.replace(/^&/, "");
    const path = suffix ? `/v1/facts?${suffix}` : "/v1/facts";
    const data = parseJson(await apiGet(ctx, path));
    return { kind: "json", data };
  },
};

// ---- search (= bee_search_facts) — MCP-ONLY ---------------------------------
// The `facts` CLI command has no search subcommand, so this action declares no
// cli block; only the MCP tool exists.

type FactsSearchInput = { query: string; limit: number };

const searchFacts: ActionDefinition<FactsSearchInput> = {
  mcp: {
    name: "bee_search_facts",
    description:
      "Search saved Bee facts only, server-side via the BM25 facts index. Returns the server response verbatim.",
    inputSchema: objectSchema({
      properties: { query: querySchema, limit: limitSchema(100) },
      required: ["query"],
    }),
  },
  coerceInput: (raw, surface) => ({
    query: stringArg(raw["query"], "query"),
    limit: coerceLimit(raw["limit"], surface, { fallback: 20, min: 1, max: 100 }),
  }),
  run: async (ctx, input) => {
    const data = parseJson(
      await apiPost(ctx, "/v1/search/conversations", {
        query: input.query,
        limit: input.limit,
        filter: "facts",
      })
    );
    return { kind: "json", data };
  },
};

// ---- get (= bee_get_fact) --------------------------------------------------

type FactIdInput = { id: number };

const getFact: ActionDefinition<FactIdInput> = {
  mcp: {
    name: "bee_get_fact",
    description: "Get one saved Bee fact by ID.",
    inputSchema: objectSchema({
      properties: { id: idNumber("Bee fact ID.") },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "get",
    // required:false so the shared parser passes the raw string through (and emits
    // "Unexpected arguments:" for extras) while this action owns the
    // "Missing fact id." / "Fact id must be a positive integer." messages.
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      renderFactDocument(result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    id: surface === "cli" ? coerceCliFactId(raw["id"]) : coerceRequiredId(raw["id"], surface),
  }),
  run: async (ctx, input) => {
    const data = parseJson(await apiGet(ctx, `/v1/facts/${input.id}`));
    return { kind: "json", data };
  },
};

// ---- create (= bee_create_fact) --------------------------------------------

type FactCreateInput = { text: string };

const createFact: ActionDefinition<FactCreateInput> = {
  mcp: {
    name: "bee_create_fact",
    description: "Create a saved Bee fact.",
    inputSchema: objectSchema({
      properties: {
        text: { type: "string", minLength: 1, maxLength: 2000, description: "Fact text." },
      },
      required: ["text"],
    }),
  },
  cli: {
    subcommand: "create",
    flags: [{ name: "--text", kind: "string" }],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      renderFactDocument(result.data, format);
    },
  },
  coerceInput: (raw, surface) => {
    // CLI requires --text; MCP uses the stringArg message ("Missing text.").
    if (surface === "cli" && coerceOptionalString(raw["text"]) === undefined) {
      throw new Error("Missing fact text. Provide --text.");
    }
    return { text: stringArg(raw["text"], "text") };
  },
  run: async (ctx, input) => {
    const data = parseJson(await apiPost(ctx, "/v1/facts", { text: input.text }));
    return { kind: "json", data };
  },
};

// ---- update (= bee_update_fact) --------------------------------------------

// `text` is optional only on the MCP surface: when absent, run() fetches the
// existing fact text. The CLI always supplies text. fetchText distinguishes
// "no text provided" from an empty string.
type FactUpdateInput = {
  id: number;
  text: string | undefined;
  fetchText: boolean;
  confirmed?: boolean;
};

const updateFact: ActionDefinition<FactUpdateInput> = {
  mcp: {
    name: "bee_update_fact",
    description: "Update a saved Bee fact.",
    inputSchema: objectSchema({
      properties: {
        id: idNumber("Bee fact ID."),
        text: { type: "string", minLength: 1, maxLength: 2000, description: "New fact text." },
        confirmed: { type: "boolean", description: "Whether this fact is confirmed." },
      },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "update",
    positionals: [{ name: "id", required: false }],
    flags: [
      { name: "--text", kind: "string" },
      { name: "--confirmed", kind: "boolString" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      renderFactDocument(result.data, format);
    },
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      // CLI `facts update` validation order: missing id -> missing text -> bad id
      // (numeric) check. --text is required (no fetch like MCP). The shared parser
      // already emitted "Unexpected arguments:" for >1 positionals.
      if (raw["id"] === undefined) {
        throw new Error("Missing fact id.");
      }
      if (coerceOptionalString(raw["text"]) === undefined) {
        throw new Error("Missing fact text. Provide --text.");
      }
      const id = coerceCliFactId(raw["id"]);
      const input: FactUpdateInput = { id, text: stringArg(raw["text"], "text"), fetchText: false };
      if (typeof raw["confirmed"] === "boolean") {
        input.confirmed = raw["confirmed"];
      }
      return input;
    }
    // MCP: text is optional; when omitted, run() fetches the existing text.
    const id = coerceRequiredId(raw["id"], surface);
    const input: FactUpdateInput = hasOwn(raw, "text")
      ? { id, text: stringArg(raw["text"], "text"), fetchText: false }
      : { id, text: undefined, fetchText: true };
    if (hasOwn(raw, "confirmed")) {
      if (typeof raw["confirmed"] !== "boolean") {
        throw new Error("confirmed must be a boolean.");
      }
      input.confirmed = raw["confirmed"];
    }
    return input;
  },
  run: async (ctx, input) => {
    let text = input.text;
    if (input.fetchText) {
      const record = asRecord(parseJson(await apiGet(ctx, `/v1/facts/${input.id}`)));
      const existing = asRecord(record["fact"] ?? record);
      if (typeof existing["text"] !== "string") {
        throw new Error("Could not read the existing fact text; provide 'text' to update this fact.");
      }
      text = existing["text"];
    }
    if (text === undefined) {
      throw new Error("Could not read the existing fact text; provide 'text' to update this fact.");
    }
    const body: JsonObject = { text };
    if (input.confirmed !== undefined) {
      body["confirmed"] = input.confirmed;
    }
    const data = parseJson(await apiPut(ctx, `/v1/facts/${input.id}`, body));
    return { kind: "json", data };
  },
};

// ---- delete (= bee_delete_fact) --------------------------------------------

const deleteFact: ActionDefinition<FactIdInput> = {
  mcp: {
    name: "bee_delete_fact",
    description: "Delete one saved Bee fact.",
    inputSchema: objectSchema({
      properties: { id: idNumber("Bee fact ID.") },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "delete",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      renderFactDocument(result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    id: surface === "cli" ? coerceCliFactId(raw["id"]) : coerceRequiredId(raw["id"], surface),
  }),
  run: async (ctx, input) => {
    const data = parseJson(await apiDelete(ctx, `/v1/facts/${input.id}`));
    return { kind: "json", data };
  },
};

export const factsResource: ResourceModule = {
  cliCommand: {
    name: "facts",
    description: "List developer facts.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown facts subcommand: ",
  },
  actions: [listFacts, searchFacts, getFact, createFact, updateFact, deleteFact],
};
