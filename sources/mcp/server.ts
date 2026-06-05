import type { CommandContext } from "@/commands/types";
import { VERSION } from "@/version";
import { callBeeTool } from "@/mcp/beeTools";
import { BEE_MCP_TOOLS, MCP_SERVER_SCHEMA_VERSION } from "@/mcp/toolDefinitions";
import type { JsonRpcRequest, JsonRpcResponse, JsonValue, ToolResult } from "@/mcp/types";
import { createInterface } from "node:readline";

export const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;

export async function serveMcp(context: CommandContext): Promise<void> {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  let pending = Promise.resolve();
  for await (const line of lines) {
    pending = pending
      .then(() => handleLine(line, context))
      .catch((error: unknown) => {
        process.stderr.write(`Bee MCP error: ${messageForError(error)}\n`);
      });
  }
  await pending;
}

async function handleLine(line: string, context: CommandContext): Promise<void> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (Buffer.byteLength(trimmed, "utf8") > MAX_MCP_MESSAGE_BYTES) {
    process.stderr.write("Bee MCP ignored an oversized message.\n");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    process.stderr.write("Bee MCP received invalid JSON.\n");
    return;
  }

  const response = await handleMcpJsonRpc(parsed, context);
  if (response !== null) {
    writeResponse(response as unknown as JsonValue);
  }
}

export async function handleMcpJsonRpc(
  parsed: unknown,
  context: CommandContext
): Promise<JsonValue | null> {
  if (Array.isArray(parsed)) {
    const responses = await Promise.all(
      parsed.map((request) => handleRpc(asRequest(request), context))
    );
    const filtered = responses.filter((response): response is JsonRpcResponse => response !== null);
    return filtered.length > 0 ? filtered as unknown as JsonValue : null;
  }

  return await handleRpc(asRequest(parsed), context) as unknown as JsonValue | null;
}

function asRequest(value: unknown): JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRpcRequest;
}

async function handleRpc(
  request: JsonRpcRequest,
  context: CommandContext
): Promise<JsonRpcResponse | null> {
  const id = request.id;
  const method = typeof request.method === "string" ? request.method : "";

  if (id === undefined) {
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return result(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "Bee",
            version: `${VERSION}-${MCP_SERVER_SCHEMA_VERSION}`,
          },
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, { tools: BEE_MCP_TOOLS });
      case "tools/call":
        return result(id, await handleToolCall(request.params, context));
      case "resources/list":
        return result(id, { resources: [] });
      case "prompts/list":
        return result(id, { prompts: [] });
      default:
        return rpcError(id, -32601, `Unknown method: ${method || "missing"}`);
    }
  } catch (error) {
    return rpcError(id, -32000, messageForError(error));
  }
}

async function handleToolCall(params: unknown, context: CommandContext): Promise<ToolResult> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Missing tool call parameters.");
  }
  const record = params as { name?: unknown; arguments?: unknown };
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new Error("Missing tool name.");
  }
  const args = record.arguments && typeof record.arguments === "object" && !Array.isArray(record.arguments)
    ? record.arguments as Record<string, unknown>
    : {};
  return await callBeeTool(context, record.name, args);
}

function result(id: string | number | null, value: JsonValue): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: value,
  };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function writeResponse(value: JsonValue): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
