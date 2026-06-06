// Argument coercers. The CLI argv parser (parsePositiveInt/parseRequiredId in
// @/commands/mcpToolOutput) runs before coerceInput is called.
//
// Rule of thumb: a coercer branches on `surface` ONLY if the two surfaces have
// different observable behavior (limit clamp-vs-reject, id error string).
// Everything else is shared with no branch.
import type { Surface } from "@/resources/types";

// ---- surface-aware coercers -------------------------------------------------

// CLI flag values arrive pre-validated by the argv parser (parsePositiveInt
// already clamped/rejected). MCP values arrive as native JSON and must be coerced
// leniently. coerceLimit branches on surface accordingly.
export function coerceLimit(
  value: unknown,
  surface: Surface,
  o: { fallback: number; min: number; max: number }
): number {
  if (surface === "cli") {
    // The CLI argv parser already produced a positive int (or omitted). No clamp.
    return typeof value === "number" ? value : o.fallback;
  }
  return numberArg(value, o.fallback, o.min, o.max); // MCP: lenient clamp to [min,max]
}

// CLI: the argv parser already ran parseRequiredId (message: "<label> must be a
// positive integer."). MCP: requiredIdArg (message: "Expected an integer id >= 1.").
export function coerceRequiredId(value: unknown, surface: Surface): number {
  return surface === "cli" ? value as number : requiredIdArg(value);
}

// surface-agnostic; optionalString -> undefined.
export function coerceOptionalString(value: unknown): string | undefined {
  return optionalString(value) ?? undefined;
}

// ---- shared helpers (identical behavior on both surfaces) -------------------

export function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

export function stringOrNumberArg(value: unknown, name: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Missing ${name}.`);
}

export function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = optionalNumber(value);
  const result = parsed ?? fallback;
  if (!Number.isFinite(result)) {
    return Math.floor(fallback);
  }
  return Math.floor(Math.min(Math.max(result, min), max));
}

export function requiredIdArg(value: unknown): number {
  const parsed = optionalNumber(value);
  if (parsed === null) {
    throw new Error("Missing id.");
  }
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected an integer id >= 1.");
  }
  return parsed;
}

export function optionalIdArg(value: unknown): number | null {
  const parsed = optionalNumber(value);
  if (parsed === null) {
    return null;
  }
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected an integer id >= 1.");
  }
  return parsed;
}

export function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Returns a "&cursor=<encoded>" fragment for an optional pagination cursor, or "".
export function cursorSuffix(value: unknown): string {
  const cursor = optionalString(value);
  return cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
}

export function hasOwn(record: { readonly [key: string]: unknown }, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function filterArg(value: unknown): "all" | "conversations" | "daily" | "facts" {
  if (value === undefined || value === null) {
    return "all";
  }
  if (value === "all" || value === "conversations" || value === "daily" || value === "facts") {
    return value;
  }
  throw new Error("filter must be one of: all, conversations, daily, facts.");
}

export function sortByArg(value: unknown): "relevance" | "mostRecent" {
  if (value === undefined || value === null) {
    return "relevance";
  }
  if (value === "relevance" || value === "mostRecent") {
    return value;
  }
  throw new Error("sortBy must be one of: relevance, mostRecent.");
}

export function modeArg(value: unknown): "keyword" | "semantic" {
  if (value === undefined || value === null) {
    return "keyword";
  }
  if (value === "keyword" || value === "semantic") {
    return value;
  }
  throw new Error("mode must be one of: keyword, semantic.");
}
