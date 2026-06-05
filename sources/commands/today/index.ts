import type { Command } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import { callBeeTextTool, printToolData } from "@/commands/mcpToolOutput";
import {
  formatRecordMarkdown,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = "bee today [--context] [--json]";

export const todayCommand: Command = {
  name: "today",
  description: "Fetch today's brief (calendar events and emails).",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    const options = parseTodayArgs(remaining);
    if (options.context) {
      const data = await callBeeTextTool(context, "bee_get_today", {});
      printToolData("Today", data, format);
      return;
    }

    const data = await requestClientJson(context, "/v1/todayBrief", {
      method: "GET",
    });
    if (format === "json") {
      printJson(data);
      return;
    }
    const nowMs = Date.now();
    const timeZone = resolveTimeZone(parseTodayTimezone(data));
    console.log(
      formatRecordMarkdown({
        title: "Today Brief",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
  },
};

type TodayOptions = {
  context: boolean;
};

function parseTodayArgs(args: readonly string[]): TodayOptions {
  let includeContext = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "--context") {
      includeContext = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  return { context: includeContext };
}

function parseTodayTimezone(value: unknown): string | null {
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
