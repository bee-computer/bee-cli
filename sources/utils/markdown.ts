export type OutputFormat = "markdown" | "json";

const FALLBACK_TIMEZONE = "America/Los_Angeles";
const DEFAULT_TIMEZONE = resolveDefaultTimezone();

export function parseOutputFlag(
  args: readonly string[]
): { format: OutputFormat; args: string[] } {
  let format: OutputFormat = "markdown";
  const remaining: string[] = [];

  for (const arg of args) {
    if (arg === "--json") {
      format = "json";
      continue;
    }
    remaining.push(arg);
  }

  return { format, args: remaining };
}

export function resolveTimeZone(candidate?: string | null): string {
  if (isValidTimeZone(candidate)) {
    return candidate;
  }
  return DEFAULT_TIMEZONE;
}

export function formatAiDateTime(
  epochMs: number,
  timeZone: string,
  nowMs: number
): string {
  const { date, time } = formatDateTimeParts(epochMs, timeZone);
  const relative = formatRelativeMinutes(nowMs, epochMs);
  return `${date} ${time} [${relative}]`;
}

export function formatDateValue(
  value: number | string | null | undefined,
  timeZone: string,
  nowMs: number
): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (typeof value === "number") {
    const normalized = normalizeEpochMs(value);
    if (normalized === null) {
      return String(value);
    }
    return formatAiDateTime(normalized, timeZone, nowMs);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return value;
    }
    return formatAiDateTime(parsed, timeZone, nowMs);
  }

  return String(value);
}

export function formatTimeZoneHeader(timeZone: string): string {
  return `- timezone: ${timeZone}`;
}

export function formatRecordMarkdown(options: {
  title: string;
  record: Record<string, unknown>;
  timeZone: string;
  nowMs: number;
  headingLevel?: number;
}): string {
  const { title, record, timeZone, nowMs } = options;
  const headingLevel = options.headingLevel ?? 1;
  const headingPrefix = "#".repeat(Math.max(1, headingLevel));
  const lines: string[] = [`${headingPrefix} ${title}`, ""];

  lines.push(formatTimeZoneHeader(timeZone));

  const entries = Object.entries(record).filter(([key]) => {
    const normalized = key.toLowerCase();
    return normalized !== "timezone" && normalized !== "time_zone" && normalized !== "timeZone";
  });
  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [key, value] of entries) {
    lines.push(`- ${key}: ${formatInlineValue(key, value, timeZone, nowMs, 0)}`);
  }

  lines.push("");
  return lines.join("\n");
}

function formatDateTimeParts(
  epochMs: number,
  timeZone: string
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }

  return {
    date: `${lookup["year"]}-${lookup["month"]}-${lookup["day"]}`,
    time: `${lookup["hour"]}:${lookup["minute"]}`,
  };
}

function formatRelativeMinutes(nowMs: number, epochMs: number): string {
  const diffMs = nowMs - epochMs;
  const diffMinutes = Math.round(Math.abs(diffMs) / 60000);
  const suffix = diffMs >= 0 ? "ago" : "from now";
  return `${diffMinutes}min ${suffix}`;
}

function normalizeEpochMs(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value > 1e12) {
    return value;
  }
  if (value > 1e9) {
    return value * 1000;
  }
  return null;
}

function resolveDefaultTimezone(): string {
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (isValidTimeZone(systemTz)) {
    return systemTz;
  }
  return FALLBACK_TIMEZONE;
}

function isValidTimeZone(timeZone?: string | null): timeZone is string {
  if (!timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function formatInlineValue(
  key: string,
  value: unknown,
  timeZone: string,
  nowMs: number,
  depth: number
): string {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (typeof value === "string" || typeof value === "number") {
    if (looksLikeDateKey(key)) {
      return formatDateValue(value, timeZone, nowMs);
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "(none)";
    }
    if (value.every((item) => isPrimitive(item))) {
      return value
        .map((item) => formatInlineValue(key, item, timeZone, nowMs, depth + 1))
        .join(", ");
    }
    if (depth >= 2) {
      return "[...]";
    }
    return value
      .map((item) => formatInlineValue(key, item, timeZone, nowMs, depth + 1))
      .join(" | ");
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      return "{...}";
    }
    return formatInlineObject(value as Record<string, unknown>, timeZone, nowMs, depth + 1);
  }

  return String(value);
}

function formatInlineObject(
  record: Record<string, unknown>,
  timeZone: string,
  nowMs: number,
  depth: number
): string {
  const entries = Object.entries(record);
  entries.sort(([a], [b]) => a.localeCompare(b));
  const parts = entries.map(([key, value]) => {
    return `${key}: ${formatInlineValue(key, value, timeZone, nowMs, depth)}`;
  });
  return `{ ${parts.join("; ")} }`;
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function looksLikeDateKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.endsWith("_at")) {
    return true;
  }
  if (normalized.endsWith("_time")) {
    return true;
  }
  if (normalized.endsWith("_date")) {
    return true;
  }
  if (normalized === "date" || normalized === "time") {
    return true;
  }
  if (normalized === "start" || normalized === "end") {
    return true;
  }
  if (normalized.endsWith("_start") || normalized.endsWith("_end")) {
    return true;
  }
  return normalized.includes("date_time");
}
