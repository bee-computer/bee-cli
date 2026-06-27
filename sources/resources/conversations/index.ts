// conversations resource: list / get / transcript / related.
//
// The `get`/`transcript`/`related` id positionals are declared OPTIONAL so the
// registry argv parser does not emit its generic "Missing id." message; instead
// coerceInput owns the messages ("Missing conversation id." / "conversation id
// must be a positive integer."), while the registry parser still raises
// "Unexpected arguments: ..." for surplus positionals before coerceInput runs.
import { printJson } from "@/client/clientApi";
import { printToolData } from "@/commands/mcpToolOutput";
import { coerceOptionalString, numberArg, requiredIdArg } from "@/resources/coerce";
import { apiGet } from "@/resources/http";
import { arrayProp, asRecord, parseJson } from "@/resources/json";
import { idNumber, limit as limitSchema, cursor as cursorSchema, objectSchema } from "@/resources/schema";
import type { ActionDefinition, ResourceModule, Surface } from "@/resources/types";
import {
  formatDateValue,
  formatRecordMarkdown,
  formatTimeZoneHeader,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = [
  "bee conversations list [--limit N] [--cursor <cursor>] [--json]",
  "bee conversations get <id> [--json]",
  "bee conversations transcript <id> [--since <epochMs>] [--json]",
  "bee conversations related <id> [--limit N] [--json]",
].join("\n");

// Coerces the conversation id positional: a raw-string positive-int check for the
// CLI surface, and requiredIdArg for the MCP surface.
function coerceConversationId(value: unknown, surface: Surface): number {
  if (surface === "mcp") {
    return requiredIdArg(value);
  }
  if (value === undefined) {
    throw new Error("Missing conversation id.");
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("conversation id must be a positive integer.");
  }
  return parsed;
}

function parseTranscriptSince(value: unknown, surface: Surface): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    const name = surface === "cli" ? "--since" : "since";
    throw new Error(`${name} must be a valid epoch timestamp`);
  }
  return parsed;
}

// ---- list (= bee_list_conversations) ----------------------------------------

type ConversationsListInput = { limit: number | undefined; cursor: string | undefined };

type ConversationSummary = {
  id: number;
  start_time: number;
  end_time: number | null;
  created_at: number;
  summary: string | null;
  state: string;
};

const listConversations: ActionDefinition<ConversationsListInput> = {
  mcp: {
    name: "bee_list_conversations",
    description: "List captured Bee conversations. Paginate with cursor using the returned next_cursor.",
    inputSchema: objectSchema({
      properties: { limit: limitSchema(20), cursor: cursorSchema },
    }),
  },
  cli: {
    subcommand: "list",
    flags: [
      { name: "--limit", kind: "int" },
      { name: "--cursor", kind: "string" },
    ],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      if (format === "json") {
        printJson(result.data);
        return;
      }
      const payload = parseConversationList(result.data);
      const nowMs = Date.now();
      const timeZone = resolveTimeZone(payload.timezone);
      const lines: string[] = ["# Conversations", ""];
      lines.push(formatTimeZoneHeader(timeZone), "");

      if (payload.conversations.length === 0) {
        lines.push("- (none)", "");
      } else {
        payload.conversations.forEach((conversation, index) => {
          lines.push(...formatConversationSummaryBlock(conversation, nowMs, timeZone, "###"));
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
    },
  },
  coerceInput: (raw, surface) => ({
    // CLI: parser already produced a number (or omitted); MCP: lenient clamp to
    // [1,20].
    limit: surface === "cli"
      ? (typeof raw["limit"] === "number" ? raw["limit"] : undefined)
      : (raw["limit"] === undefined ? undefined : numberArg(raw["limit"], 10, 1, 20)),
    cursor: coerceOptionalString(raw["cursor"]),
  }),
  run: async (ctx, input) => {
    const params = new URLSearchParams();
    if (input.limit !== undefined) {
      params.set("limit", String(input.limit));
    }
    if (input.cursor !== undefined) {
      params.set("cursor", input.cursor);
    }
    const suffix = params.toString();
    const path = suffix ? `/v1/conversations?${suffix}` : "/v1/conversations";
    const data = parseJson(await apiGet(ctx, path));
    return { kind: "json", data };
  },
};

// ---- get (= bee_get_conversation) -------------------------------------------

type ConversationGetInput = { id: number; includeTranscript: boolean };

const getConversation: ActionDefinition<ConversationGetInput> = {
  mcp: {
    name: "bee_get_conversation",
    description:
      "Get one captured Bee conversation with summary and metadata. Bee conversations come from an ambient wearable; transcript text may include ASR errors, so avoid direct quotes or transcript-only summaries unless corroborated by surrounding context.",
    inputSchema: objectSchema({
      properties: {
        id: idNumber("Bee conversation ID."),
        includeTranscript: {
          type: "boolean",
          description: "Include ASR transcript utterances too. Exact wording may contain recognition errors.",
        },
      },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "get",
    positionals: [{ name: "id", required: false }],
    flags: [],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      if (format === "json") {
        printJson(result.data);
        return;
      }
      const nowMs = Date.now();
      const payload = parseConversationDetail(result.data);
      if (!payload) {
        const timeZone = resolveTimeZone(null);
        console.log(
          formatRecordMarkdown({
            title: "Conversation",
            record: normalizeRecord(result.data),
            timeZone,
            nowMs,
          })
        );
        return;
      }
      const timeZone = resolveTimeZone(payload.timezone);
      console.log(formatConversationDetailDocument(payload.conversation, nowMs, timeZone));
    },
  },
  coerceInput: (raw, surface) => ({
    id: coerceConversationId(raw["id"], surface),
    // CLI `get` always fetches and renders the full conversation (transcriptions
    // intact) for both --json and the markdown document. Only the MCP tool strips
    // transcriptions to counts unless includeTranscript is set.
    includeTranscript: surface === "cli" ? true : raw["includeTranscript"] === true,
  }),
  run: async (ctx, input) => {
    // The CLI fetches the full conversation (transcript included). The MCP tool
    // strips transcriptions to counts unless includeTranscript is set.
    const data = parseJson(await apiGet(ctx, `/v1/conversations/${input.id}`));
    if (!input.includeTranscript) {
      const record = asRecord(data);
      const conversation = asRecord(record.conversation);
      const transcriptions = arrayProp(conversation, "transcriptions");
      delete conversation.transcriptions;
      conversation.transcriptions_count = transcriptions.length;
      conversation.utterances_count = transcriptions.reduce<number>((total, item) => {
        return total + arrayProp(asRecord(item), "utterances").length;
      }, 0);
    }
    return { kind: "json", data };
  },
};

// ---- transcript (= bee_get_conversation_transcript) -------------------------

// `since` (epoch ms) is an optional lower bound on utterance timestamps. It is
// carried as an optional so the unfiltered path (no --since) stays byte-for-byte
// unchanged; only when set do we drop older utterances and surface the bound.
type ConversationTranscriptInput = { id: number; since: number | undefined };

const getConversationTranscript: ActionDefinition<ConversationTranscriptInput> = {
  mcp: {
    name: "bee_get_conversation_transcript",
    description:
      "Get ASR transcript utterances for one captured Bee conversation. Use only when transcript detail is needed; avoid direct quotes unless surrounding context gives high confidence.",
    inputSchema: objectSchema({
      properties: {
        id: idNumber("Bee conversation ID."),
        since: {
          type: "number",
          description:
            "Only return utterances spoken at or after this time (epoch milliseconds). Lets a live transcript watcher poll for just new utterances without tracking which it has already seen. Utterances with no timestamp are excluded when set.",
        },
      },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "transcript",
    positionals: [{ name: "id", required: false }],
    // Parse strictly in coerceInput, matching `bee search --since`.
    flags: [{ name: "--since", kind: "string" }],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Conversation Transcript", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    id: coerceConversationId(raw["id"], surface),
    since: parseTranscriptSince(raw["since"], surface),
  }),
  run: async (ctx, input) => {
    const data = asRecord(parseJson(await apiGet(ctx, `/v1/conversations/${input.id}`)));
    const conversation = asRecord(data.conversation);
    let transcript = arrayProp(conversation, "transcriptions").flatMap((transcription) => {
      return arrayProp(asRecord(transcription), "utterances");
    });
    // When --since is set, keep only utterances at or after it, ordered by the
    // SAME timestamp key the detail document uses to sort utterances
    // (spoken_at ?? start ?? 0). Utterances with neither spoken_at nor start are
    // excluded: with no timestamp they cannot be ordered against the bound, so a
    // watcher would re-emit them on every poll. Omitting --since leaves the
    // transcript untouched.
    if (input.since !== undefined) {
      const since = input.since;
      transcript = transcript.filter((utterance) => {
        const record = asRecord(utterance);
        const spokenAt = typeof record["spoken_at"] === "number" ? record["spoken_at"] : null;
        const start = typeof record["start"] === "number" ? record["start"] : null;
        const timestamp = spokenAt ?? start;
        return timestamp !== null && timestamp >= since;
      });
    }
    return {
      kind: "json",
      data: {
        conversationId: input.id,
        // Echo back the applied lower bound so callers can confirm the filter ran;
        // omitted entirely when no --since was supplied.
        ...(input.since !== undefined ? { since: input.since } : {}),
        transcript,
        note: "Transcript text is ASR output and may contain recognition errors. Avoid direct quotes unless surrounding Bee context gives high confidence.",
      },
    };
  },
};

// ---- related (= bee_get_related_conversations) ------------------------------

type ConversationRelatedInput = { id: number; limit: number };

const relatedConversations: ActionDefinition<ConversationRelatedInput> = {
  mcp: {
    name: "bee_get_related_conversations",
    description: "Find captured Bee conversations related to one conversation for surrounding context.",
    inputSchema: objectSchema({
      properties: { id: idNumber("Bee conversation ID."), limit: limitSchema(10) },
      required: ["id"],
    }),
  },
  cli: {
    subcommand: "related",
    positionals: [{ name: "id", required: false }],
    flags: [{ name: "--limit", kind: "int", max: 10 }],
    render: (result, format) => {
      if (result.kind !== "json") {
        return;
      }
      printToolData("Related Conversations", result.data, format);
    },
  },
  coerceInput: (raw, surface) => ({
    id: coerceConversationId(raw["id"], surface),
    // CLI: --limit already validated (max 10); MCP: clamp to [1,10], default 5.
    limit: surface === "cli"
      ? (typeof raw["limit"] === "number" ? raw["limit"] : 5)
      : numberArg(raw["limit"], 5, 1, 10),
  }),
  run: async (ctx, input) => {
    // Related conversations are precomputed server-side (AI-extracted keywords,
    // ranked, persisted) and read from /v1/conversations/:id/related.
    const raw = asRecord(parseJson(await apiGet(ctx, `/v1/conversations/${input.id}/related`)));
    const conversations = arrayProp(raw, "conversations").slice(0, input.limit);
    return {
      kind: "json",
      data: { conversationId: input.id, conversations },
    };
  },
};

export const conversationsResource: ResourceModule = {
  cliCommand: {
    name: "conversations",
    description: "List developer conversations.",
    usage: USAGE,
    missingSubcommandMessage: "Missing subcommand. Use list.",
    unknownSubcommandPrefix: "Unknown conversations subcommand: ",
  },
  actions: [listConversations, getConversation, getConversationTranscript, relatedConversations],
};

// ---- markdown formatters ----------------------------------------------------

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

function parseConversationList(payload: unknown): {
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
  lines.push(`${headingPrefix} Conversation ${conversation.id}`);
  lines.push(`> To read the full conversation, run: \`bee conversations get ${conversation.id}\``);
  lines.push("");
  const startTime = resolveConversationStartTime(conversation);
  lines.push(`- start_time: ${formatDateValue(startTime, timeZone, nowMs)}`);
  if (conversation.end_time !== null) {
    lines.push(`- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`);
  }
  lines.push(`- state: ${conversation.state}`);
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
  lines.push(`- start_time: ${formatDateValue(conversation.start_time, timeZone, nowMs)}`);
  lines.push(`- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`);
  lines.push(`- device_type: ${conversation.device_type}`);
  lines.push(`- state: ${conversation.state}`);
  lines.push(`- created_at: ${formatDateValue(conversation.created_at, timeZone, nowMs)}`);
  lines.push(`- updated_at: ${formatDateValue(conversation.updated_at, timeZone, nowMs)}`);
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
    lines.push(`- ${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`);
    lines.push(`- created_at: ${formatDateValue(location.created_at, timeZone, nowMs)}`);
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Suggested Links", "");
  if (conversation.suggested_links.length > 0) {
    for (const link of conversation.suggested_links) {
      lines.push(`- ${link.url} (${formatDateValue(link.created_at, timeZone, nowMs)})`);
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Utterances", "");
  const transcription = pickTranscription(conversation.transcriptions);
  if (!transcription || transcription.utterances.length === 0) {
    lines.push("- (none)");
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
        timeParts.push(`spoken_at: ${formatDateValue(utterance.spoken_at, timeZone, nowMs)}`);
      }
      if (utterance.start !== null) {
        timeParts.push(`start: ${formatDateValue(utterance.start, timeZone, nowMs)}`);
      }
      if (utterance.end !== null) {
        timeParts.push(`end: ${formatDateValue(utterance.end, timeZone, nowMs)}`);
      }
      const timeSuffix = timeParts.length > 0 ? ` (${timeParts.join(", ")})` : "";
      lines.push(`- ${speaker}: ${text}${timeSuffix}`);
    }
    lines.push("");
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

function pickTranscription(
  transcriptions: ConversationDetail["transcriptions"]
): ConversationDetail["transcriptions"][number] | null {
  if (transcriptions.length === 0) {
    return null;
  }
  const nonRealtime = transcriptions.find((item) => !item.realtime);
  return nonRealtime ?? transcriptions[0] ?? null;
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
