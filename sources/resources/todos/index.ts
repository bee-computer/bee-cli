// todos resource: backs the `bee todos` CLI command and the bee_*_todo /
// *_todo_suggestion MCP tools.
//
// Surface divergences:
//  - CLI `list` returns the RAW server response (all todos, completed included);
//    the MCP bee_list_todos PROJECTS to open todos only with {todos,next_cursor,
//    timezone}. coerceInput carries a `project` flag so run() shapes accordingly.
//  - CLI `--limit` error string is "--limit must be a positive integer" (NOT the
//    registry int-flag message), and parseInt is lenient ("5abc" -> 5), so --limit
//    is declared as a string flag and parsed in coerceInput on the CLI surface.
//  - CLI id positionals use "Missing todo id." / "Todo id must be a positive
//    integer." messages, so positionals are declared optional and validated in
//    coerceInput; the registry still emits "Unexpected arguments: ..." for >1.
import { printJson } from "@/client/clientApi";
import { printToolData } from "@/commands/mcpToolOutput";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  resolveTimeZone,
} from "@/utils/markdown";
import {
  coerceRequiredId,
  cursorSuffix,
  hasOwn,
  numberArg,
  optionalString,
  requiredIdArg,
  stringArg,
} from "@/resources/coerce";
import { apiDelete, apiGet, apiPost, apiPut } from "@/resources/http";
import { arrayProp, asRecord, parseJson } from "@/resources/json";
import type { JsonObject } from "@/mcp/types";
import { cursor, idNumber, limit as limitSchema } from "@/resources/schema";
import type { ActionDefinition, CliSurface, ResourceModule } from "@/resources/types";

const USAGE = [
  "bee todos list [--limit N] [--cursor <cursor>] [--json]",
  "bee todos get <id> [--json]",
  "bee todos create --text <text> [--alarm-at <iso>] [--json]",
  "bee todos update <id> [--text <text>] [--completed <true|false>] [--alarm-at <iso> | --clear-alarm] [--json]",
  "bee todos complete <id> [--json]",
  "bee todos delete <id> [--json]",
  "bee todos suggestions [--limit N] [--json]",
  "bee todos accept-suggestion <id> [--json]",
  "bee todos dismiss-suggestion <id> [--json]",
].join("\n");

type Todo = {
  id: number;
  text: string;
  alarm_at: number | string | null;
  completed: boolean;
  created_at: number;
};

// ---- shared CLI render helpers ----

function parseTodosList(
  payload: unknown
): { todos: Todo[]; next_cursor: string | null; timezone: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid todos response.");
  }
  const data = payload as {
    todos?: Todo[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.todos)) {
    throw new Error("Invalid todos response.");
  }
  return {
    todos: data.todos,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseTodoResponse(payload: unknown): {
  todo: Todo | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { todo: null, timezone: null };
  }
  const record = payload as Partial<Todo> & { todo?: Todo; timezone?: string };
  if (record.todo) {
    return {
      todo: record.todo,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  const todoCandidate = record as Partial<Todo>;
  if (
    typeof todoCandidate.id === "number" &&
    typeof todoCandidate.text === "string" &&
    typeof todoCandidate.created_at === "number" &&
    typeof todoCandidate.completed === "boolean"
  ) {
    return {
      todo: todoCandidate as Todo,
      timezone: typeof record.timezone === "string" ? record.timezone : null,
    };
  }

  return {
    todo: null,
    timezone: typeof record.timezone === "string" ? record.timezone : null,
  };
}

function formatTodosSection(
  todos: Todo[],
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  if (todos.length === 0) {
    return ["- (none)", ""];
  }
  const lines: string[] = [];
  for (const todo of todos) {
    lines.push(...formatTodoBlock(todo, nowMs, timeZone, headingPrefix));
  }
  return lines;
}

function formatTodoBlock(
  todo: Todo,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Todo ${todo.id}`, "");
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- created_at: ${formatDateValue(todo.created_at, timeZone, nowMs)}`);
  lines.push(`- alarm_at: ${formatDateValue(todo.alarm_at ?? null, timeZone, nowMs)}`);
  lines.push(`- completed: ${todo.completed ? "true" : "false"}`);
  lines.push(`- text: ${todo.text.trim() || "(empty)"}`);
  lines.push("");
  return lines;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

// Renders a single-todo response (get/create/update/delete): --json prints the
// raw server payload; otherwise render the todo document, or fall back to
// formatRecordMarkdown when the payload is not a recognizable todo.
const renderTodoDocument: CliSurface["render"] = (result, format) => {
  if (result.kind !== "json") {
    return;
  }
  if (format === "json") {
    printJson(result.data);
    return;
  }
  const data = result.data;
  const nowMs = Date.now();
  const { todo, timezone } = parseTodoResponse(data);
  const timeZone = resolveTimeZone(timezone);
  if (todo) {
    console.log(formatTodoBlock(todo, nowMs, timeZone, "#").join("\n"));
    return;
  }
  console.log(
    formatRecordMarkdown({
      title: "Todo",
      record: normalizeRecord(data),
      timeZone,
      nowMs,
    })
  );
};

// CLI parses --limit leniently via parseInt ("5abc" -> 5); rejects non-positive.
function parseCliLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return parsed;
}

// CLI id positional: requires a positive integer.
function parseCliId(value: unknown): number {
  if (value === undefined) {
    throw new Error("Missing todo id.");
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Todo id must be a positive integer.");
  }
  return parsed;
}

function parseCliSuggestionId(value: unknown): number {
  if (value === undefined) {
    throw new Error("Missing suggestion id.");
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Suggestion id must be a positive integer.");
  }
  return parsed;
}

// ---- list (= bee_list_todos) ------------------------------------------------

type ListInput = {
  limit: number | undefined;
  cursor: string | undefined;
  // MCP projects to open-todos-only; CLI returns the raw server response.
  project: boolean;
};

const listTodos: ActionDefinition<ListInput> = {
  mcp: {
    name: "bee_list_todos",
    description: "List active Bee todos. Paginate with cursor using the returned next_cursor.",
    inputSchema: {
      type: "object",
      properties: { limit: limitSchema(50, "Maximum todos to return."), cursor },
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "list",
    flags: [
      // --limit is a string flag (not int) so the "--limit must be a positive
      // integer" message + lenient parseInt apply (see parseCliLimit).
      { name: "--limit", kind: "string" },
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
      const payload = parseTodosList(result.data);
      const nowMs = Date.now();
      const timeZone = resolveTimeZone(payload.timezone);
      const open = payload.todos.filter((todo) => !todo.completed);
      const completed = payload.todos.filter((todo) => todo.completed);

      const lines: string[] = ["# Todos", ""];
      lines.push("## Open", "");
      lines.push(...formatTodosSection(open, nowMs, timeZone, "###"));
      lines.push("## Completed", "");
      lines.push(...formatTodosSection(completed, nowMs, timeZone, "###"));

      if (payload.next_cursor) {
        lines.push("-----", "");
        lines.push("## Pagination", "");
        lines.push(`- next_cursor: ${payload.next_cursor}`, "");
      }
      console.log(lines.join("\n"));
    },
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      return {
        limit: parseCliLimit(raw["limit"]),
        cursor: optionalString(raw["cursor"]) ?? undefined,
        project: false,
      };
    }
    // MCP: lenient clamp to [1,50], default 20.
    return {
      limit: numberArg(raw["limit"], 20, 1, 50),
      cursor: optionalString(raw["cursor"]) ?? undefined,
      project: true,
    };
  },
  run: async (ctx, input) => {
    if (input.project) {
      // MCP projection: filter to open todos, reshape to {todos,next_cursor,timezone}.
      const data = parseJson(
        await apiGet(ctx, `/v1/todos?limit=${input.limit}${cursorSuffix(input.cursor)}`)
      );
      const todos = arrayProp(data, "todos").filter((item) => asRecord(item).completed !== true);
      return {
        kind: "json",
        data: {
          todos,
          next_cursor: asRecord(data)["next_cursor"] ?? null,
          timezone: asRecord(data).timezone ?? null,
        },
      };
    }
    // CLI: return the raw server response (no filtering).
    const params = new URLSearchParams();
    if (input.limit !== undefined) {
      params.set("limit", String(input.limit));
    }
    if (input.cursor !== undefined) {
      params.set("cursor", input.cursor);
    }
    const suffix = params.toString();
    const path = suffix ? `/v1/todos?${suffix}` : "/v1/todos";
    return { kind: "json", data: parseJson(await apiGet(ctx, path)) };
  },
};

// ---- get (CLI only) ---------------------------------------------------------

type GetInput = { id: number };

const getTodo: ActionDefinition<GetInput> = {
  cli: {
    subcommand: "get",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: renderTodoDocument,
  },
  coerceInput: (raw) => ({ id: parseCliId(raw["id"]) }),
  run: async (ctx, input) => {
    return { kind: "json", data: parseJson(await apiGet(ctx, `/v1/todos/${input.id}`)) };
  },
};

// ---- create (= bee_create_todo) ---------------------------------------------

type CreateInput = { text: string; alarmAt: string | undefined };

const createTodo: ActionDefinition<CreateInput> = {
  mcp: {
    name: "bee_create_todo",
    description: "Create a Bee todo.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 2000, description: "Todo text." },
        alarmAt: { type: "string", description: "Optional reminder time as an ISO date string." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "create",
    flags: [
      { name: "--text", kind: "string" },
      { name: "--alarm-at", kind: "string" },
    ],
    render: renderTodoDocument,
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      // The registry already rejects an empty --text value with "--text requires
      // a value"; here we reject an entirely absent --text.
      const text = optionalString(raw["text"]);
      if (text === null) {
        throw new Error("Missing todo text. Provide --text.");
      }
      return { text, alarmAt: optionalString(raw["alarmAt"]) ?? undefined };
    }
    return { text: stringArg(raw["text"], "text"), alarmAt: optionalString(raw["alarmAt"]) ?? undefined };
  },
  run: async (ctx, input) => {
    const body: JsonObject = { text: input.text };
    if (input.alarmAt !== undefined) {
      body["alarm_at"] = input.alarmAt;
    }
    return { kind: "json", data: parseJson(await apiPost(ctx, "/v1/todos", body)) };
  },
};

// ---- update (= bee_update_todo) ---------------------------------------------

type UpdateInput = {
  id: number;
  text: string | undefined;
  completed: boolean | undefined;
  alarmAt: string | null | undefined;
};

const updateTodo: ActionDefinition<UpdateInput> = {
  mcp: {
    name: "bee_update_todo",
    description: "Update a Bee todo's text, completion state, or reminder time.",
    inputSchema: {
      type: "object",
      properties: {
        id: idNumber("Bee todo ID."),
        text: { type: "string", minLength: 1, maxLength: 2000 },
        completed: { type: "boolean" },
        alarmAt: { type: ["string", "null"], description: "Reminder time as ISO string, or null to clear." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "update",
    positionals: [{ name: "id", required: false }],
    flags: [
      { name: "--text", kind: "string" },
      { name: "--completed", kind: "boolString" },
      { name: "--alarm-at", kind: "string" },
      { name: "--clear-alarm", kind: "bool" },
    ],
    render: renderTodoDocument,
  },
  coerceInput: (raw, surface) => {
    if (surface === "cli") {
      // Validation order matters for the error message surfaced: missing id
      // first ("Missing todo id."), then the --alarm-at/--clear-alarm conflict,
      // then the "at least one field" check. The registry parser already
      // enforces the >1 arity ("Unexpected arguments: ...") since the id
      // positional is declared.
      const id = parseCliId(raw["id"]);
      let alarmAt: string | null | undefined =
        raw["alarmAt"] !== undefined ? String(raw["alarmAt"]) : undefined;
      const clearAlarm = raw["clearAlarm"] === true;
      if (clearAlarm && alarmAt !== undefined) {
        throw new Error("Use either --alarm-at or --clear-alarm, not both.");
      }
      if (clearAlarm) {
        alarmAt = null;
      }
      const text = raw["text"] !== undefined ? String(raw["text"]) : undefined;
      const completed = typeof raw["completed"] === "boolean" ? raw["completed"] : undefined;
      if (text === undefined && completed === undefined && alarmAt === undefined) {
        throw new Error("Provide at least one field to update.");
      }
      return { id, text, completed, alarmAt };
    }
    // MCP: only present keys are applied.
    const id = requiredIdArg(raw["id"]);
    const text = hasOwn(raw, "text") ? stringArg(raw["text"], "text") : undefined;
    let completed: boolean | undefined;
    if (hasOwn(raw, "completed")) {
      if (typeof raw["completed"] !== "boolean") {
        throw new Error("completed must be a boolean.");
      }
      completed = raw["completed"];
    }
    let alarmAt: string | null | undefined;
    if (hasOwn(raw, "alarmAt")) {
      if (raw["alarmAt"] !== null && typeof raw["alarmAt"] !== "string") {
        throw new Error("alarmAt must be a string or null.");
      }
      alarmAt = raw["alarmAt"] as string | null;
    }
    if (text === undefined && completed === undefined && !hasOwn(raw, "alarmAt")) {
      throw new Error("Provide text, completed, or alarmAt to update.");
    }
    return { id, text, completed, alarmAt };
  },
  run: async (ctx, input) => {
    const body: JsonObject = {};
    if (input.text !== undefined) {
      body["text"] = input.text;
    }
    if (input.completed !== undefined) {
      body["completed"] = input.completed;
    }
    if (input.alarmAt !== undefined) {
      body["alarm_at"] = input.alarmAt;
    }
    return { kind: "json", data: parseJson(await apiPut(ctx, `/v1/todos/${input.id}`, body)) };
  },
};

// ---- complete (MCP only: bee_complete_todo) ---------------------------------

type IdInput = { id: number };

const completeTodo: ActionDefinition<IdInput> = {
  mcp: {
    name: "bee_complete_todo",
    description: "Mark one Bee todo complete.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "complete",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: renderTodoDocument,
  },
  coerceInput: (raw, surface) =>
    surface === "cli" ? { id: parseCliId(raw["id"]) } : { id: coerceRequiredId(raw["id"], surface) },
  run: async (ctx, input) => {
    return { kind: "json", data: parseJson(await apiPut(ctx, `/v1/todos/${input.id}`, { completed: true })) };
  },
};

// ---- delete (= bee_delete_todo) ---------------------------------------------

const deleteTodo: ActionDefinition<IdInput> = {
  mcp: {
    name: "bee_delete_todo",
    description: "Delete one Bee todo.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "delete",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: renderTodoDocument,
  },
  coerceInput: (raw, surface) =>
    surface === "cli" ? { id: parseCliId(raw["id"]) } : { id: requiredIdArg(raw["id"]) },
  run: async (ctx, input) => {
    return { kind: "json", data: parseJson(await apiDelete(ctx, `/v1/todos/${input.id}`)) };
  },
};

// ---- todo suggestions -------------------------------------------------------

type SuggestionsInput = { limit: number };

const getTodoSuggestions: ActionDefinition<SuggestionsInput> = {
  mcp: {
    name: "bee_get_todo_suggestions",
    description: "List pending Bee-suggested todos awaiting the user's review.",
    inputSchema: {
      type: "object",
      properties: { limit: limitSchema(20) },
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "suggestions",
    flags: [{ name: "--limit", kind: "int", max: 50 }],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Todo Suggestions", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    limit: surface === "cli"
      ? (typeof raw["limit"] === "number" ? raw["limit"] : 20)
      : numberArg(raw["limit"], 20, 1, 50),
  }),
  run: async (ctx, input) => {
    const data = parseJson(await apiGet(ctx, "/v1/todoSuggestions"));
    const suggestions = arrayProp(data, "todoSuggestions").slice(0, input.limit);
    return { kind: "json", data: { todoSuggestions: suggestions } };
  },
};

const acceptTodoSuggestion: ActionDefinition<IdInput> = {
  mcp: {
    name: "bee_accept_todo_suggestion",
    description: "Accept a pending Bee-suggested todo, turning it into a real todo.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo suggestion ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "accept-suggestion",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: renderTodoDocument,
  },
  coerceInput: (raw, surface) =>
    surface === "cli" ? { id: parseCliSuggestionId(raw["id"]) } : { id: requiredIdArg(raw["id"]) },
  run: async (ctx, input) => {
    return {
      kind: "json",
      data: parseJson(await apiPost(ctx, `/v1/todoSuggestions/${input.id}/accept`, {})),
    };
  },
};

const dismissTodoSuggestion: ActionDefinition<IdInput> = {
  mcp: {
    name: "bee_dismiss_todo_suggestion",
    description: "Dismiss a pending Bee-suggested todo without creating a todo.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo suggestion ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  cli: {
    subcommand: "dismiss-suggestion",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Dismiss Suggestion", result.data, format);
    },
  },
  coerceInput: (raw, surface) =>
    surface === "cli" ? { id: parseCliSuggestionId(raw["id"]) } : { id: requiredIdArg(raw["id"]) },
  run: async (ctx, input) => {
    return {
      kind: "json",
      data: parseJson(await apiPost(ctx, `/v1/todoSuggestions/${input.id}/dismiss`, {})),
    };
  },
};

export const todosResource: ResourceModule = {
  cliCommand: {
    name: "todos",
    description: "List developer todos.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown todos subcommand: ",
  },
  // MCP tool order: list, create, update, complete, delete, suggestions
  // get/accept/dismiss. CLI subcommands get/delete are interleaved, but ordering
  // only matters for MCP tools and is preserved by toolRegistry's in-place swap
  // by name.
  actions: [
    listTodos,
    createTodo,
    updateTodo,
    completeTodo,
    deleteTodo,
    getTodo,
    getTodoSuggestions,
    acceptTodoSuggestion,
    dismissTodoSuggestion,
  ],
};
