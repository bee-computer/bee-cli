import type { CommandContext } from "@/commands/types";
import { printJson } from "@/client/clientApi";
import { callBeeTool } from "@/mcp/beeTools";
import type { ToolResult } from "@/mcp/types";
import {
  formatRecordMarkdown,
  resolveTimeZone,
  type OutputFormat,
} from "@/utils/markdown";

export async function callBeeTextTool(
  context: CommandContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await callBeeTool(context, name, args);
  if (result.isError === true) {
    throw new Error(firstText(result) || `${name} failed.`);
  }
  const text = firstText(result);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { value: text };
  }
}

export async function callBeeImageTool(
  context: CommandContext,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return await callBeeTool(context, name, args);
}

export function printToolData(
  title: string,
  data: unknown,
  format: OutputFormat
): void {
  if (format === "json") {
    printJson(data);
    return;
  }

  const nowMs = Date.now();
  const record = normalizeRecord(data);
  const timezone = typeof record["timezone"] === "string"
    ? record["timezone"]
    : null;
  console.log(formatRecordMarkdown({
    title,
    record,
    timeZone: resolveTimeZone(timezone),
    nowMs,
  }));
}

export function parsePositiveInt(
  value: string | undefined,
  flag: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${flag} must be an integer between 1 and ${max}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${flag} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export function parseRequiredId(value: string | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`Missing ${label}.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function firstText(result: ToolResult): string {
  const text = result.content.find((item) => item.type === "text");
  return text?.type === "text" ? text.text : "";
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
