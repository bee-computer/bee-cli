import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee conversations list [--limit N] [--cursor <cursor>] [--json]",
  "bee conversations get <id> [--json]",
].join("\n");

export const conversationsCommand: Command = {
  name: "conversations",
  description: "List developer conversations.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use list.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "list":
        await handleList(rest, context);
        return;
      case "get":
        await handleGet(rest, context);
        return;
      default:
        throw new Error(`Unknown conversations subcommand: ${subcommand}`);
    }
  },
};

type ListOptions = {
  limit?: number;
  cursor?: string;
};

async function handleList(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseListArgs(remaining);
  const params = new URLSearchParams();

  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }

  const suffix = params.toString();
  const path = suffix ? `/v1/conversations?${suffix}` : "/v1/conversations";
  const data = await requestClientJson(context, path, { method: "GET" });
  if (format === "json") {
    printJson(data);
    return;
  }
  const payload = parseConversationList(data);
  const nowMs = Date.now();
  const timeZone = resolveTimeZone(payload.timezone);
  const lines: string[] = ["# Conversations", ""];
  lines.push(formatTimeZoneHeader(timeZone), "");

  if (payload.conversations.length === 0) {
    lines.push("- (none)", "");
  } else {
    payload.conversations.forEach((conversation, index) => {
      lines.push(
        ...formatConversationSummaryBlock(conversation, nowMs, timeZone, "###")
      );
      if (index < payload.conversations.length - 1) {
        lines.push("-----", "");
      }
    });
  }

  if (payload.next_cursor) {
    lines.push("-----", "");
    lines.push("## Pagination", "");
    lines.push(`- next_cursor: ${payload.next_cursor}`, "");
  }

  console.log(lines.join("\n"));
}

function parseListArgs(args: readonly string[]): ListOptions {
  const options: ListOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--limit") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--limit requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      options.limit = parsed;
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--cursor requires a value");
      }
      options.cursor = value;
      i += 1;
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

  return options;
}

async function handleGet(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const id = parseId(remaining);
  const data = await requestClientJson(context, `/v1/conversations/${id}`, {
    method: "GET",
  });
  if (format === "json") {
    printJson(data);
    return;
  }
  const nowMs = Date.now();
  const payload = parseConversationDetail(data);
  if (!payload) {
    const timeZone = resolveTimeZone(null);
    console.log(
      formatRecordMarkdown({
        title: "Conversation",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
    return;
  }
  const timeZone = resolveTimeZone(payload.timezone);
  console.log(formatConversationDetailDocument(payload.conversation, nowMs, timeZone));
}

function parseId(args: readonly string[]): number {
  if (args.length === 0) {
    throw new Error("Missing conversation id.");
  }
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }

  const parsed = Number.parseInt(args[0] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Conversation id must be a positive integer.");
  }
  return parsed;
}

type ConversationSummary = {
  id: number;
  start_time: number;
  end_time: number | null;
  created_at: number;
  summary: string | null;
  state: string;
};

type ConversationDetail = {
  id: number;
  start_time: number;
  end_time: number | null;
  device_type: string;
  summary: string | null;
  short_summary: string | null;
  state: string;
  created_at: number;
  updated_at: number;
  transcriptions: Array<{
    id: number;
    realtime: boolean;
    utterances: Array<{
      id: number;
      realtime: boolean;
      start: number | null;
      end: number | null;
      spoken_at: number | null;
      text: string;
      speaker: string;
      created_at: number;
    }>;
  }>;
  suggested_links: Array<{
    url: string;
    created_at: number;
  }>;
  primary_location: {
    address: string | null;
    latitude: number;
    longitude: number;
    created_at: number;
  } | null;
};

function parseConversationList(
  payload: unknown
): {
  conversations: ConversationSummary[];
  next_cursor: string | null;
  timezone: string | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid conversation list response.");
  }
  const data = payload as {
    conversations?: ConversationSummary[];
    next_cursor?: string | null;
    timezone?: string;
  };
  if (!Array.isArray(data.conversations)) {
    throw new Error("Invalid conversation list response.");
  }
  return {
    conversations: data.conversations,
    next_cursor: data.next_cursor ?? null,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function parseConversationDetail(payload: unknown): {
  conversation: ConversationDetail;
  timezone: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as { conversation?: ConversationDetail; timezone?: string };
  if (!data.conversation) {
    return null;
  }
  return {
    conversation: data.conversation,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

function formatConversationSummaryBlock(
  conversation: ConversationSummary,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Conversation ${conversation.id}`, "");
  const startTime = resolveConversationStartTime(conversation);
  lines.push(
    `- start_time: ${formatDateValue(startTime, timeZone, nowMs)}`
  );
  if (conversation.end_time !== null) {
    lines.push(
      `- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`
    );
  }
  lines.push(`- state: ${conversation.state}`);
  lines.push(`> To read the full conversation, run: \`bee conversations get ${conversation.id}\``);
  lines.push("");
  lines.push(...formatSummaryText(conversation.summary));
  lines.push("");
  return lines;
}

function formatConversationDetailDocument(
  conversation: ConversationDetail,
  nowMs: number,
  timeZone: string
): string {
  const lines: string[] = [`# Conversation ${conversation.id}`, ""];

  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(
    `- start_time: ${formatDateValue(conversation.start_time, timeZone, nowMs)}`
  );
  lines.push(
    `- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`
  );
  lines.push(`- device_type: ${conversation.device_type}`);
  lines.push(`- state: ${conversation.state}`);
  lines.push(
    `- created_at: ${formatDateValue(conversation.created_at, timeZone, nowMs)}`
  );
  lines.push(
    `- updated_at: ${formatDateValue(conversation.updated_at, timeZone, nowMs)}`
  );
  lines.push("");

  if (conversation.short_summary) {
    lines.push("## Short Summary", "");
    lines.push(conversation.short_summary.trim() || "(empty)", "");
  }

  if (conversation.summary) {
    lines.push("## Summary", "");
    lines.push(conversation.summary.trim() || "(empty)", "");
  }

  lines.push("## Primary Location", "");
  if (conversation.primary_location) {
    const location = conversation.primary_location;
    const address = location.address ?? "unknown";
    lines.push(
      `- ${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`
    );
    lines.push(
      `- created_at: ${formatDateValue(location.created_at, timeZone, nowMs)}`
    );
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Suggested Links", "");
  if (conversation.suggested_links.length > 0) {
    for (const link of conversation.suggested_links) {
      lines.push(
        `- ${link.url} (${formatDateValue(link.created_at, timeZone, nowMs)})`
      );
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Transcriptions", "");
  if (conversation.transcriptions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const transcription of conversation.transcriptions) {
      lines.push(`### Transcription ${transcription.id}`, "");
      lines.push(formatTimeZoneHeader(timeZone));
      lines.push(`- realtime: ${transcription.realtime ? "true" : "false"}`);
      lines.push("");

      if (transcription.utterances.length === 0) {
        lines.push("- (no utterances)", "");
      } else {
        const sortedUtterances = [...transcription.utterances].sort((a, b) => {
          const timeA = a.spoken_at ?? a.start ?? 0;
          const timeB = b.spoken_at ?? b.start ?? 0;
          if (timeA !== timeB) {
            return timeA - timeB;
          }
          return a.id - b.id;
        });
        for (const utterance of sortedUtterances) {
          const speaker = utterance.speaker || "unknown";
          const text = utterance.text.trim() || "(empty)";
          const timeParts: string[] = [];
          if (utterance.spoken_at !== null) {
            timeParts.push(
              `spoken_at: ${formatDateValue(utterance.spoken_at, timeZone, nowMs)}`
            );
          }
          if (utterance.start !== null) {
            timeParts.push(
              `start: ${formatDateValue(utterance.start, timeZone, nowMs)}`
            );
          }
          if (utterance.end !== null) {
            timeParts.push(
              `end: ${formatDateValue(utterance.end, timeZone, nowMs)}`
            );
          }
          const timeSuffix =
            timeParts.length > 0 ? ` (${timeParts.join(", ")})` : "";
          lines.push(`- ${speaker}: ${text}${timeSuffix}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function resolveConversationStartTime(
  conversation: Pick<ConversationSummary, "created_at" | "start_time">
): number | null {
  return conversation.start_time ?? conversation.created_at ?? null;
}

function formatSummaryText(summary: string | null): string[] {
  const normalized = summary?.trim() ?? "";
  if (!normalized) {
    return ["(no summary generated yet)"];
  }
  return normalized.split(/\r?\n/);
}
