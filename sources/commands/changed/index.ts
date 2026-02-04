import type { Command, CommandContext } from "@/commands/types";
import { printJson, requestClientJson } from "@/client/clientApi";
import {
  formatDateValue,
  formatTimeZoneHeader,
  parseOutputFlag,
  resolveTimeZone,
} from "@/utils/markdown";

const USAGE = "bee changed [--cursor <cursor>] [--json]";

export const changedCommand: Command = {
  name: "changed",
  description: "Fetch recently changed entities.",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    const options = parseChangedArgs(remaining);
    const cursor = options.cursor;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const data = await requestClientJson(context, `/v1/changes${query}`, {
      method: "GET",
    });
    const payload = parseChangesResponse(data);
    const nowMs = normalizeUnixMs(payload.until);
    const timeZone = resolveTimeZone(payload.timezone);

    const [facts, todos, dailies, conversations, journals] = await Promise.all([
      fetchFacts(context, payload.facts),
      fetchTodos(context, payload.todos),
      fetchDailies(context, payload.dailies),
      fetchConversations(context, payload.conversations),
      fetchJournals(context, payload.journals),
    ]);

    const combined = {
      meta: {
        cursor,
        next_cursor: payload.next_cursor ?? null,
        since: payload.since,
        until: payload.until,
        updated: payload.updated,
        timezone: payload.timezone,
      },
      facts,
      todos,
      dailies,
      conversations,
      journals,
    };

    if (format === "json") {
      printJson(combined);
      return;
    }

    const output: string[] = [];
    output.push("# Changed", "", `From: ${formatDateValue(payload.since, timeZone, nowMs)}`);
    output.push(`Until: ${formatDateValue(payload.until, timeZone, nowMs)}`);
    output.push(`Next Cursor: ${payload.next_cursor ?? "(none)"}`, "");

    const sections = renderChangedSections({
      facts,
      todos,
      dailies,
      conversations,
      journals,
      nowMs,
      timeZone,
    });

    if (sections.length === 0) {
      output.push("Nothing changed", "");
      console.log(output.join("\n"));
      return;
    }

    sections.forEach((section, index) => {
      if (index > 0) {
        output.push("-----", "");
      }
      output.push(...section);
    });

    console.log(output.join("\n"));
  },
};

type ChangedOptions = {
  cursor?: string;
};

function parseChangedArgs(args: readonly string[]): ChangedOptions {
  const positionals: string[] = [];
  let cursor: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
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

  const options: ChangedOptions = {};
  if (cursor) {
    options.cursor = cursor;
  }
  return options;
}

type ChangesResponse = {
  facts: number[];
  conversations: number[];
  dailies: number[];
  journals: string[];
  todos: number[];
  since: number;
  until: number;
  updated: boolean;
  timezone: string | null;
  next_cursor?: string | null;
};

function parseChangesResponse(payload: unknown): ChangesResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid changes response.");
  }
  const data = payload as {
    facts?: number[];
    conversations?: number[];
    dailies?: number[];
    journals?: string[];
    todos?: number[];
    since?: number;
    until?: number;
    updated?: boolean;
    timezone?: string;
    next_cursor?: string | null;
  };

  if (
    !Array.isArray(data.facts) ||
    !Array.isArray(data.conversations) ||
    !Array.isArray(data.dailies) ||
    !Array.isArray(data.journals) ||
    !Array.isArray(data.todos)
  ) {
    throw new Error("Invalid changes response.");
  }

  return {
    facts: data.facts,
    conversations: data.conversations,
    dailies: data.dailies,
    journals: data.journals,
    todos: data.todos,
    since: typeof data.since === "number" ? data.since : Date.now(),
    until: typeof data.until === "number" ? data.until : Date.now(),
    updated: data.updated === true,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
    next_cursor: typeof data.next_cursor === "string" ? data.next_cursor : null,
  };
}

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
  alarm_at: number | string | null;
  completed: boolean;
  created_at: number;
};

type DailySummary = {
  id: number;
  date: string | null;
  date_time: number | null;
  summary: string | null;
  created_at: number | null;
};

type ConversationSummary = {
  id: number;
  start_time: number;
  end_time: number | null;
  created_at: number;
  summary: string | null;
};

type JournalSummary = {
  id: string;
  text: string | null;
  state: "PREPARING" | "ANALYZING" | "READY";
  created_at: number;
  updated_at: number;
};

async function fetchFacts(
  context: CommandContext,
  ids: number[]
): Promise<Fact[]> {
  return Promise.all(
    ids.map(async (id) => {
      const data = await requestClientJson(context, `/v1/facts/${id}`, {
        method: "GET",
      });
      const fact = parseFactDetail(data);
      if (!fact) {
        throw new Error("Invalid fact response.");
      }
      return fact;
    })
  );
}

function parseFactDetail(payload: unknown): Fact | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Partial<Fact>;
  if (
    typeof record.id === "number" &&
    typeof record.text === "string" &&
    typeof record.created_at === "number" &&
    typeof record.confirmed === "boolean" &&
    Array.isArray(record.tags)
  ) {
    return record as Fact;
  }
  return null;
}

async function fetchTodos(
  context: CommandContext,
  ids: number[]
): Promise<Todo[]> {
  return Promise.all(
    ids.map(async (id) => {
      const data = await requestClientJson(context, `/v1/todos/${id}`, {
        method: "GET",
      });
      const todo = parseTodoDetail(data);
      if (!todo) {
        throw new Error("Invalid todo response.");
      }
      return todo;
    })
  );
}

function parseTodoDetail(payload: unknown): Todo | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Partial<Todo>;
  if (
    typeof record.id === "number" &&
    typeof record.text === "string" &&
    typeof record.created_at === "number" &&
    typeof record.completed === "boolean"
  ) {
    return {
      id: record.id,
      text: record.text,
      alarm_at: record.alarm_at ?? null,
      completed: record.completed,
      created_at: record.created_at,
    };
  }
  return null;
}

async function fetchDailies(
  context: CommandContext,
  ids: number[]
): Promise<DailySummary[]> {
  return Promise.all(
    ids.map(async (id) => {
      const data = await requestClientJson(context, `/v1/daily/${id}`, {
        method: "GET",
      });
      const summary = parseDailyDetail(data);
      if (!summary) {
        throw new Error("Invalid daily response.");
      }
      return summary;
    })
  );
}

function parseDailyDetail(payload: unknown): DailySummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as { daily_summary?: DailySummary };
  if (!data.daily_summary) {
    return null;
  }
  return data.daily_summary;
}

async function fetchConversations(
  context: CommandContext,
  ids: number[]
): Promise<ConversationSummary[]> {
  return Promise.all(
    ids.map(async (id) => {
      const data = await requestClientJson(context, `/v1/conversations/${id}`, {
        method: "GET",
      });
      const conversation = parseConversationDetail(data);
      if (!conversation) {
        throw new Error("Invalid conversation response.");
      }
      return conversation;
    })
  );
}

function parseConversationDetail(payload: unknown): ConversationSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as { conversation?: ConversationSummary };
  if (!data.conversation) {
    return null;
  }
  return data.conversation;
}

async function fetchJournals(
  context: CommandContext,
  ids: string[]
): Promise<JournalSummary[]> {
  return Promise.all(
    ids.map(async (id) => {
      const data = await requestClientJson(context, `/v1/journals/${id}`, {
        method: "GET",
      });
      const journal = parseJournalDetail(data);
      if (!journal) {
        throw new Error("Invalid journal response.");
      }
      return journal;
    })
  );
}

function parseJournalDetail(payload: unknown): JournalSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Partial<JournalSummary>;
  if (
    typeof record.id === "string" &&
    typeof record.state === "string" &&
    typeof record.created_at === "number" &&
    typeof record.updated_at === "number"
  ) {
    return {
      id: record.id,
      text: record.text ?? null,
      state: record.state as JournalSummary["state"],
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }
  return null;
}

function renderChangedSections(options: {
  facts: Fact[];
  todos: Todo[];
  dailies: DailySummary[];
  conversations: ConversationSummary[];
  journals: JournalSummary[];
  nowMs: number;
  timeZone: string;
}): string[][] {
  const sections: string[][] = [];
  sections.push(...renderFactsSections(options.facts));

  const todosSection = renderTodosList(options.todos, options.nowMs, options.timeZone);
  if (options.todos.length > 0) {
    sections.push(todosSection);
  }

  const dailySection = renderDailyList(options.dailies, options.nowMs, options.timeZone);
  if (options.dailies.length > 0) {
    sections.push(dailySection);
  }

  const conversationSection = renderConversationList(
    options.conversations,
    options.nowMs,
    options.timeZone
  );
  if (options.conversations.length > 0) {
    sections.push(conversationSection);
  }

  const journalSection = renderJournalList(
    options.journals,
    options.nowMs,
    options.timeZone
  );
  if (options.journals.length > 0) {
    sections.push(journalSection);
  }

  return sections.filter((section) => section.length > 0);
}

function renderFactsSections(facts: Fact[]): string[][] {
  const confirmed = facts.filter((fact) => fact.confirmed);
  const pending = facts.filter((fact) => !fact.confirmed);
  const sections: string[][] = [];
  if (confirmed.length > 0) {
    sections.push(formatFactsListSection("Confirmed Facts", confirmed));
  }
  if (pending.length > 0) {
    sections.push(formatFactsListSection("Pending Facts", pending));
  }
  return sections;
}

function formatFactsListSection(title: string, facts: Fact[]): string[] {
  const lines: string[] = [`# ${title}`, ""];
  if (facts.length === 0) {
    lines.push("- (none)", "");
    return lines;
  }
  for (const fact of facts) {
    lines.push(`- ${fact.text.trim() || "(empty)"}`);
  }
  lines.push("");
  return lines;
}

function renderTodosList(todos: Todo[], nowMs: number, timeZone: string): string[] {
  const open = todos.filter((todo) => !todo.completed);
  const completed = todos.filter((todo) => todo.completed);
  const lines: string[] = ["# Todos", ""];
  lines.push("## Open", "");
  lines.push(...formatTodosSection(open, nowMs, timeZone));
  lines.push("## Completed", "");
  lines.push(...formatTodosSection(completed, nowMs, timeZone));
  return lines;
}

function formatTodosSection(
  todos: Todo[],
  nowMs: number,
  timeZone: string
): string[] {
  if (todos.length === 0) {
    return ["- (none)", ""];
  }
  const lines: string[] = [];
  for (const todo of todos) {
    lines.push(...formatTodoBlock(todo, nowMs, timeZone, "###"));
  }
  return lines;
}

function formatTodoBlock(
  todo: Todo,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Todo ${todo.id}`, "");
  lines.push(formatTimeZoneHeader(timeZone));
  lines.push(`- created_at: ${formatDateValue(todo.created_at, timeZone, nowMs)}`);
  lines.push(`- alarm_at: ${formatDateValue(todo.alarm_at ?? null, timeZone, nowMs)}`);
  lines.push(`- completed: ${todo.completed ? "true" : "false"}`);
  lines.push(`- text: ${todo.text.trim() || "(empty)"}`);
  lines.push("");
  return lines;
}

function renderDailyList(
  dailies: DailySummary[],
  nowMs: number,
  timeZone: string
): string[] {
  const lines: string[] = ["# Daily Summaries", ""];
  lines.push(formatTimeZoneHeader(timeZone), "");

  dailies.forEach((summary, index) => {
    lines.push(...formatDailySummaryBlock(summary, nowMs, timeZone, "###"));
    if (index < dailies.length - 1) {
      lines.push("-----", "");
    }
  });

  return lines;
}

function formatDailySummaryBlock(
  summary: DailySummary,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Daily Summary ${summary.id}`, "");
  const resolvedDate = resolveDailyDate(summary);
  lines.push(`- date: ${formatDateValue(resolvedDate, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatSummaryText(summary.summary));
  lines.push("");
  return lines;
}

function resolveDailyDate(
  summary: Pick<DailySummary, "date" | "date_time" | "created_at">
): number | string | null {
  if (summary.date) {
    return summary.date;
  }
  if (summary.date_time !== null) {
    return summary.date_time;
  }
  return summary.created_at ?? null;
}

function renderConversationList(
  conversations: ConversationSummary[],
  nowMs: number,
  timeZone: string
): string[] {
  const lines: string[] = ["# Conversations", ""];
  lines.push(formatTimeZoneHeader(timeZone), "");

  conversations.forEach((conversation, index) => {
    lines.push(
      ...formatConversationSummaryBlock(conversation, nowMs, timeZone, "###")
    );
    if (index < conversations.length - 1) {
      lines.push("-----", "");
    }
  });

  return lines;
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
  lines.push(`- start_time: ${formatDateValue(startTime, timeZone, nowMs)}`);
  lines.push(`- end_time: ${formatDateValue(conversation.end_time, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatSummaryText(conversation.summary));
  lines.push("");
  return lines;
}

function resolveConversationStartTime(
  conversation: Pick<ConversationSummary, "created_at" | "start_time">
): number | null {
  return conversation.start_time ?? conversation.created_at ?? null;
}

function renderJournalList(
  journals: JournalSummary[],
  nowMs: number,
  timeZone: string
): string[] {
  const lines: string[] = ["# Journals", ""];
  lines.push(formatTimeZoneHeader(timeZone), "");

  journals.forEach((journal, index) => {
    lines.push(...formatJournalSummaryBlock(journal, nowMs, timeZone, "###"));
    if (index < journals.length - 1) {
      lines.push("-----", "");
    }
  });

  return lines;
}

function formatJournalSummaryBlock(
  journal: JournalSummary,
  nowMs: number,
  timeZone: string,
  headingPrefix: string
): string[] {
  const lines: string[] = [];
  lines.push(`${headingPrefix} Journal ${journal.id}`, "");
  lines.push(`- state: ${journal.state}`);
  lines.push(`- created_at: ${formatDateValue(journal.created_at, timeZone, nowMs)}`);
  lines.push(`- updated_at: ${formatDateValue(journal.updated_at, timeZone, nowMs)}`);
  lines.push("");
  lines.push(...formatSummaryText(journal.text));
  lines.push("");
  return lines;
}

function formatSummaryText(text: string | null): string[] {
  const normalized = text?.trim() ?? "";
  if (!normalized) {
    return ["(empty)"];
  }
  return normalized.split(/\r?\n/);
}

function normalizeUnixMs(value: number): number {
  if (!Number.isFinite(value)) {
    return Date.now();
  }
  return value > 1e12 ? value : value * 1000;
}
