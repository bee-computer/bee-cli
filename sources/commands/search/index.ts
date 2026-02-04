import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatRecordMarkdown,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE =
  "bee search conversations --query <text> [--limit N] [--cursor <cursor>] [--json]";

export const searchCommand: Command = {
  name: "search",
  description: "Search developer data.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use conversations.");
    }

    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "conversations":
        await handleConversations(rest, context);
        return;
      default:
        throw new Error(`Unknown search subcommand: ${subcommand}`);
    }
  },
};

type ConversationsOptions = {
  query: string;
  limit?: number;
  cursor?: string;
};

async function handleConversations(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  const { format, args: remaining } = parseOutputFlag(args);
  const options = parseConversationsArgs(remaining);
  const body: { query: string; limit?: number; cursor?: string } = {
    query: options.query,
  };

  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.cursor !== undefined) {
    body.cursor = options.cursor;
  }

  const data = await requestClientJson(context, "/v1/search/conversations", {
    method: "POST",
    json: body,
  });
  if (format === "json") {
    printJson(data);
    return;
  }

  const nowMs = Date.now();
  const payload = parseSearchConversations(data);
  if (!payload) {
    const timeZone = resolveTimeZone(extractTimeZone(data));
    console.log(
      formatRecordMarkdown({
        title: "Conversation Search Results",
        record: normalizeRecord(data),
        timeZone,
        nowMs,
      })
    );
    return;
  }

  const lines: string[] = ["# Conversation Search Results", ""];
  if (payload.conversations.length === 0) {
    lines.push("- (none)", "");
  } else {
    for (const conversation of payload.conversations) {
      const timeZone = resolveTimeZone(extractTimeZone(conversation));
      lines.push(
        formatRecordMarkdown({
          title: `Conversation ${conversation.id ?? "unknown"}`,
          record: conversation,
          timeZone,
          nowMs,
          headingLevel: 3,
        }).trimEnd()
      );
      lines.push("");
    }
  }

  if (payload.next_cursor) {
    lines.push("## Pagination", "");
    lines.push(`- next_cursor: ${payload.next_cursor}`, "");
  }

  console.log(lines.join("\n"));
}

function parseConversationsArgs(args: readonly string[]): ConversationsOptions {
  let query: string | undefined;
  let limit: number | undefined;
  let cursor: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--query") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--query requires a value");
      }
      query = value;
      i += 1;
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
      limit = parsed;
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--cursor requires a value");
      }
      cursor = value;
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

  if (!query) {
    throw new Error("Missing query. Provide --query.");
  }

  const options: ConversationsOptions = { query };
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (cursor !== undefined) {
    options.cursor = cursor;
  }

  return options;
}

type ConversationSearchItem = Record<string, unknown> & {
  id?: number;
  timezone?: string | null;
  time_zone?: string | null;
  timeZone?: string | null;
};

function parseSearchConversations(
  payload: unknown
): { conversations: ConversationSearchItem[]; next_cursor: string | null } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as Record<string, unknown>;
  const candidates = [
    data["conversations"],
    data["results"],
    data["matches"],
    data["items"],
  ];
  const list = candidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(list)) {
    return null;
  }
  return {
    conversations: list as ConversationSearchItem[],
    next_cursor:
      typeof data["next_cursor"] === "string" || data["next_cursor"] === null
        ? (data["next_cursor"] as string | null)
        : null,
  };
}

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
