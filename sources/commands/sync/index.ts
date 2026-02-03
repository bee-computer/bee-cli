import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command, CommandContext } from "@/commands/types";
import { requestDeveloperJson } from "@/commands/developerApi";

const USAGE =
  "bee [--staging] sync [--output <dir>] [--recent-days N]";

const DEFAULT_OUTPUT_DIR = "bee-sync";
const DEFAULT_RECENT_DAYS = 3;
const PAGE_SIZE = 100;

type Fact = {
  id: number;
  text: string;
  tags: string[];
  created_at: number;
  confirmed: boolean;
};

type Todo = {
  id: number;
  text: string;
  alarm_at: number | null;
  completed: boolean;
  created_at: number;
};

type DailySummary = {
  id: number;
  date: string | null;
  date_time: number | null;
  short_summary: string;
  summary: string | null;
  email_summary: string | null;
  calendar_summary: string | null;
  conversations_count: number | null;
  locations: Array<{
    id: number | null;
    latitude: number;
    longitude: number;
    address: string | null;
  }> | null;
  created_at: number | null;
};

type DailySummaryDetail = DailySummary & {
  conversations: Array<{
    id: number;
    start_time: number;
    end_time: number | null;
    short_summary: string | null;
    conversation_uuid: string;
    device_type: string;
    state: string;
    primary_location: {
      address: string | null;
      latitude: number;
      longitude: number;
    } | null;
    bookmarked: boolean;
  }> | null;
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
      spoken_at: number;
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

type SyncOptions = {
  outputDir: string;
  recentDays: number;
};

export const syncCommand: Command = {
  name: "sync",
  description: "Sync developer data to markdown files.",
  usage: USAGE,
  run: async (args, context) => {
    const options = parseSyncArgs(args);
    await syncAll(context, options);
  },
};

class ProgressBar {
  private current = 0;
  private total = 0;
  private label = "";
  private readonly width = 28;
  private readonly enabled = process.stdout.isTTY;

  setLabel(label: string): void {
    this.label = label;
    this.render();
  }

  addTotal(amount: number): void {
    if (amount <= 0) {
      return;
    }
    this.total += amount;
    this.render();
  }

  advance(amount = 1): void {
    if (amount <= 0) {
      return;
    }
    this.current += amount;
    if (this.current > this.total) {
      this.total = this.current;
    }
    this.render();
  }

  finish(): void {
    if (this.enabled) {
      process.stdout.write("\n");
    }
  }

  private render(): void {
    if (!this.enabled) {
      return;
    }
    const total = this.total > 0 ? this.total : 1;
    const ratio = Math.min(this.current / total, 1);
    const filled = Math.round(ratio * this.width);
    const empty = Math.max(this.width - filled, 0);
    const bar = `${"#".repeat(filled)}${"-".repeat(empty)}`;
    const percent = Math.round(ratio * 100);
    const label = this.label ? ` ${this.label}` : "";
    process.stdout.write("\r\x1b[2K");
    const text = `[${bar}] ${this.current}/${this.total} ${percent}%${label}`;
    process.stdout.write(text);
  }
}

function parseSyncArgs(args: readonly string[]): SyncOptions {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let recentDays = DEFAULT_RECENT_DAYS;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--output") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--output requires a value");
      }
      outputDir = value;
      i += 1;
      continue;
    }

    if (arg === "--recent-days") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--recent-days requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--recent-days must be a positive integer");
      }
      recentDays = parsed;
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

  return { outputDir, recentDays };
}

async function syncAll(
  context: CommandContext,
  options: SyncOptions
): Promise<void> {
  const progress = new ProgressBar();
  await mkdir(options.outputDir, { recursive: true });

  progress.setLabel("facts");
  const facts = await fetchAllFacts(context, progress);
  progress.setLabel("todos");
  const todos = await fetchAllTodos(context, progress);
  progress.setLabel("daily list");
  const dailySummaries = await fetchAllDailySummaries(context, progress);

  await writeFactsMarkdown(options.outputDir, facts);
  await writeTodosMarkdown(options.outputDir, todos);

  const sortedDaily = [...dailySummaries].sort((a, b) => {
    return dailySortKey(a) - dailySortKey(b);
  });

  const recent = [...sortedDaily]
    .sort((a, b) => dailySortKey(b) - dailySortKey(a))
    .slice(0, options.recentDays);
  progress.addTotal(sortedDaily.length + recent.length);
  for (const summary of sortedDaily) {
    progress.setLabel(`daily ${resolveDailyFolderName(summary)}`);
    await syncDailySummary(context, options.outputDir, summary.id, progress);
  }

  if (recent.length > 0) {
    for (const summary of recent) {
      progress.setLabel(`recent ${resolveDailyFolderName(summary)}`);
      await syncDailySummary(context, options.outputDir, summary.id, progress);
    }
  }
  progress.finish();
}

function dailySortKey(summary: DailySummary): number {
  if (summary.date_time !== null) {
    return summary.date_time;
  }
  if (summary.created_at !== null) {
    return summary.created_at;
  }
  return summary.id;
}

async function fetchAllFacts(
  context: CommandContext,
  progress: ProgressBar
): Promise<Fact[]> {
  const items: Fact[] = [];
  let cursor: string | undefined;
  progress.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const path = params.toString() ? `/v1/facts?${params}` : "/v1/facts";
    const data = await requestDeveloperJson(context, path, { method: "GET" });
    const payload = parseFactsList(data);
    items.push(...payload.facts);
    progress.advance(1);
    if (!payload.next_cursor) {
      break;
    }
    progress.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchAllTodos(
  context: CommandContext,
  progress: ProgressBar
): Promise<Todo[]> {
  const items: Todo[] = [];
  let cursor: string | undefined;
  progress.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const path = params.toString() ? `/v1/todos?${params}` : "/v1/todos";
    const data = await requestDeveloperJson(context, path, { method: "GET" });
    const payload = parseTodosList(data);
    items.push(...payload.todos);
    progress.advance(1);
    if (!payload.next_cursor) {
      break;
    }
    progress.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchAllDailySummaries(
  context: CommandContext,
  progress: ProgressBar
): Promise<DailySummary[]> {
  const items: DailySummary[] = [];
  progress.addTotal(1);
  const data = await requestDeveloperJson(context, "/v1/daily?limit=100", {
    method: "GET",
  });
  const payload = parseDailyList(data);
  items.push(...payload.daily_summaries);
  progress.advance(1);
  return items;
}

async function syncDailySummary(
  context: CommandContext,
  outputDir: string,
  dailyId: number,
  progress: ProgressBar
): Promise<void> {
  const data = await requestDeveloperJson(context, `/v1/daily/${dailyId}`, {
    method: "GET",
  });
  const payload = parseDailyDetail(data);
  const daily = payload.daily_summary;
  const conversationCount = daily.conversations?.length ?? 0;
  progress.addTotal(conversationCount);

  const folderName = resolveDailyFolderName(daily);
  const dailyDir = path.join(outputDir, "daily", folderName);
  const conversationsDir = path.join(dailyDir, "conversations");
  await mkdir(conversationsDir, { recursive: true });

  const summaryMarkdown = formatDailySummaryMarkdown(daily);
  await writeFile(path.join(dailyDir, "summary.md"), summaryMarkdown, "utf8");

  if (daily.conversations && daily.conversations.length > 0) {
    progress.setLabel("conversations");
    for (const conversation of daily.conversations) {
      const detail = await fetchConversation(context, conversation.id);
      const markdown = formatConversationMarkdown(detail);
      await writeFile(
        path.join(conversationsDir, `${conversation.id}.md`),
        markdown,
        "utf8"
      );
      progress.advance(1);
    }
  }
  progress.advance(1);
}

async function fetchConversation(
  context: CommandContext,
  id: number
): Promise<ConversationDetail> {
  const data = await requestDeveloperJson(
    context,
    `/v1/conversations/${id}`,
    { method: "GET" }
  );
  const payload = parseConversationDetail(data);
  return payload.conversation;
}

function resolveDailyFolderName(summary: DailySummary): string {
  if (summary.date) {
    return summary.date;
  }
  if (summary.date_time !== null) {
    return formatDate(summary.date_time);
  }
  return `unknown-${summary.id}`;
}

async function writeFactsMarkdown(
  outputDir: string,
  facts: Fact[]
): Promise<void> {
  const confirmed = facts.filter((fact) => fact.confirmed);
  const pending = facts.filter((fact) => !fact.confirmed);

  const lines: string[] = ["# Facts", ""];
  lines.push("## Confirmed", "");
  lines.push(...formatFactsList(confirmed));
  lines.push("", "## Pending", "");
  lines.push(...formatFactsList(pending));
  lines.push("");

  await writeFile(path.join(outputDir, "facts.md"), lines.join("\n"), "utf8");
}

function formatFactsList(facts: Fact[]): string[] {
  if (facts.length === 0) {
    return ["- (none)"];
  }
  return facts.map((fact) => {
    const createdAt = formatDateTime(fact.created_at);
    const tags = fact.tags.length > 0 ? ` [${fact.tags.join(", ")}]` : "";
    return `- ${fact.text}${tags} (${createdAt}, id ${fact.id})`;
  });
}

async function writeTodosMarkdown(
  outputDir: string,
  todos: Todo[]
): Promise<void> {
  const open = todos.filter((todo) => !todo.completed);
  const completed = todos.filter((todo) => todo.completed);

  const lines: string[] = ["# Todos", ""];
  lines.push("## Open", "");
  lines.push(...formatTodoList(open));
  lines.push("", "## Completed", "");
  lines.push(...formatTodoList(completed));
  lines.push("");

  await writeFile(path.join(outputDir, "todos.md"), lines.join("\n"), "utf8");
}

function formatTodoList(todos: Todo[]): string[] {
  if (todos.length === 0) {
    return ["- (none)"];
  }
  return todos.map((todo) => {
    const createdAt = formatDateTime(todo.created_at);
    const alarm =
      todo.alarm_at !== null ? `, alarm ${formatDateTime(todo.alarm_at)}` : "";
    return `- ${todo.text} (id ${todo.id}, created ${createdAt}${alarm})`;
  });
}

function formatDailySummaryMarkdown(summary: DailySummaryDetail): string {
  const lines: string[] = [];
  const title = summary.date ?? (summary.date_time ? formatDate(summary.date_time) : "Unknown Date");
  lines.push(`# Daily Summary — ${title}`, "");
  lines.push(`- id: ${summary.id}`);
  lines.push(
    `- date_time: ${summary.date_time !== null ? formatDateTime(summary.date_time) : "n/a"}`
  );
  lines.push(
    `- created_at: ${summary.created_at !== null ? formatDateTime(summary.created_at) : "n/a"}`
  );
  lines.push(
    `- conversations_count: ${summary.conversations_count ?? "n/a"}`
  );
  lines.push("");

  lines.push("## Short Summary", "");
  lines.push(summary.short_summary.trim() || "(empty)", "");

  if (summary.summary) {
    lines.push("## Summary", "");
    lines.push(summary.summary.trim() || "(empty)", "");
  }

  if (summary.email_summary) {
    lines.push("## Email Summary", "");
    lines.push(summary.email_summary.trim() || "(empty)", "");
  }

  if (summary.calendar_summary) {
    lines.push("## Calendar Summary", "");
    lines.push(summary.calendar_summary.trim() || "(empty)", "");
  }

  lines.push("## Locations", "");
  if (summary.locations && summary.locations.length > 0) {
    for (const location of summary.locations) {
      const address = location.address ?? "unknown";
      lines.push(
        `- ${address} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`
      );
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Conversations", "");
  if (summary.conversations && summary.conversations.length > 0) {
    for (const conversation of summary.conversations) {
      const start = formatDateTime(conversation.start_time);
      const end =
        conversation.end_time !== null
          ? formatDateTime(conversation.end_time)
          : "n/a";
      const short = conversation.short_summary ?? "(no summary)";
      lines.push(
        `- ${conversation.id} (${start} - ${end}) — ${short} (conversations/${conversation.id}.md)`
      );
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  return lines.join("\n");
}

function formatConversationMarkdown(conversation: ConversationDetail): string {
  const lines: string[] = [];
  lines.push(`# Conversation ${conversation.id}`, "");
  lines.push(`- start_time: ${formatDateTime(conversation.start_time)}`);
  lines.push(
    `- end_time: ${conversation.end_time !== null ? formatDateTime(conversation.end_time) : "n/a"}`
  );
  lines.push(`- device_type: ${conversation.device_type}`);
  lines.push(`- state: ${conversation.state}`);
  lines.push(
    `- created_at: ${formatDateTime(conversation.created_at)}`
  );
  lines.push(
    `- updated_at: ${formatDateTime(conversation.updated_at)}`
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
      `- created_at: ${formatDateTime(location.created_at)}`
    );
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("## Suggested Links", "");
  if (conversation.suggested_links.length > 0) {
    for (const link of conversation.suggested_links) {
      lines.push(`- ${link.url} (${formatDateTime(link.created_at)})`);
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
      lines.push(`### Transcription ${transcription.id}`);
      lines.push(`- realtime: ${transcription.realtime}`);
      lines.push("");

      if (transcription.utterances.length === 0) {
        lines.push("- (no utterances)", "");
      } else {
        for (const utterance of transcription.utterances) {
          const start =
            utterance.start !== null ? formatDateTime(utterance.start) : "n/a";
          const end =
            utterance.end !== null ? formatDateTime(utterance.end) : "n/a";
          lines.push(
            `- ${utterance.speaker || "unknown"}: ${utterance.text} (${start} - ${end})`
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function parseFactsList(payload: unknown): { facts: Fact[]; next_cursor: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid facts response.");
  }
  const data = payload as {
    facts?: Fact[];
    next_cursor?: string | null;
  };
  if (!Array.isArray(data.facts)) {
    throw new Error("Invalid facts response.");
  }
  return {
    facts: data.facts,
    next_cursor: data.next_cursor ?? null,
  };
}

function parseTodosList(payload: unknown): { todos: Todo[]; next_cursor: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid todos response.");
  }
  const data = payload as {
    todos?: Todo[];
    next_cursor?: string | null;
  };
  if (!Array.isArray(data.todos)) {
    throw new Error("Invalid todos response.");
  }
  return {
    todos: data.todos,
    next_cursor: data.next_cursor ?? null,
  };
}

function parseDailyList(payload: unknown): { daily_summaries: DailySummary[] } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid daily response.");
  }
  const data = payload as { daily_summaries?: DailySummary[] };
  if (!Array.isArray(data.daily_summaries)) {
    throw new Error("Invalid daily response.");
  }
  return { daily_summaries: data.daily_summaries };
}

function parseDailyDetail(payload: unknown): { daily_summary: DailySummaryDetail } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid daily detail response.");
  }
  const data = payload as { daily_summary?: DailySummaryDetail };
  if (!data.daily_summary) {
    throw new Error("Invalid daily detail response.");
  }
  return { daily_summary: data.daily_summary };
}

function parseConversationDetail(
  payload: unknown
): { conversation: ConversationDetail } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid conversation response.");
  }
  const data = payload as { conversation?: ConversationDetail };
  if (!data.conversation) {
    throw new Error("Invalid conversation response.");
  }
  return { conversation: data.conversation };
}
