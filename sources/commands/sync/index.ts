import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command, CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";
import type { Environment } from "@/environment";
import { loadToken } from "@/secureStore";

const USAGE =
  "bee sync [--output <dir>] [--recent-days N] [--full] [--only <facts|todos|daily|conversations>]";

const DEFAULT_OUTPUT_DIR = "bee-sync";
const PAGE_SIZE = 100;
const BATCH_DETAIL_SIZE = 100;
const SYNC_CONCURRENCY = 4;
const FALLBACK_TIMEZONE = "America/Los_Angeles";
const DEFAULT_TIMEZONE = resolveDefaultTimezone();

// Sync-state manifest constants. The manifest persists per-target changefeed
// cursors so daily/conversations can sync incrementally. See the completeness
// guarantee in the implementation plan.
const MANIFEST_VERSION = 1 as const;
const MANIFEST_FILENAME = ".bee-sync.json";
// Subtracted from the changefeed `until` before persisting a cursor so that the
// trailing window is re-scanned every run, defeating the commit-after-snapshot
// race and cross-service clock skew. Over-scan is idempotent.
const CHANGES_OVERLAP_MS = 600000; // 10 minutes
// Cursors older than this take the full path before the server's 7-day floor can
// reject them with cursor_too_old.
const PROACTIVE_FULL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

// Changefeed-driven targets carry a per-target cursor; facts/todos always full-refetch.
type ChangefeedTarget = "daily" | "conversations";

type SyncManifest = {
  schemaVersion: typeof MANIFEST_VERSION;
  env: Environment;
  account: string;
  cursors: {
    daily?: string;
    conversations?: string;
  };
  pending: {
    daily: number[];
    conversations: number[];
  };
  lastFullSyncAtMs: number;
  lastSyncAtMs: number;
};

type ChangesResult = {
  dailies: number[];
  conversations: number[];
  facts: number[];
  todos: number[];
  journals: string[];
  since: number;
  until: number;
  updated: boolean;
  next_cursor: string | null;
};

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
  recentDays: number | undefined;
  full: boolean;
  since: string | undefined;
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
  let recentDays: number | undefined;
  let full = false;
  let since: string | undefined;
  const onlyTargets: SyncTarget[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--full") {
      full = true;
      continue;
    }

    if (arg === "--since") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--since requires a value");
      }
      since = value;
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
  return { outputDir, targets, recentDays, full, since };
}

// Returns the YYYY-MM-DD that is (days - 1) calendar days before today, i.e. the
// inclusive start of a window covering the last `days` days. Used as the server
// `from` filter so daily summaries and conversations are scoped server-side.
function recentDaysFrom(days: number): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
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

// ---------------------------------------------------------------------------
// Sync-state manifest: read/validate, atomic write, cursor + account helpers
// ---------------------------------------------------------------------------

// A stable per-account fingerprint so re-authenticating as a different user
// against the same output dir forces a full resync. Proxy clients carry no
// token, so they share the "proxy" fingerprint. Token bytes are hashed, never
// stored.
async function accountFingerprint(context: CommandContext): Promise<string> {
  if (context.client.isProxy) {
    return "proxy";
  }
  const token = await loadToken(context.env);
  if (!token) {
    return "anonymous";
  }
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

// Parse the embedded epoch (ms) from a "v1-<ms>" cursor. Returns null when the
// cursor is not a usable v1 cursor.
function cursorEpochMs(cursor: string): number | null {
  if (!cursor.startsWith("v1-")) {
    return null;
  }
  const raw = cursor.slice("v1-".length);
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isUsableCursor(cursor: unknown): cursor is string {
  return typeof cursor === "string" && cursorEpochMs(cursor) !== null;
}

function manifestPath(outputDir: string): string {
  return path.join(outputDir, MANIFEST_FILENAME);
}

// Guarded read + validation. Returns null (⇒ full resync) when the manifest is
// absent, unparseable, the wrong schema version, or does not match the current
// env/account.
function readSyncManifest(
  outputDir: string,
  env: Environment,
  account: string
): SyncManifest | null {
  const file = manifestPath(outputDir);
  if (!existsSync(file)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const data = parsed as Partial<SyncManifest> & { cursors?: unknown; pending?: unknown };

  if (data.schemaVersion !== MANIFEST_VERSION) {
    return null;
  }
  if (data.env !== env) {
    return null;
  }
  if (data.account !== account) {
    return null;
  }

  const cursors = normalizeCursors(data.cursors);
  const pending = normalizePending(data.pending);

  return {
    schemaVersion: MANIFEST_VERSION,
    env,
    account,
    cursors,
    pending,
    lastFullSyncAtMs:
      typeof data.lastFullSyncAtMs === "number" ? data.lastFullSyncAtMs : 0,
    lastSyncAtMs: typeof data.lastSyncAtMs === "number" ? data.lastSyncAtMs : 0,
  };
}

function normalizeCursors(value: unknown): SyncManifest["cursors"] {
  const cursors: SyncManifest["cursors"] = {};
  if (!value || typeof value !== "object") {
    return cursors;
  }
  const record = value as { daily?: unknown; conversations?: unknown };
  if (isUsableCursor(record.daily)) {
    cursors.daily = record.daily;
  }
  if (isUsableCursor(record.conversations)) {
    cursors.conversations = record.conversations;
  }
  return cursors;
}

function normalizePending(value: unknown): SyncManifest["pending"] {
  const pending: SyncManifest["pending"] = { daily: [], conversations: [] };
  if (!value || typeof value !== "object") {
    return pending;
  }
  const record = value as { daily?: unknown; conversations?: unknown };
  pending.daily = toIdArray(record.daily);
  pending.conversations = toIdArray(record.conversations);
  return pending;
}

function toIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

// Atomic write: serialize, write to a temp sibling, then rename over the target
// (atomic on the same filesystem). A torn temp degrades safely to a full
// resync on the next run.
async function writeSyncManifest(
  outputDir: string,
  manifest: SyncManifest
): Promise<void> {
  const file = manifestPath(outputDir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tmp, file);
}

// Normalize a cursor for persistence: subtract the overlap margin so the next
// run re-scans the trailing window.
function persistCursor(until: number): string {
  return `v1-${until - CHANGES_OVERLAP_MS}`;
}

// Normalize a user-supplied --since value (epoch ms or a v1-<ms> cursor) into a
// v1 cursor.
function normalizeSinceCursor(since: string): string | null {
  if (isUsableCursor(since)) {
    return since;
  }
  if (/^\d+$/.test(since)) {
    return `v1-${Number(since)}`;
  }
  return null;
}

async function fetchChanges(
  context: CommandContext,
  cursor?: string
): Promise<ChangesResult> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const data = await requestClientJson(context, `/v1/changes${query}`, {
    method: "GET",
  });
  return parseChangesResult(data);
}

// Ported from sources/commands/changed/index.ts:144-183.
function parseChangesResult(payload: unknown): ChangesResult {
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
    next_cursor: typeof data.next_cursor === "string" ? data.next_cursor : null,
  };
}

function isCursorRejection(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === "cursor_too_old" || error.message === "invalid_cursor";
}

function uniqueIds(...lists: readonly number[][]): number[] {
  const seen = new Set<number>();
  for (const list of lists) {
    for (const id of list) {
      seen.add(id);
    }
  }
  return [...seen];
}

// Result of syncing one changefeed-driven target: whether its cursor may be
// advanced this run and, if so, the value to advance to, plus the ids that
// should be retained as pending retries.
type TargetSyncOutcome = {
  advanced: boolean;
  nextCursor?: string;
  pending: number[];
  isFull: boolean;
};

async function syncAll(
  context: CommandContext,
  options: SyncOptions
): Promise<void> {
  const progress = new MultiProgress();
  await mkdir(options.outputDir, { recursive: true });

  const account = await accountFingerprint(context);
  const manifest = readSyncManifest(options.outputDir, context.env, account);

  // --recent-days only scopes a user-requested full sync (first run or --full).
  // It is ignored on incremental and fallback-triggered full crawls.
  const userFullFrom =
    options.recentDays !== undefined ? recentDaysFrom(options.recentDays) : undefined;

  // The seeded `until` for full-mode targets is captured from a no-cursor
  // changefeed call made BEFORE any crawl, shared across full-mode targets.
  let seedUntil: number | null = null;
  let seedError: Error | null = null;
  const ensureSeed = async (): Promise<number | null> => {
    if (seedUntil !== null || seedError !== null) {
      return seedUntil;
    }
    try {
      const seed = await fetchChanges(context);
      seedUntil = seed.until;
    } catch (error) {
      seedError = error instanceof Error ? error : new Error(String(error));
    }
    return seedUntil;
  };

  const syncPromises: Promise<void>[] = [];
  const outcomes: Partial<Record<ChangefeedTarget, TargetSyncOutcome>> = {};

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
    syncPromises.push(
      syncChangefeedTarget({
        context,
        options,
        manifest,
        target: "daily",
        task,
        userFullFrom,
        ensureSeed,
        full: (outputDir, t, from) => syncDaily(context, outputDir, t, from),
        incremental: (outputDir, t, ids) => syncDailyByIds(context, outputDir, t, ids),
      }).then((outcome) => {
        outcomes.daily = outcome;
      })
    );
  }

  if (options.targets.has("conversations")) {
    const task = progress.addTask("conversations");
    syncPromises.push(
      syncChangefeedTarget({
        context,
        options,
        manifest,
        target: "conversations",
        task,
        userFullFrom,
        ensureSeed,
        full: (outputDir, t, from) => syncConversations(context, outputDir, t, from),
        incremental: (outputDir, t, ids) =>
          syncConversationsByIds(context, outputDir, t, ids),
      }).then((outcome) => {
        outcomes.conversations = outcome;
      })
    );
  }

  const results = await Promise.allSettled(syncPromises);
  progress.finish();

  // Persist the manifest LAST, after every target's detail writes have resolved.
  // Cursors advance only for zero-failure targets; untouched targets are
  // preserved from the prior manifest.
  await persistManifest(options.outputDir, context.env, account, manifest, outcomes);

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    );

  if (errors.length > 0) {
    process.stderr.write(`\nSync completed with ${errors.length} error(s):\n`);
    for (const message of errors) {
      process.stderr.write(`  - ${message}\n`);
    }
    process.exitCode = 1;
  }
}

type ChangefeedTargetParams = {
  context: CommandContext;
  options: SyncOptions;
  manifest: SyncManifest | null;
  target: ChangefeedTarget;
  task: ProgressTask;
  userFullFrom: string | undefined;
  ensureSeed: () => Promise<number | null>;
  full: (
    outputDir: string,
    task: ProgressTask,
    from: string | undefined
  ) => Promise<number[]>;
  incremental: (
    outputDir: string,
    task: ProgressTask,
    ids: readonly number[]
  ) => Promise<number[]>;
};

// Drive one changefeed-backed target: decide FULL vs INCREMENTAL, run it, and
// compute whether/how its cursor may advance. Falls back to an UNBOUNDED full
// crawl on cursor rejection or proactive staleness.
async function syncChangefeedTarget(
  params: ChangefeedTargetParams
): Promise<TargetSyncOutcome> {
  const { context, options, manifest, target, task } = params;

  const overrideCursor = options.since
    ? normalizeSinceCursor(options.since)
    : undefined;
  const storedCursor = overrideCursor ?? manifest?.cursors[target];
  const pendingIds = manifest?.pending[target] ?? [];

  const cursorStale =
    storedCursor !== undefined &&
    (() => {
      const epoch = cursorEpochMs(storedCursor);
      return epoch === null || epoch < Date.now() - PROACTIVE_FULL_MS;
    })();

  const startFull =
    options.full || manifest === null || storedCursor === undefined || cursorStale;

  if (!startFull && storedCursor !== undefined) {
    // INCREMENTAL path.
    let changes: ChangesResult;
    try {
      changes = await fetchChanges(context, storedCursor);
    } catch (error) {
      if (isCursorRejection(error)) {
        process.stderr.write(
          `${target}: cursor rejected (${(error as Error).message}); falling back to full resync\n`
        );
        return runFullTarget(params, /* unbounded */ true, pendingIds);
      }
      throw error;
    }

    const changedIds = uniqueIds(
      target === "daily" ? changes.dailies : changes.conversations,
      pendingIds
    );
    const failed = await params.incremental(options.outputDir, task, changedIds);
    if (failed.length === 0) {
      return {
        advanced: true,
        nextCursor: persistCursor(changes.until),
        pending: [],
        isFull: false,
      };
    }
    return { advanced: false, pending: failed, isFull: false };
  }

  // FULL path. A user-requested full (first run, --full, or --since absent on a
  // fresh manifest) honors --recent-days; a fallback-triggered full is unbounded.
  return runFullTarget(params, /* unbounded */ false, pendingIds);
}

async function runFullTarget(
  params: ChangefeedTargetParams,
  unbounded: boolean,
  pendingIds: number[]
): Promise<TargetSyncOutcome> {
  const { options, task, ensureSeed } = params;
  const seeded = await ensureSeed();
  if (seeded === null) {
    throw new Error(
      "Failed to seed changefeed cursor; aborting target to avoid a stale manifest."
    );
  }
  const from = unbounded ? undefined : params.userFullFrom;
  const failed = await params.full(options.outputDir, task, from);
  if (failed.length === 0) {
    return {
      advanced: true,
      nextCursor: persistCursor(seeded),
      pending: [],
      isFull: true,
    };
  }
  // Preserve any prior pending ids in addition to this run's failures so they
  // are not dropped when the cursor cannot advance.
  return {
    advanced: false,
    pending: uniqueIds(failed, pendingIds),
    isFull: true,
  };
}

// Build and atomically write the next manifest, advancing only zero-failure
// targets and preserving the rest.
async function persistManifest(
  outputDir: string,
  env: Environment,
  account: string,
  prior: SyncManifest | null,
  outcomes: Partial<Record<ChangefeedTarget, TargetSyncOutcome>>
): Promise<void> {
  const cursors: SyncManifest["cursors"] = { ...(prior?.cursors ?? {}) };
  const pending: SyncManifest["pending"] = {
    daily: prior?.pending.daily ?? [],
    conversations: prior?.pending.conversations ?? [],
  };
  let lastFullSyncAtMs = prior?.lastFullSyncAtMs ?? 0;
  const now = Date.now();

  for (const target of ["daily", "conversations"] as const) {
    const outcome = outcomes[target];
    if (!outcome) {
      continue; // target not run this pass; preserve prior cursor/pending
    }
    if (outcome.advanced && outcome.nextCursor !== undefined) {
      cursors[target] = outcome.nextCursor;
      pending[target] = [];
      if (outcome.isFull) {
        lastFullSyncAtMs = now;
      }
    } else {
      pending[target] = outcome.pending;
    }
  }

  const manifest: SyncManifest = {
    schemaVersion: MANIFEST_VERSION,
    env,
    account,
    cursors,
    pending,
    lastFullSyncAtMs,
    lastSyncAtMs: now,
  };

  await writeSyncManifest(outputDir, manifest);
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

// Hydrate + write a single daily summary. Returns null on success, or a failure
// record on error. Shared by the list-mode (syncDaily) and id-mode
// (syncDailyByIds) paths so output is byte-identical.
async function writeDailyDetail(
  context: CommandContext,
  dailyDir: string,
  id: number
): Promise<{ id: number; error: string } | null> {
  try {
    const detail = await fetchDailySummary(context, id);
    const folderName = resolveDailyFolderName(detail);
    const dayDir = path.join(dailyDir, folderName);
    await mkdir(dayDir, { recursive: true });
    const markdown = formatDailySummaryMarkdown(detail);
    await writeFile(path.join(dayDir, "summary.md"), markdown, "utf8");
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, error: message };
  }
}

function reportDailyFailures(
  task: ProgressTask,
  failures: Array<{ id: number; error: string }>
): number[] {
  if (failures.length > 0) {
    task.setLabel(`daily done (${failures.length} failed)`);
    process.stderr.write(
      `Warning: ${failures.length} daily summary(s) failed to sync:\n`
    );
    for (const failure of failures.slice(0, 10)) {
      process.stderr.write(`  - daily ${failure.id}: ${failure.error}\n`);
    }
    if (failures.length > 10) {
      process.stderr.write(`  ... and ${failures.length - 10} more\n`);
    }
  } else {
    task.setLabel("daily done");
  }
  task.complete();
  return failures.map((failure) => failure.id);
}

// FULL list-mode daily sync. Returns the ids that failed to sync.
async function syncDaily(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask,
  from?: string
): Promise<number[]> {
  const dailySummaries = await fetchAllDailySummaries(context, task, from);
  const dailyDir = path.join(outputDir, "daily");
  await mkdir(dailyDir, { recursive: true });

  const sortedDaily = [...dailySummaries].sort(
    (a, b) => dailySortKey(a) - dailySortKey(b)
  );
  task.setTotal(sortedDaily.length);

  const failures: Array<{ id: number; error: string }> = [];
  await runWithConcurrency(sortedDaily, SYNC_CONCURRENCY, async (summary) => {
    const failure = await writeDailyDetail(context, dailyDir, summary.id);
    if (failure) {
      failures.push(failure);
    }
    task.advance(1);
  });

  return reportDailyFailures(task, failures);
}

// INCREMENTAL id-mode daily sync. Hydrates only the supplied ids. Returns the
// ids that failed to sync.
async function syncDailyByIds(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask,
  ids: readonly number[]
): Promise<number[]> {
  const dailyDir = path.join(outputDir, "daily");
  await mkdir(dailyDir, { recursive: true });
  task.setTotal(ids.length);

  const failures: Array<{ id: number; error: string }> = [];
  await runWithConcurrency(ids, SYNC_CONCURRENCY, async (id) => {
    const failure = await writeDailyDetail(context, dailyDir, id);
    if (failure) {
      failures.push(failure);
    }
    task.advance(1);
  });

  return reportDailyFailures(task, failures);
}

// Write a single conversation detail. Returns null on success or a failure
// record on error.
async function writeConversationDetail(
  conversationsDir: string,
  detail: ConversationDetail
): Promise<{ id: number; error: string } | null> {
  try {
    const dateFolder = resolveConversationFolderName(detail);
    const dayDir = path.join(conversationsDir, dateFolder);
    await mkdir(dayDir, { recursive: true });
    const markdown = formatConversationMarkdown(detail);
    await writeFile(path.join(dayDir, `${detail.id}.md`), markdown, "utf8");
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: detail.id, error: message };
  }
}

// Hydrate + write one chunk of conversation ids. Uses the batch endpoint with a
// per-id GET fallback, both for whole-batch failures and for ids omitted from
// the batch response (e.g. replication lag). Returns failures, advancing the
// task once per id. Shared by list-mode and id-mode.
async function writeConversationChunk(
  context: CommandContext,
  conversationsDir: string,
  ids: readonly number[],
  task: ProgressTask
): Promise<Array<{ id: number; error: string }>> {
  const failures: Array<{ id: number; error: string }> = [];

  let details: ConversationDetail[] | null = null;
  try {
    details = await fetchConversationsBatch(context, [...ids]);
  } catch {
    details = null;
  }

  if (details) {
    const detailById = new Map(details.map((detail) => [detail.id, detail]));
    for (const id of ids) {
      const detail = detailById.get(id);
      if (detail) {
        const failure = await writeConversationDetail(conversationsDir, detail);
        if (failure) {
          failures.push(failure);
        }
      } else {
        // Omitted from the batch response: retry via per-id GET. Counts as a
        // failure (blocking cursor advance) if the GET also fails.
        const failure = await writeConversationById(context, conversationsDir, id);
        if (failure) {
          failures.push(failure);
        }
      }
      task.advance(1);
    }
  } else {
    await runWithConcurrency([...ids], SYNC_CONCURRENCY, async (id) => {
      const failure = await writeConversationById(context, conversationsDir, id);
      if (failure) {
        failures.push(failure);
      }
      task.advance(1);
    });
  }

  return failures;
}

async function writeConversationById(
  context: CommandContext,
  conversationsDir: string,
  id: number
): Promise<{ id: number; error: string } | null> {
  try {
    const detail = await fetchConversation(context, id);
    return await writeConversationDetail(conversationsDir, detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, error: message };
  }
}

function reportConversationFailures(
  task: ProgressTask,
  failures: Array<{ id: number; error: string }>
): number[] {
  if (failures.length > 0) {
    task.setLabel(`conversations done (${failures.length} failed)`);
    process.stderr.write(
      `Warning: ${failures.length} conversation(s) failed to sync:\n`
    );
    for (const failure of failures.slice(0, 10)) {
      process.stderr.write(`  - conversation ${failure.id}: ${failure.error}\n`);
    }
    if (failures.length > 10) {
      process.stderr.write(`  ... and ${failures.length - 10} more\n`);
    }
  } else {
    task.setLabel("conversations done");
  }
  task.complete();
  return failures.map((failure) => failure.id);
}

// FULL list-mode conversation sync. Returns the ids that failed to sync.
async function syncConversations(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask,
  from?: string
): Promise<number[]> {
  const conversations = await fetchAllConversations(context, task, from);
  const conversationsDir = path.join(outputDir, "conversations");
  await mkdir(conversationsDir, { recursive: true });

  const sortedConversations = [...conversations].sort(
    (a, b) => conversationSortKey(a) - conversationSortKey(b)
  );
  task.setTotal(sortedConversations.length);

  const failures: Array<{ id: number; error: string }> = [];
  const chunks = chunkArray(
    sortedConversations.map((conversation) => conversation.id),
    BATCH_DETAIL_SIZE
  );

  for (const chunk of chunks) {
    failures.push(
      ...(await writeConversationChunk(context, conversationsDir, chunk, task))
    );
  }

  return reportConversationFailures(task, failures);
}

// INCREMENTAL id-mode conversation sync. Hydrates only the supplied ids.
// Returns the ids that failed to sync.
async function syncConversationsByIds(
  context: CommandContext,
  outputDir: string,
  task: ProgressTask,
  ids: readonly number[]
): Promise<number[]> {
  const conversationsDir = path.join(outputDir, "conversations");
  await mkdir(conversationsDir, { recursive: true });
  task.setTotal(ids.length);

  const failures: Array<{ id: number; error: string }> = [];
  const chunks = chunkArray([...ids], BATCH_DETAIL_SIZE);
  for (const chunk of chunks) {
    failures.push(
      ...(await writeConversationChunk(context, conversationsDir, chunk, task))
    );
  }

  return reportConversationFailures(task, failures);
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
  task: ProgressTask,
  from?: string
): Promise<DailySummary[]> {
  const items: DailySummary[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (from) {
      params.set("from", from);
    }
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
  task: ProgressTask,
  from?: string
): Promise<ConversationSummary[]> {
  const items: ConversationSummary[] = [];
  let cursor: string | undefined;
  task.addTotal(1);

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (from) {
      params.set("from", from);
    }
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

async function fetchConversationsBatch(
  context: CommandContext,
  ids: number[]
): Promise<ConversationDetail[]> {
  const data = await requestClientJson(context, "/v1/conversations/batch", {
    method: "POST",
    json: { ids },
  });
  return parseConversationBatchResponse(data);
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

function parseConversationBatchResponse(payload: unknown): ConversationDetail[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid batch response.");
  }
  const data = payload as { conversations?: ConversationDetail[] };
  if (!Array.isArray(data.conversations)) {
    throw new Error("Invalid batch response.");
  }
  return data.conversations;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size) as T[]);
  }
  return chunks;
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
