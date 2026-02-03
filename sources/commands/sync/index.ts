import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command, CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";

const USAGE =
  "bee sync [--output <dir>] [--recent-days N] [--only <facts|todos|daily|conversations>]";

const DEFAULT_OUTPUT_DIR = "bee-sync";
const DEFAULT_RECENT_DAYS = 3;
const PAGE_SIZE = 100;
const CONVERSATION_CONCURRENCY = 4;
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
  recentDays: number;
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

  reset(): void {
    this.current = 0;
    this.total = 0;
    this.active = true;
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
  let recentDays = DEFAULT_RECENT_DAYS;
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
  return { outputDir, recentDays, targets };
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
    return new Set<SyncTarget>(["facts", "todos", "daily"]);
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
  const factsTask = options.targets.has("facts")
    ? progress.addTask("facts")
    : null;
  const todosTask = options.targets.has("todos")
    ? progress.addTask("todos")
    : null;
  const dailyListTask = options.targets.has("daily")
    ? progress.addTask("daily list")
    : null;
  const dailySyncTask = options.targets.has("daily")
    ? progress.addTask("daily sync")
    : null;
  const dailyConversationTask = options.targets.has("daily")
    ? progress.addTask("daily conversations")
    : null;
  const conversationListTask = options.targets.has("conversations")
    ? progress.addTask("conversation list")
    : null;
  const conversationTask = options.targets.has("conversations")
    ? progress.addTask("all conversations")
    : null;
  await mkdir(options.outputDir, { recursive: true });

  const [facts, todos, dailySummaries, conversations] = await Promise.all([
    factsTask ? fetchAllFacts(context, factsTask) : Promise.resolve<Fact[]>([]),
    todosTask ? fetchAllTodos(context, todosTask) : Promise.resolve<Todo[]>([]),
    dailyListTask
      ? fetchAllDailySummaries(context, dailyListTask)
      : Promise.resolve<DailySummary[]>([]),
    conversationListTask
      ? fetchAllConversations(context, conversationListTask)
      : Promise.resolve<ConversationSummary[]>([]),
  ]);
  if (factsTask) {
    factsTask.setLabel("facts done");
    factsTask.complete();
    await writeFactsMarkdown(options.outputDir, facts);
  }
  if (todosTask) {
    todosTask.setLabel("todos done");
    todosTask.complete();
    await writeTodosMarkdown(options.outputDir, todos);
  }
  if (dailyListTask) {
    dailyListTask.setLabel("daily list done");
    dailyListTask.complete();
  }
  if (conversationListTask) {
    conversationListTask.setLabel("conversation list done");
    conversationListTask.complete();
  }

  const dailySyncPromise =
    options.targets.has("daily") && dailySyncTask && dailyConversationTask
      ? (async () => {
          const sortedDaily = [...dailySummaries].sort((a, b) => {
            return dailySortKey(a) - dailySortKey(b);
          });

          const recent = [...sortedDaily]
            .sort((a, b) => dailySortKey(b) - dailySortKey(a))
            .slice(0, options.recentDays);
          dailySyncTask.setTotal(sortedDaily.length + recent.length);
          dailyConversationTask.reset();
          for (const summary of sortedDaily) {
            dailySyncTask.setLabel(`daily ${resolveDailyFolderName(summary)}`);
            await syncDailySummary(
              context,
              options.outputDir,
              summary.id,
              dailySyncTask,
              dailyConversationTask
            );
          }

          if (recent.length > 0) {
            for (const summary of recent) {
              dailySyncTask.setLabel(`recent ${resolveDailyFolderName(summary)}`);
              await syncDailySummary(
                context,
                options.outputDir,
                summary.id,
                dailySyncTask,
                dailyConversationTask
              );
            }
          }
          dailySyncTask.setLabel("daily sync done");
          dailySyncTask.complete();
          dailyConversationTask.setLabel("daily conversations done");
          dailyConversationTask.complete();
        })()
      : Promise.resolve();

  const conversationsSyncPromise =
    options.targets.has("conversations") && conversationTask
      ? (async () => {
          const sortedConversations = [...conversations].sort(
            (a, b) => conversationSortKey(a) - conversationSortKey(b)
          );
          conversationTask.setTotal(sortedConversations.length);

          const conversationsRoot = path.join(options.outputDir, "conversations");
          await mkdir(conversationsRoot, { recursive: true });
          await runWithConcurrency(
            sortedConversations,
            CONVERSATION_CONCURRENCY,
            async (conversation) => {
              const detail = await fetchConversation(context, conversation.id);
              const dateFolder = resolveConversationFolderName(detail);
              const conversationsDir = path.join(conversationsRoot, dateFolder);
              await mkdir(conversationsDir, { recursive: true });
              const markdown = formatConversationMarkdown(detail);
              await writeFile(
                path.join(conversationsDir, `${conversation.id}.md`),
                markdown,
                "utf8"
              );
              conversationTask.advance(1);
            }
          );
          conversationTask.setLabel("all conversations done");
          conversationTask.complete();
        })()
      : Promise.resolve();

  await Promise.all([dailySyncPromise, conversationsSyncPromise]);
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
    const path = params.toString() ? `/v1/facts?${params}` : "/v1/facts";
    const data = await requestClientJson(context, path, { method: "GET" });
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
    const path = params.toString() ? `/v1/todos?${params}` : "/v1/todos";
    const data = await requestClientJson(context, path, { method: "GET" });
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
    const path = params.toString() ? `/v1/daily?${params}` : "/v1/daily";
    const data = await requestClientJson(context, path, { method: "GET" });
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
    const path = params.toString()
      ? `/v1/conversations?${params}`
      : "/v1/conversations";
    const data = await requestClientJson(context, path, { method: "GET" });
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

function conversationSortKey(conversation: ConversationSummary): number {
  return conversation.start_time ?? conversation.created_at ?? conversation.id;
}

async function syncDailySummary(
  context: CommandContext,
  outputDir: string,
  dailyId: number,
  dailyTask: ProgressTask,
  conversationTask: ProgressTask
): Promise<void> {
  const data = await requestClientJson(context, `/v1/daily/${dailyId}`, {
    method: "GET",
  });
  const payload = parseDailyDetail(data);
  const daily = payload.daily_summary;
  const conversationCount = daily.conversations?.length ?? 0;
  if (conversationCount > 0) {
    conversationTask.addTotal(conversationCount);
    conversationTask.setLabel(`conversations ${resolveDailyFolderName(daily)}`);
  }

  const folderName = resolveDailyFolderName(daily);
  const dailyDir = path.join(outputDir, "daily", folderName);
  const conversationsDir = path.join(dailyDir, "conversations");
  await mkdir(conversationsDir, { recursive: true });

  const summaryMarkdown = formatDailySummaryMarkdown(daily);
  await writeFile(path.join(dailyDir, "summary.md"), summaryMarkdown, "utf8");

  if (daily.conversations && daily.conversations.length > 0) {
    await runWithConcurrency(
      daily.conversations,
      CONVERSATION_CONCURRENCY,
      async (conversation) => {
        const detail = await fetchConversation(context, conversation.id);
        const markdown = formatConversationMarkdown(detail);
        await writeFile(
          path.join(conversationsDir, `${conversation.id}.md`),
          markdown,
          "utf8"
        );
        conversationTask.advance(1);
      }
    );
  }
  dailyTask.advance(1);
}

async function fetchConversation(
  context: CommandContext,
  id: number
): Promise<ConversationDetail> {
  const data = await requestClientJson(
    context,
    `/v1/conversations/${id}`,
    { method: "GET" }
  );
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
