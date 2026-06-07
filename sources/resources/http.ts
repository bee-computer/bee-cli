// HTTP helpers for resource actions. Leaf module: imports no resource or registry.
import type { CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";
import { loadToken } from "@/secureStore";
import type { JsonObject } from "@/mcp/types";
import { arrayProp, asRecord, jsonString, parseJson } from "@/resources/json";

// Upper bound on pages followed when scanning a cursor-paginated list for a
// match. Bounds the request fan-out while covering far more history than a
// single page; each page is up to `pageSize` items.
const MAX_PAGES = 20;

// Follows next_cursor through a cursor-paginated list endpoint, accumulating the
// items under `key`, until `enough(items)` is satisfied, the cursor is
// exhausted, or MAX_PAGES is reached. Returns the accumulated items plus the
// timezone from the first page. `buildPath(cursor)` must produce the request
// path for a given cursor (undefined for the first page).
export async function fetchAllPages(
  context: CommandContext,
  key: string,
  buildPath: (cursor: string | undefined) => string,
  enough: (items: unknown[]) => boolean = () => false
): Promise<{ items: unknown[]; timezone: unknown }> {
  const items: unknown[] = [];
  let cursor: string | undefined;
  let timezone: unknown = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = asRecord(parseJson(await apiGet(context, buildPath(cursor))));
    if (page === 0) {
      timezone = data["timezone"] ?? null;
    }
    items.push(...arrayProp(data, key));
    if (enough(items)) {
      break;
    }
    const next = data["next_cursor"];
    if (typeof next !== "string" || next.length === 0) {
      break;
    }
    cursor = next;
  }
  return { items, timezone };
}

export async function apiGet(context: CommandContext, path: string): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "GET" }));
}

export async function apiPost(context: CommandContext, path: string, body: JsonObject): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "POST", json: body }));
}

export async function apiPut(context: CommandContext, path: string, body: JsonObject): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "PUT", json: body }));
}

export async function apiDelete(context: CommandContext, path: string): Promise<string> {
  return jsonString(await requestClientJson(context, path, { method: "DELETE" }));
}

export async function optionalApiJson(context: CommandContext, path: string): Promise<unknown> {
  try {
    return parseJson(await apiGet(context, path));
  } catch (error) {
    process.stderr.write(`Bee MCP error: ${path}: ${error instanceof Error ? error.message : "unexpected error"}\n`);
    return {};
  }
}

export async function fetchPhoto(
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
