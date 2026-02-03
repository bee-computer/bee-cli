import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command, CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";

const USAGE =
  "bee sync [--output <dir>] [--only <facts|todos|daily|conversations>]";

const DEFAULT_OUTPUT_DIR = "bee-sync";
const PAGE_SIZE = 100;
const SYNC_CONCURRENCY = 4;
const FALLBACK_TIMEZONE = "America/Los_Angeles";
const DEFAULT_TIMEZONE = resolveDefaultTimezone();

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
  timezone?: string | null;
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
  timezone?: string | null;
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

type ConversationSummary = {
  id: number;
  start_time: number;
  created_at: number;
  timezone?: string | null;
};

type SyncTarget = "facts" | "todos" | "daily" | "conversations";

type SyncOptions = {
  outputDir: string;
  targets: Set<SyncTarget>;
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

class MultiProgress {
  private readonly tasks: ProgressTask[] = [];
  private rendered = false;
  private readonly enabled = process.stdout.isTTY;
  private spinnerIndex = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly spinnerFrames = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];
  private readonly spinnerIntervalMs = 80;

  constructor() {
    if (!this.enabled) {
      return;
    }
    this.ticker = setInterval(() => {
      if (this.tasks.length === 0) {
        return;
      }
      if (!this.tasks.some((task) => task.isActive())) {
        return;
      }
      this.advanceSpinner();
      this.render();
    }, this.spinnerIntervalMs);
    this.ticker.unref?.();
  }

  addTask(label: string): ProgressTask {
    const task = new ProgressTask(this, label);
    this.tasks.push(task);
    return task;
  }

  finish(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.enabled && this.rendered) {
      process.stdout.write("\n");
    }
  }

  render(): void {
    if (!this.enabled) {
      return;
    }

    const spinner = this.currentSpinner();
    const lines = this.tasks.map((task) => task.renderLine(spinner));
    if (!this.rendered) {
      process.stdout.write(lines.join("\n"));
      this.rendered = true;
      return;
    }

    process.stdout.write(`\x1b[${lines.length}A`);
    for (const line of lines) {
      process.stdout.write("\r\x1b[2K");
      process.stdout.write(line);
      process.stdout.write("\n");
    }
  }

  private currentSpinner(): string {
    return this.spinnerFrames[this.spinnerIndex] ?? "⠋";
  }

  private advanceSpinner(): void {
    if (this.spinnerFrames.length === 0) {
      return;
    }
    this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
  }
}

class ProgressTask {
  private current = 0;
  private total = 0;
  private label: string;
  private active = true;

  constructor(private readonly progress: MultiProgress, label: string) {
    this.label = label;
  }

  setLabel(label: string): void {
    this.label = label;
    this.progress.render();
  }

  setTotal(total: number): void {
    this.total = Math.max(total, 0);
    if (this.current > this.total) {
      this.current = this.total;
    }
    this.progress.render();
  }

  addTotal(amount: number): void {
    if (amount <= 0) {
      return;
    }
    this.total += amount;
    this.progress.render();
  }

  advance(amount = 1): void {
    if (amount <= 0) {
      return;
    }
    this.current += amount;
    if (this.current > this.total) {
      this.total = this.current;
    }
    this.progress.render();
  }

  complete(): void {
    this.active = false;
    this.progress.render();
  }

  isActive(): boolean {
    return this.active;
  }

  renderLine(spinner: string): string {
    const label = this.label ? `${this.label}` : "";
    const indicator = this.active ? spinner : " ";
    const counts = `${this.current}`;
    return `${label.padEnd(16)} ${indicator} ${counts}`;
  }
}

function parseSyncArgs(args: readonly string[]): SyncOptions {
  let outputDir = DEFAULT_OUTPUT_DIR;
  const onlyTargets: SyncTarget[] = [];
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

    if (arg === "--only") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--only requires a value");
      }
      const parsed = parseTargets(value);
      onlyTargets.push(...parsed);
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

  const targets = resolveTargets(onlyTargets);
  return { outputDir, targets };
}

function parseTargets(value: string): SyncTarget[] {
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error("--only requires a non-empty value");
  }

  if (parts.includes("all")) {
    return ["facts", "todos", "daily", "conversations"];
  }

  const targets: SyncTarget[] = [];
  for (const part of parts) {
    if (isSyncTarget(part)) {
      targets.push(part);
      continue;
    }
    throw new Error(`Unknown sync target: ${part}`);
  }

  return targets;
}

function resolveTargets(onlyTargets: SyncTarget[]): Set<SyncTarget> {
  if (onlyTargets.length === 0) {
    return new Set<SyncTarget>(["facts", "todos", "daily", "conversations"]);
  }
  return new Set<SyncTarget>(onlyTargets);
}

function isSyncTarget(value: string): value is SyncTarget {
  return (
    value === "facts" ||
    value === "todos" ||
    value === "daily" ||
    value === "conversations"
  );
}

async function syncAll(
  context: CommandContext,
  options: SyncOptions
): Promise<void> {
  const progress = new MultiProgress();
  await mkdir(options.outputDir, { recursive: true });

  const syncPromises: Promise<void>[] = [];

  if (options.targets.has("facts")) {
    const task = progress.addTask("facts");
    syncPromises.push(syncFacts(context, options.outputDir, task));
  }

  if (options.targets.has("todos")) {
    const task = progress.addTask("todos");
    syncPromises.push(syncTodos(context, options.outputDir, task));
  }

  if (options.targets.has("daily")) {
    const task = progress.addTask("daily");
    syncPromises.push(syncDaily(context, options.outputDir, task));
  }

  if (options.targets.has("conversations")) {
    const task = progress.addTask("conversations");
    syncPromises.push(syncConversations(context, options.outputDir, task));
  }

  await Promise.all(syncPromises);
  progress.finish();
}

async function syncFacts(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask
): Promise<void> {
  const facts = await fetchAllFacts(context, task);
  await writeFactsMarkdown(outputDir, facts);
  task.setLabel("facts done");
  task.complete();
}

async function syncTodos(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask
): Promise<void> {
  const todos = await fetchAllTodos(context, task);
  await writeTodosMarkdown(outputDir, todos);
  task.setLabel("todos done");
  task.complete();
}

async function syncDaily(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask
): Promise<void> {
  const dailySummaries = await fetchAllDailySummaries(context, task);
  const dailyDir = path.join(outputDir, "daily");
  await mkdir(dailyDir, { recursive: true });

  const sortedDaily = [...dailySummaries].sort(
    (a, b) => dailySortKey(a) - dailySortKey(b)
  );
  task.setTotal(sortedDaily.length);

  await runWithConcurrency(sortedDaily, SYNC_CONCURRENCY, async (summary) => {
    const detail = await fetchDailySummary(context, summary.id);
    const folderName = resolveDailyFolderName(detail);
    const dayDir = path.join(dailyDir, folderName);
    await mkdir(dayDir, { recursive: true });
    const markdown = formatDailySummaryMarkdown(detail);
    await writeFile(path.join(dayDir, "summary.md"), markdown, "utf8");
    task.advance(1);
  });

  task.setLabel("daily done");
  task.complete();
}

async function syncConversations(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask
): Promise<void> {
  const conversations = await fetchAllConversations(context, task);
  const conversationsDir = path.join(outputDir, "conversations");
  await mkdir(conversationsDir, { recursive: true });

  const sortedConversations = [...conversations].sort(
    (a, b) => conversationSortKey(a) - conversationSortKey(b)
  );
  task.setTotal(sortedConversations.length);

  await runWithConcurrency(
    sortedConversations,
    SYNC_CONCURRENCY,
    async (conversation) => {
      const detail = await fetchConversation(context, conversation.id);
      const dateFolder = resolveConversationFolderName(detail);
      const dayDir = path.join(conversationsDir, dateFolder);
      await mkdir(dayDir, { recursive: true });
      const markdown = formatConversationMarkdown(detail);
      await writeFile(path.join(dayDir, `${conversation.id}.md`), markdown, "utf8");
      task.advance(1);
    }
  );

  task.setLabel("conversations done");
  task.complete();
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

function conversationSortKey(conversation: ConversationSummary): number {
  return conversation.start_time ?? conversation.created_at ?? conversation.id;
}

async function fetchAllFacts(
  context: CommandContext,
  task: ProgressTask
): Promise<Fact[]> {
  const items: Fact[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const apiPath = params.toString() ? `/v1/facts?${params}` : "/v1/facts";
    const data = await requestClientJson(context, apiPath, { method: "GET" });
    const payload = parseFactsList(data);
    items.push(...payload.facts);
    task.advance(payload.facts.length);
    if (!payload.next_cursor) {
      break;
    }
    task.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchAllTodos(
  context: CommandContext,
  task: ProgressTask
): Promise<Todo[]> {
  const items: Todo[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const apiPath = params.toString() ? `/v1/todos?${params}` : "/v1/todos";
    const data = await requestClientJson(context, apiPath, { method: "GET" });
    const payload = parseTodosList(data);
    items.push(...payload.todos);
    task.advance(payload.todos.length);
    if (!payload.next_cursor) {
      break;
    }
    task.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchAllDailySummaries(
  context: CommandContext,
  task: ProgressTask
): Promise<DailySummary[]> {
  const items: DailySummary[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const apiPath = params.toString() ? `/v1/daily?${params}` : "/v1/daily";
    const data = await requestClientJson(context, apiPath, { method: "GET" });
    const payload = parseDailyList(data);
    items.push(...payload.daily_summaries);
    task.advance(payload.daily_summaries.length);
    if (!payload.next_cursor) {
      break;
    }
    task.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchAllConversations(
  context: CommandContext,
  task: ProgressTask
): Promise<ConversationSummary[]> {
  const items: ConversationSummary[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursor", cursor);
    }
    const apiPath = params.toString()
      ? `/v1/conversations?${params}`
      : "/v1/conversations";
    const data = await requestClientJson(context, apiPath, { method: "GET" });
    const payload = parseConversationList(data);
    items.push(...payload.conversations);
    task.advance(payload.conversations.length);
    if (!payload.next_cursor) {
      break;
    }
    task.addTotal(1);
    cursor = payload.next_cursor;
  }

  return items;
}

async function fetchDailySummary(
  context: CommandContext,
  dailyId: number
): Promise<DailySummaryDetail> {
  const data = await requestClientJson(context, `/v1/daily/${dailyId}`, {
    method: "GET",
  });
  const payload = parseDailyDetail(data);
  return payload.daily_summary;
}

async function fetchConversation(
  context: CommandContext,
  id: number
): Promise<ConversationDetail> {
  const data = await requestClientJson(context, `/v1/conversations/${id}`, {
    method: "GET",
  });
  const payload = parseConversationDetail(data);
  return payload.conversation;
}

function resolveDailyFolderName(summary: DailySummary): string {
  const timestamp = summary.date_time ?? summary.created_at ?? 0;
  const timeZone = resolveTimezone(summary.timezone);
  return formatDateInTimeZone(timestamp, timeZone);
}

function resolveConversationFolderName(conversation: ConversationDetail): string {
  const timestamp = conversation.start_time ?? conversation.created_at ?? 0;
  const timeZone = resolveTimezone(conversation.timezone);
  return formatDateInTimeZone(timestamp, timeZone);
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
  const title = resolveDailyFolderName(summary);
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
      lines.push(`- ${conversation.id} (${start} - ${end}) — ${short}`);
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
  lines.push(`- created_at: ${formatDateTime(conversation.created_at)}`);
  lines.push(`- updated_at: ${formatDateTime(conversation.updated_at)}`);
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
    lines.push(`- created_at: ${formatDateTime(location.created_at)}`);
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
        const sortedUtterances = [...transcription.utterances].sort((a, b) => {
          const timeA = a.spoken_at ?? a.start ?? 0;
          const timeB = b.spoken_at ?? b.start ?? 0;
          if (timeA !== timeB) {
            return timeA - timeB;
          }
          return a.id - b.id;
        });
        for (const utterance of sortedUtterances) {
          lines.push(
            `- ${utterance.speaker || "unknown"}: ${utterance.text}`
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

function formatDateInTimeZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }
  return `${lookup["year"]}-${lookup["month"]}-${lookup["day"]}`;
}

function resolveTimezone(candidate?: string | null): string {
  if (isValidTimeZone(candidate)) {
    return candidate;
  }
  return DEFAULT_TIMEZONE;
}

function resolveDefaultTimezone(): string {
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (isValidTimeZone(systemTz)) {
    return systemTz;
  }
  return FALLBACK_TIMEZONE;
}

function isValidTimeZone(timeZone?: string | null): timeZone is string {
  if (!timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
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

function parseDailyList(
  payload: unknown
): { daily_summaries: DailySummary[]; next_cursor: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid daily response.");
  }
  const data = payload as {
    daily_summaries?: DailySummary[];
    next_cursor?: string | null;
  };
  if (!Array.isArray(data.daily_summaries)) {
    throw new Error("Invalid daily response.");
  }
  return {
    daily_summaries: data.daily_summaries,
    next_cursor: data.next_cursor ?? null,
  };
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

function parseConversationList(
  payload: unknown
): { conversations: ConversationSummary[]; next_cursor: string | null } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid conversation list response.");
  }
  const data = payload as {
    conversations?: ConversationSummary[];
    next_cursor?: string | null;
  };
  if (!Array.isArray(data.conversations)) {
    throw new Error("Invalid conversation list response.");
  }
  return {
    conversations: data.conversations,
    next_cursor: data.next_cursor ?? null,
  };
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

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        break;
      }
      await worker(items[current] as T);
    }
  });

  await Promise.all(runners);
}
