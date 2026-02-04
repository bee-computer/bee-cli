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
    const timeZone = resolveTimeZone(extractTimeZone(data));
    console.log(
      formatRecordMarkdown({
        title: "Profile",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
  },
};

function extractTimeZone(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record["timezone"],
    record["time_zone"],
    record["timeZone"],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
