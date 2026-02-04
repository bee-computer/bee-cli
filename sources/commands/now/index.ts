import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatDateValue,
  formatTimeZoneHeader,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = "bee now [--json]";
const WINDOW_HOURS = 10;
const PAGE_SIZE = 100;

export const nowCommand: Command = {
  name: "now",
  description: "Fetch recent conversations with utterances.",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    if (remaining.length > 0) {
      throw new Error(`Unexpected arguments: ${remaining.join(" ")}`);
    }

    const nowMs = Date.now();
    const sinceMs = nowMs - WINDOW_HOURS * 60 * 60 * 1000;

    const list = await fetchRecentConversationSummaries(context, sinceMs);
    const timeZone = resolveTimeZone(list.timezone);
    const details = await fetchConversationDetails(context, list.conversations);
    const sorted = [...details].sort((a, b) => {
      const aTime = resolveConversationTime(a);
      const bTime = resolveConversationTime(b);
      return aTime - bTime;
    });

    if (format === "json") {
      printJson({
        since: sinceMs,
        until: nowMs,
        timezone: timeZone,
        conversations: sorted,
      });
      return;
    }

    const lines: string[] = ["# Now", "", formatTimeZoneHeader(timeZone), ""];

    if (sorted.length === 0) {
      lines.push("- (none)", "");
      console.log(lines.join("\n"));
      return;
    }

    sorted.forEach((conversation, index) => {
      lines.push(...formatConversationNow(conversation, timeZone, nowMs));
      if (index < sorted.length - 1) {
        lines.push("-----", "");
      }
    });

    console.log(lines.join("\n"));
  },
};

type ConversationSummary = {
  id: number;
  start_time: number;
  created_at: number;
};

type ConversationDetail = {
  id: number;
  start_time: number;
  end_time: number | null;
  summary: string | null;
  short_summary: string | null;
  state: string;
  created_at: number;
  transcriptions: Array<{
    id: number;
    utterances: Array<{
      id: number;
      speaker: string;
      text: string;
      spoken_at: number | null;
      start: number | null;
      end: number | null;
    }>;
  }>;
};

type ConversationListPayload = {
  conversations: ConversationSummary[];
  next_cursor: string | null;
  timezone: string | null;
};

async function fetchRecentConversationSummaries(
  context: CommandContext,
  sinceMs: number
): Promise<{ conversations: ConversationSummary[]; timezone: string | null }> {
  const conversations: ConversationSummary[] = [];
  let cursor: string | null = null;
  let timezone: string | null = null;

  while (true) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const data = await requestClientJson(
      context,
      `/v1/conversations?${params.toString()}`,
      { method: "GET" }
    );
    const payload = parseConversationList(data);
    timezone = timezone ?? payload.timezone;

    let oldestCreatedAt = Number.POSITIVE_INFINITY;
    for (const conversation of payload.conversations) {
      oldestCreatedAt = Math.min(oldestCreatedAt, normalizeEpochMs(conversation.created_at));
      const timestamp = resolveConversationTime(conversation);
      if (timestamp >= sinceMs) {
        conversations.push(conversation);
      }
    }

    if (!payload.next_cursor) {
      break;
    }

    if (oldestCreatedAt < sinceMs) {
      break;
    }

    cursor = payload.next_cursor;
  }

  return { conversations, timezone };
}

function parseConversationList(payload: unknown): ConversationListPayload {
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

async function fetchConversationDetails(
  context: CommandContext,
  conversations: ConversationSummary[]
): Promise<ConversationDetail[]> {
  return Promise.all(
    conversations.map(async (conversation) => {
      const data = await requestClientJson(
        context,
        `/v1/conversations/${conversation.id}`,
        { method: "GET" }
      );
      const detail = parseConversationDetail(data);
      if (!detail) {
        throw new Error("Invalid conversation response.");
      }
      return detail;
    })
  );
}

function parseConversationDetail(payload: unknown): ConversationDetail | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as { conversation?: ConversationDetail };
  if (!data.conversation) {
    return null;
  }
  return data.conversation;
}

function resolveConversationTime(
  conversation: Pick<ConversationSummary, "start_time" | "created_at">
): number {
  const start = normalizeEpochMs(conversation.start_time);
  const created = normalizeEpochMs(conversation.created_at);
  return start || created || 0;
}

function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1e12) {
    return value;
  }
  if (value > 1e9) {
    return value * 1000;
  }
  return 0;
}

function formatConversationNow(
  conversation: ConversationDetail,
  timeZone: string,
  nowMs: number
): string[] {
  const lines: string[] = [];
  lines.push(`## Conversation ${conversation.id}`);
  lines.push(
    `> To read the full conversation, run: \`bee conversations get ${conversation.id}\``
  );
  lines.push("");
  lines.push(
    `- start_time: ${formatDateValue(conversation.start_time, timeZone, nowMs)}`
  );
  if (conversation.end_time !== null) {
    lines.push(
      `- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`
    );
  }
  lines.push(`- state: ${conversation.state}`);
  lines.push(`> To read the full conversation, run: \`bee conversations get ${conversation.id}\``);
  lines.push("");

  const summaryText = resolveSummaryText(conversation);
  lines.push(...formatSummaryLines(summaryText));
  lines.push("");

  lines.push("Utterances", "");
  const utterances = flattenUtterances(conversation);
  if (utterances.length === 0) {
    lines.push("- (none)", "");
  } else {
    for (const utterance of utterances) {
      const speaker = utterance.speaker || "unknown";
      const text = utterance.text.trim() || "(empty)";
      lines.push(`- ${speaker}: ${text}`);
    }
    lines.push("");
  }

  return lines;
}

function resolveSummaryText(conversation: ConversationDetail): string {
  const shortSummary = conversation.short_summary?.trim();
  if (shortSummary) {
    return shortSummary;
  }
  return conversation.summary?.trim() || "";
}

function formatSummaryLines(text: string): string[] {
  if (!text) {
    return ["(no summary generated yet)"];
  }
  return text.split(/\r?\n/);
}

type Utterance = {
  speaker: string;
  text: string;
  timestamp: number;
};

function flattenUtterances(conversation: ConversationDetail): Utterance[] {
  const items: Utterance[] = [];
  for (const transcription of conversation.transcriptions) {
    for (const utterance of transcription.utterances) {
      const timestamp =
        normalizeEpochMs(utterance.spoken_at ?? 0) ||
        normalizeEpochMs(utterance.start ?? 0) ||
        normalizeEpochMs(utterance.end ?? 0);
      items.push({
        speaker: utterance.speaker || "unknown",
        text: utterance.text || "",
        timestamp,
      });
    }
  }

  return items.sort((a, b) => a.timestamp - b.timestamp);
}
