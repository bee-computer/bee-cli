import type { Command } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatRecordMarkdown,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = "bee me [--json]";

export const meCommand: Command = {
  name: "me",
  description: "Fetch the developer profile.",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    if (remaining.length > 0) {
      throw new Error(`Unexpected arguments: ${remaining.join(" ")}`);
    }

    const data = await requestClientJson(context, "/v1/me", {
      method: "GET",
    });
    if (format === "json") {
      printJson(data);
      return;
    }
    const nowMs = Date.now();
    const timeZone = resolveTimeZone(parseUserTimezone(data));
    const profile = parseProfile(data);
    console.log(
      formatRecordMarkdown({
        title: "Profile",
        record: profile,
        timeZone,
        nowMs,
      })
    );
  },
};

function parseUserTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { timezone?: unknown };
  return typeof record.timezone === "string" ? record.timezone : null;
}

function parseProfile(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { first_name: "n/a", last_name: "n/a" };
  }
  const record = payload as {
    first_name?: unknown;
    last_name?: unknown;
    timezone?: unknown;
  };
  return {
    first_name:
      typeof record.first_name === "string" ? record.first_name : "n/a",
    last_name:
      typeof record.last_name === "string" ? record.last_name : "n/a",
    timezone: typeof record.timezone === "string" ? record.timezone : "n/a",
  }
}
