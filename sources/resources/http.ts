// HTTP helpers for resource actions. Leaf module: imports no resource or registry.
import type { CommandContext } from "@/commands/types";
import { requestClientJson } from "@/client/clientApi";
import { loadToken } from "@/secureStore";
import type { JsonObject } from "@/mcp/types";
import { jsonString, parseJson } from "@/resources/json";

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
