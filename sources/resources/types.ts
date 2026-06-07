import type { CommandContext } from "@/commands/types";
import type { JsonObject, ToolResult } from "@/mcp/types";
import type { OutputFormat } from "@/utils/markdown";

// ---- Context ----------------------------------------------------------------
export type ActionContext = CommandContext; // { env, client }

// ---- What an action returns -------------------------------------------------
// Discriminated union; the MCP adapter switch is exhaustive and type-checked.
export type ActionResult =
  | { kind: "json"; data: unknown }
  | { kind: "parts"; content: ToolResult["content"] };  // photos image/binary only

// ---- Raw argument bag -------------------------------------------------------
// MCP passes the JSON-RPC `arguments` object verbatim. The CLI adapter pre-parses
// argv (against the declared flag/positional spec) into the SAME shape, so
// `coerceInput` is written once but is told which surface it is reading.
export type RawArgs = { readonly [key: string]: unknown };
export type Surface = "cli" | "mcp";

// ---- CLI surface descriptor (declared, not derived) -------------------------
export type CliFlag =
  | { name: string; kind: "int"; max?: number }     // e.g. --limit (max omitted => unbounded)
  | { name: string; kind: "string" }                // e.g. --text, --cursor, --query, --date
  | { name: string; kind: "bool" }                  // e.g. --unconfirmed, --clear-alarm, --context
  | { name: string; kind: "boolString" };           // e.g. --confirmed, --completed (true|false)

export type CliPositional = {
  name: string;
  required: boolean;
  // Human label for the "<label> must be a positive integer." parse error
  // (e.g. "Photo id"). Defaults to a capitalized `name`.
  label?: string;
  // Error when the positional arity is wrong, i.e. wrong count of bare args
  // (e.g. "Provide exactly one photo id."). When omitted the generic
  // "Unexpected arguments: <rest>" / "Missing <name>." messages are used.
  arityMessage?: string;
};

export type CliSurface = {
  // Omit `subcommand` for single-verb commands (today, search, status, current, etc.).
  subcommand?: string;
  positionals?: readonly CliPositional[];
  flags: readonly CliFlag[];
  // Render the action payload to stdout. Receives the SAME ActionResult that
  // run() returns plus the parsed --json/--output format.
  render: (result: ActionResult, format: OutputFormat, ctx: ActionContext, raw: RawArgs) => void;
};

// ---- The single source of truth --------------------------------------------
export type ActionDefinition<I = unknown> = {
  // MCP side. Omit `mcp` for CLI-only behavior (e.g. today's default brief, CLI `status`).
  // Omit `cli` for MCP-only behavior (todo-suggestions, bee_status).
  mcp?: {
    name: string;            // "bee_list_facts"
    description: string;
    inputSchema: JsonObject; // built from the schema-fragment factories in schema.ts
  };
  cli?: CliSurface;

  // ONE source of truth for turning raw args (either surface) into canonical typed input.
  // Branch on `surface` ONLY where the two surfaces must differ (error strings, clamp vs reject).
  // Use the shared coercers in resources/coerce.ts.
  coerceInput: (raw: RawArgs, surface: Surface) => I;

  // ONE source of truth for endpoint/method/body/pagination/response-shaping.
  run: (ctx: ActionContext, input: I) => Promise<ActionResult>;
};

// Authoring helper: write `defineAction<I>({...})` to keep full type-checking of
// coerceInput/run against your input type I, while storing the action in the
// resource's `actions` array (which is heterogeneous, so its element type erases I).
export function defineAction<I>(action: ActionDefinition<I>): ActionDefinition<I> {
  return action;
}

// The element type used inside a resource's `actions` array. `I` is erased to
// `unknown` for storage; coerceInput/run wiring is checked at the definition site
// via defineAction (or the inline generic annotation on each const).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoredAction = ActionDefinition<any>;

// ---- A resource groups actions and carries the CLI command metadata ---------
export type ResourceModule = {
  cliCommand: {
    name: string;            // "facts"
    description: string;
    usage: string;
    aliases?: readonly string[];
    // Error strings for the subcommand dispatcher:
    missingSubcommandMessage?: string;   // e.g. "Missing subcommand. Use list."
    unknownSubcommandPrefix?: string;    // e.g. "Unknown facts subcommand: "
  };
  actions: readonly StoredAction[];
};
