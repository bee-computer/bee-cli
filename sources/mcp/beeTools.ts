import type { CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";
import { loadToken } from "@/secureStore";
import type { JsonObject, JsonValue, ToolResult } from "@/mcp/types";

type BeeToolArgs = {
  [key: string]: unknown;
  alarmAt?: unknown;
  completed?: unknown;
  confirmed?: unknown;
  dailyId?: unknown;
  date?: unknown;
  endDate?: unknown;
  id?: unknown;
  includeImages?: unknown;
  includeTranscript?: unknown;
  includeUnconfirmed?: unknown;
  includeVisits?: unknown;
  limit?: unknown;
  query?: unknown;
  startDate?: unknown;
  text?: unknown;
};

type DataRecord = {
  [key: string]: unknown;
  completed?: unknown;
  conversation?: unknown;
  created_at?: unknown;
  daily_summary?: unknown;
  date?: unknown;
  date_time?: unknown;
  generated_at?: unknown;
  id?: unknown;
  photos?: unknown;
  remote_url_id?: unknown;
  search_mode?: unknown;
  short_summary?: unknown;
  start_time?: unknown;
  summary?: unknown;
  text?: unknown;
  timezone?: unknown;
  transcriptions?: unknown;
  transcriptions_count?: unknown;
  utterances_count?: unknown;
};

export async function callBeeTool(
  context: CommandContext,
  name: string,
  args: BeeToolArgs
): Promise<ToolResult> {
  switch (name) {
    case "bee_status":
      return textResult(await status(context));
    case "bee_search":
      return textResult(await search(context, stringArg(args.query, "query"), numberArg(args.limit, 10, 1, 20)));
    case "bee_list_facts":
      return textResult(await listFacts(context, numberArg(args.limit, 20, 1, 50), args.includeUnconfirmed === true));
    case "bee_search_facts":
      return textResult(await searchFacts(
        context,
        stringArg(args.query, "query"),
        numberArg(args.limit, 10, 1, 20),
        args.includeUnconfirmed === true
      ));
    case "bee_get_fact":
      return textResult(await apiGet(context, `/v1/facts/${numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)}`));
    case "bee_create_fact":
      return textResult(await apiPost(context, "/v1/facts", { text: stringArg(args.text, "text") }));
    case "bee_update_fact":
      return textResult(await updateFact(context, args));
    case "bee_delete_fact":
      return textResult(await apiDelete(context, `/v1/facts/${numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)}`));
    case "bee_get_recent_activity":
      return textResult(await recentActivity(context, numberArg(args.limit, 10, 1, 20)));
    case "bee_get_today":
      return textResult(await today(context));
    case "bee_get_conversation":
      return textResult(await getConversation(
        context,
        numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER),
        args.includeTranscript === true
      ));
    case "bee_get_conversation_transcript":
      return textResult(await getConversationTranscript(context, numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)));
    case "bee_get_related_conversations":
      return textResult(await relatedConversations(
        context,
        numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER),
        numberArg(args.limit, 5, 1, 10)
      ));
    case "bee_get_daily_summary":
      return textResult(await getDailySummary(context, args));
    case "bee_list_daily_summaries":
      return textResult(await listDailySummaries(
        context,
        optionalString(args.startDate),
        optionalString(args.endDate),
        numberArg(args.limit, 10, 1, 30)
      ));
    case "bee_search_voice_notes":
      return textResult(await searchVoiceNotes(
        context,
        stringArg(args.query, "query"),
        numberArg(args.limit, 10, 1, 20)
      ));
    case "bee_get_voice_note":
      return textResult(await apiGet(context, `/v1/journals/${encodeURIComponent(stringArg(args.id, "id"))}`));
    case "bee_list_todos":
      return textResult(await listTodos(context, numberArg(args.limit, 20, 1, 50)));
    case "bee_create_todo":
      return textResult(await createTodo(context, args));
    case "bee_update_todo":
      return textResult(await updateTodo(context, args));
    case "bee_complete_todo":
      return textResult(await apiPut(context, `/v1/todos/${numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)}`, { completed: true }));
    case "bee_delete_todo":
      return textResult(await apiDelete(context, `/v1/todos/${numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)}`));
    case "bee_get_todo_suggestions":
      return textResult(jsonString({
        todoSuggestions: [],
        note: "Todo suggestions are not exposed by this Bee CLI API yet.",
        requestedLimit: numberArg(args.limit, 10, 1, 20),
      }));
    case "bee_get_insights":
      return textResult(await getInsights(context, numberArg(args.limit, 10, 1, 50)));
    case "bee_get_insight":
      return textResult(await getInsight(context, numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER)));
    case "bee_get_recent_locations":
      return textResult(await recentLocations(context, numberArg(args.limit, 10, 1, 20), args.includeVisits === true));
    case "bee_get_current_location":
      return textResult(await apiGet(context, "/v1/locations/current"));
    case "bee_get_photos":
      return await getPhotos(context, args, numberArg(args.limit, 10, 1, 20), args.includeImages === true);
    case "bee_get_photo":
      return await getPhoto(context, stringOrNumberArg(args.id, "id"));
    default:
      return {
        content: [{ type: "text", text: `Unknown Bee tool: ${name}` }],
        isError: true,
      };
  }
}

async function status(context: CommandContext): Promise<string> {
  const token = context.client.isProxy ? null : await loadTokenForStatus(context);
  return jsonString({
    connected: context.client.isProxy || !!token,
    mode: "stdio-mcp",
    access: "read-write",
    environment: context.env,
  });
}

async function loadTokenForStatus(context: CommandContext): Promise<string | null> {
  try {
    return await loadToken(context.env);
  } catch {
    return null;
  }
}

async function search(context: CommandContext, query: string, limit: number): Promise<string> {
  const searchData = await apiPost(context, "/v1/search/conversations", { query, limit });
  const [factsData, todosData, journalsData, insightsData] = await Promise.all([
    optionalApiJson(context, "/v1/facts?limit=50"),
    optionalApiJson(context, "/v1/todos?limit=50"),
    optionalApiJson(context, "/v1/journals?limit=50"),
    optionalApiJson(context, "/v1/insights?limit=50"),
  ]);
  const queryLower = query.toLowerCase();
  const results: JsonValue[] = [
    ...arrayProp(parseJson(searchData), "results"),
    ...arrayProp(factsData, "facts")
      .filter((item) => matchesQuery(item, queryLower))
      .map((item) => ({ source: "fact", ...asRecord(item) })),
    ...arrayProp(todosData, "todos")
      .filter((item) => matchesQuery(item, queryLower))
      .map((item) => ({ source: "todo", ...asRecord(item) })),
    ...arrayProp(journalsData, "journals")
      .filter((item) => matchesQuery(item, queryLower))
      .map((item) => ({ source: "voice_note", ...asRecord(item) })),
    ...arrayProp(insightsData, "insights")
      .filter((item) => matchesQuery(item, queryLower))
      .map((item) => ({ source: "insight", ...asRecord(item) })),
  ].slice(0, limit) as JsonValue[];

  return jsonString({ query, results, total: results.length });
}

async function listFacts(
  context: CommandContext,
  limit: number,
  includeUnconfirmed: boolean
): Promise<string> {
  const suffix = includeUnconfirmed
    ? `limit=${limit}`
    : `limit=${limit}&confirmed=true`;
  return await apiGet(context, `/v1/facts?${suffix}`);
}

async function searchFacts(
  context: CommandContext,
  query: string,
  limit: number,
  includeUnconfirmed: boolean
): Promise<string> {
  const data = parseJson(await listFacts(context, 100, includeUnconfirmed));
  const facts = arrayProp(data, "facts")
    .filter((item) => matchesQuery(item, query.toLowerCase()))
    .slice(0, limit);
  return jsonString({ query, facts });
}

async function updateFact(context: CommandContext, args: BeeToolArgs): Promise<string> {
  const id = numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const existing = asRecord(parseJson(await apiGet(context, `/v1/facts/${id}`)));
  const text = hasOwn(args, "text") ? stringArg(args.text, "text") : stringValue(existing.text);
  const body: JsonObject = { text };
  if (hasOwn(args, "confirmed")) {
    if (typeof args.confirmed !== "boolean") {
      throw new Error("confirmed must be a boolean.");
    }
    body["confirmed"] = args.confirmed;
  }
  return await apiPut(context, `/v1/facts/${id}`, body);
}

async function recentActivity(context: CommandContext, limit: number): Promise<string> {
  const [conversations, daily, journals, todos] = await Promise.all([
    apiGet(context, `/v1/conversations?limit=${limit}`),
    apiGet(context, `/v1/daily?limit=${limit}`),
    apiGet(context, `/v1/journals?limit=${limit}`),
    apiGet(context, `/v1/todos?limit=${limit}`),
  ]);
  const insights = await optionalApiJson(context, `/v1/insights?limit=${limit}`);
  const activity = [
    ...arrayProp(parseJson(conversations), "conversations").map((item) => ({ type: "conversation", at: asRecord(item).start_time, ...asRecord(item) })),
    ...arrayProp(parseJson(daily), "daily_summaries").map((item) => ({ type: "daily_summary", at: asRecord(item).date_time ?? asRecord(item).created_at, ...asRecord(item) })),
    ...arrayProp(parseJson(journals), "journals").map((item) => ({ type: "voice_note", at: asRecord(item).created_at, ...asRecord(item) })),
    ...arrayProp(parseJson(todos), "todos").map((item) => ({ type: "todo", at: asRecord(item).created_at, ...asRecord(item) })),
    ...arrayProp(insights, "insights").map((item) => ({ type: "insight", at: asRecord(item).generated_at, ...asRecord(item) })),
  ].sort((left, right) => timeValue(right.at) - timeValue(left.at)).slice(0, limit);
  return jsonString({ activity });
}

async function today(context: CommandContext): Promise<string> {
  const day = localDateKey(new Date());
  const [brief, conversations, daily, journals, todos] = await Promise.all([
    apiGet(context, "/v1/todayBrief"),
    apiGet(context, "/v1/conversations?limit=30"),
    apiGet(context, "/v1/daily?limit=30"),
    apiGet(context, "/v1/journals?limit=30"),
    apiGet(context, "/v1/todos?limit=50"),
  ]);
  return jsonString({
    date: day,
    todayBrief: parseJson(brief),
    dailySummary: arrayProp(parseJson(daily), "daily_summaries").find((item) => itemDay(item) === day) ?? null,
    activeTodos: arrayProp(parseJson(todos), "todos").filter((item) => asRecord(item).completed !== true).slice(0, 10),
    recentNotes: arrayProp(parseJson(journals), "journals").filter((item) => itemDay(item) === day).slice(0, 5),
    recentConversations: arrayProp(parseJson(conversations), "conversations").filter((item) => itemDay(item) === day).slice(0, 5),
  });
}

async function getConversation(
  context: CommandContext,
  id: number,
  includeTranscript: boolean
): Promise<string> {
  const data = parseJson(await apiGet(context, `/v1/conversations/${id}`));
  if (!includeTranscript) {
    const record = asRecord(data);
    const conversation = asRecord(record.conversation);
    const transcriptions = arrayProp(conversation, "transcriptions");
    delete conversation.transcriptions;
    conversation.transcriptions_count = transcriptions.length;
    conversation.utterances_count = transcriptions.reduce<number>((total, item) => {
      return total + arrayProp(asRecord(item), "utterances").length;
    }, 0);
  }
  return jsonString(data);
}

async function getConversationTranscript(context: CommandContext, id: number): Promise<string> {
  const data = asRecord(parseJson(await apiGet(context, `/v1/conversations/${id}`)));
  const conversation = asRecord(data.conversation);
  const transcript = arrayProp(conversation, "transcriptions").flatMap((transcription) => {
    return arrayProp(asRecord(transcription), "utterances");
  });
  return jsonString({
    conversationId: id,
    transcript,
    note: "Transcript text is ASR output and may contain recognition errors. Avoid direct quotes unless surrounding Bee context gives high confidence.",
  });
}

async function relatedConversations(context: CommandContext, id: number, limit: number): Promise<string> {
  const data = asRecord(parseJson(await apiGet(context, `/v1/conversations/${id}`)));
  const conversation = asRecord(data.conversation);
  const summary = [conversation.short_summary, conversation.summary].filter((value) => typeof value === "string").join("\n");
  const query = summary.trim() || `conversation ${id}`;
  const raw = asRecord(parseJson(await apiPost(context, "/v1/search/conversations", { query, limit: limit + 1 })));
  const results = arrayProp(raw, "results")
    .filter((item) => String(asRecord(item).id) !== String(id))
    .slice(0, limit);
  return jsonString({ conversationId: id, conversations: results, search_mode: raw.search_mode ?? "bm25" });
}

async function getDailySummary(context: CommandContext, args: BeeToolArgs): Promise<string> {
  const id = optionalNumber(args.id);
  if (id !== null) {
    return await apiGet(context, `/v1/daily/${id}`);
  }
  const date = optionalString(args.date);
  if (!date) {
    throw new Error("Provide id or date.");
  }
  const data = parseJson(await apiGet(context, "/v1/daily?limit=100"));
  const match = arrayProp(data, "daily_summaries").find((item) => itemDay(item) === date);
  if (!match) {
    return jsonString({ date, dailySummary: null });
  }
  const matchId = optionalNumber(asRecord(match).id);
  return matchId === null
    ? jsonString({ date, dailySummary: match })
    : await apiGet(context, `/v1/daily/${matchId}`);
}

async function listDailySummaries(
  context: CommandContext,
  startDate: string | null,
  endDate: string | null,
  limit: number
): Promise<string> {
  const data = parseJson(await apiGet(context, `/v1/daily?limit=${Math.max(limit, 30)}`));
  const summaries = arrayProp(data, "daily_summaries")
    .filter((item) => {
      const key = itemDay(item);
      return (!startDate || (key !== null && key >= startDate)) &&
        (!endDate || (key !== null && key <= endDate));
    })
    .slice(0, limit);
  return jsonString({ daily_summaries: summaries, timezone: asRecord(data).timezone ?? null });
}

async function searchVoiceNotes(context: CommandContext, query: string, limit: number): Promise<string> {
  const data = parseJson(await apiGet(context, "/v1/journals?limit=100"));
  const notes = arrayProp(data, "journals")
    .filter((item) => matchesQuery(item, query.toLowerCase()))
    .slice(0, limit);
  return jsonString({ query, voiceNotes: notes, search_mode: "local-filter" });
}

async function listTodos(context: CommandContext, limit: number): Promise<string> {
  const data = parseJson(await apiGet(context, `/v1/todos?limit=${limit}`));
  const todos = arrayProp(data, "todos").filter((item) => asRecord(item).completed !== true);
  return jsonString({ todos, timezone: asRecord(data).timezone ?? null });
}

async function createTodo(context: CommandContext, args: BeeToolArgs): Promise<string> {
  const body: JsonObject = { text: stringArg(args.text, "text") };
  const alarmAt = optionalString(args.alarmAt);
  if (alarmAt) {
    body["alarm_at"] = alarmAt;
  }
  return await apiPost(context, "/v1/todos", body);
}

async function updateTodo(context: CommandContext, args: BeeToolArgs): Promise<string> {
  const id = numberArg(args.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const body: JsonObject = {};
  if (hasOwn(args, "text")) {
    body["text"] = stringArg(args.text, "text");
  }
  if (hasOwn(args, "completed")) {
    if (typeof args.completed !== "boolean") {
      throw new Error("completed must be a boolean.");
    }
    body["completed"] = args.completed;
  }
  if (hasOwn(args, "alarmAt")) {
    if (args.alarmAt !== null && typeof args.alarmAt !== "string") {
      throw new Error("alarmAt must be a string or null.");
    }
    body["alarm_at"] = args.alarmAt as string | null;
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Provide text, completed, or alarmAt to update.");
  }
  return await apiPut(context, `/v1/todos/${id}`, body);
}

async function getInsights(context: CommandContext, limit: number): Promise<string> {
  return await apiGet(context, `/v1/insights?limit=${limit}`);
}

async function getInsight(context: CommandContext, id: number): Promise<string> {
  const data = parseJson(await apiGet(context, "/v1/insights?limit=100"));
  const insight = arrayProp(data, "insights").find((item) => String(asRecord(item).id) === String(id)) ?? null;
  return jsonString({ insight, timezone: asRecord(data).timezone ?? null });
}

async function recentLocations(
  context: CommandContext,
  limit: number,
  includeVisits: boolean
): Promise<string> {
  const params = new URLSearchParams({
    limit: String(limit),
    include_visits: includeVisits ? "true" : "false",
  });
  return await apiGet(context, `/v1/locations/clusters?${params.toString()}`);
}

async function getPhotos(
  context: CommandContext,
  args: BeeToolArgs,
  limit: number,
  includeImages: boolean
): Promise<ToolResult> {
  const dailyId = optionalNumber(args.dailyId);
  const date = optionalString(args.date);
  const summaries = dailyId !== null
    ? [asRecord(parseJson(await apiGet(context, `/v1/daily/${dailyId}`))).daily_summary]
    : arrayProp(parseJson(await apiGet(context, `/v1/daily?limit=${Math.max(limit, 30)}`)), "daily_summaries");

  const photos = summaries
    .map((item) => asRecord(item))
    .filter((summary) => !date || itemDay(summary) === date)
    .flatMap((summary) => arrayProp(summary, "photos").map((photo) => ({
      ...asRecord(photo),
      daily_summary_id: summary.id ?? null,
      date: itemDay(summary),
    })))
    .slice(0, limit);

  if (!includeImages) {
    return textResult(jsonString({ photos }));
  }

  const content: ToolResult["content"] = [{
    type: "text",
    text: jsonString({
      photos,
      note: "Images are included only for numeric photo IDs accepted by the Bee developer API.",
    }),
  }];
  for (const photo of photos) {
    const id = asRecord(photo).id ?? asRecord(photo).remote_url_id;
    if (id === undefined || id === null || !/^\d+$/.test(String(id))) {
      continue;
    }
    try {
      const image = await fetchPhoto(context, String(id));
      content.push({ type: "image", data: image.data, mimeType: image.mimeType });
    } catch {
      // Keep returning metadata even if one image cannot be fetched.
    }
  }
  return { content };
}

async function getPhoto(context: CommandContext, id: string | number): Promise<ToolResult> {
  const image = await fetchPhoto(context, String(id));
  return {
    content: [
      { type: "text", text: jsonString({ id }) },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ],
  };
}

async function fetchPhoto(
  context: CommandContext,
  id: string
): Promise<{ data: string; mimeType: string }> {
  const token = context.client.isProxy ? null : await loadToken(context.env);
  if (!context.client.isProxy && !token) {
    throw new Error('Not logged in. Run "bee login" first.');
  }
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await context.client.fetch(`/v1/photos/${encodeURIComponent(id)}`, { headers });
  if (!response.ok) {
    throw new Error(`Photo request failed with status ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    data: bytes.toString("base64"),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function apiGet(context: CommandContext, path: string): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "GET" }));
}

async function apiPost(context: CommandContext, path: string, body: JsonObject): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "POST", json: body }));
}

async function apiPut(context: CommandContext, path: string, body: JsonObject): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "PUT", json: body }));
}

async function apiDelete(context: CommandContext, path: string): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "DELETE" }));
}

async function optionalApiJson(context: CommandContext, path: string): Promise<unknown> {
  try {
    return parseJson(await apiGet(context, path));
  } catch {
    return {};
  }
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): DataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DataRecord
    : {};
}

function arrayProp(value: unknown, key: string): unknown[] {
  const record = asRecord(value);
  const raw = record[key];
  return Array.isArray(raw) ? raw : [];
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

function stringOrNumberArg(value: unknown, name: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Missing ${name}.`);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected string value.");
  }
  return value;
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = optionalNumber(value);
  const result = parsed ?? fallback;
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new Error(`Expected number between ${min} and ${max}.`);
  }
  return Math.floor(result);
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasOwn(record: BeeToolArgs, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function matchesQuery(value: unknown, query: string): boolean {
  return JSON.stringify(value ?? "").toLowerCase().includes(query);
}

function timeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value) ?? 0;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeEpochMs(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value > 1e12) {
    return value;
  }
  if (value > 1e9) {
    return value * 1000;
  }
  return null;
}

function itemDay(value: unknown): string | null {
  const record = asRecord(value);
  const raw = record.date_time ?? record.created_at ?? record.start_time ?? record.generated_at;
  if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
    return record.date.slice(0, 10);
  }
  const time = timeValue(raw);
  return time > 0 ? localDateKey(new Date(time)) : null;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
