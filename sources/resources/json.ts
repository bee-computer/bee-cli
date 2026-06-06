// JSON shaping helpers. Leaf utilities: they import no resource or registry.

export type DataRecord = {
  [key: string]: unknown;
  completed?: unknown;
  conversation?: unknown;
  created_at?: unknown;
  daily_summary?: unknown;
  date?: unknown;
  date_time?: unknown;
  generated_at?: unknown;
  id?: unknown;
  photos?: unknown;
  remote_url_id?: unknown;
  search_mode?: unknown;
  short_summary?: unknown;
  start_time?: unknown;
  summary?: unknown;
  text?: unknown;
  timezone?: unknown;
  transcriptions?: unknown;
  transcriptions_count?: unknown;
  utterances_count?: unknown;
};

export function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): DataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DataRecord
    : {};
}

export function arrayProp(value: unknown, key: string): unknown[] {
  const record = asRecord(value);
  const raw = record[key];
  return Array.isArray(raw) ? raw : [];
}

export function timeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value) ?? 0;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function normalizeEpochMs(value: number): number | null {
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

export function itemDay(value: unknown): string | null {
  const record = asRecord(value);
  const raw = record.date_time ?? record.created_at ?? record.start_time ?? record.generated_at;
  if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
    return record.date.slice(0, 10);
  }
  const time = timeValue(raw);
  return time > 0 ? localDateKey(new Date(time)) : null;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
