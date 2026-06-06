import type { CommandContext } from "@/commands/types";
import { VERSION } from "@/version";
import { callBeeTool } from "@/mcp/beeTools";
import { BEE_MCP_TOOLS } from "@/mcp/toolDefinitions";
import type { JsonRpcRequest, JsonRpcResponse, JsonValue, ToolResult } from "@/mcp/types";
import { createInterface } from "node:readline";

export const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;
export const MAX_BATCH_SIZE = 50;

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
    if (parsed.length > MAX_BATCH_SIZE) {
      return rpcError(
        null,
        -32600,
        `Batch too large: max ${MAX_BATCH_SIZE} requests.`
      ) as unknown as JsonValue;
    }
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
            version: VERSION,
          },
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, { tools: BEE_MCP_TOOLS });
      case "tools/call":
        try {
          return result(id, await handleToolCall(request.params, context));
        } catch (error) {
          return result(id, {
            content: [{ type: "text", text: messageForError(error) }],
            isError: true,
          });
        }
      case "resources/list":
        return result(id, { resources: [] });
      case "prompts/list":
        return result(id, { prompts: [] });
      default:
        return rpcError(
          id,
          -32601,
          method
            ? `Unknown method: ${method}`
            : "Missing 'method' field in JSON-RPC request."
        );
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
  const tool = BEE_MCP_TOOLS.find((candidate) => candidate.name === record.name);
  if (tool) {
    validateArguments(record.name, args, tool.inputSchema);
  }
  return await callBeeTool(context, record.name, args);
}

function validateArguments(
  toolName: string,
  args: Record<string, unknown>,
  schema: JsonValue
): void {
  const detail = validateValue(args, schema, "");
  if (detail !== null) {
    throw new Error(`Invalid arguments for ${toolName}: ${detail}`);
  }
}

const emptyProperties: { [key: string]: JsonValue } = {};

function asSchemaObject(schema: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? schema as { [key: string]: JsonValue }
    : null;
}

function schemaLabel(path: string): string {
  return path.length > 0 ? `'${path}'` : "value";
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      // Numeric strings are accepted for number-typed fields (see optionalNumber leniency).
      return (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)));
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateValue(value: unknown, schema: JsonValue | undefined, path: string): string | null {
  const schemaObject = asSchemaObject(schema);
  if (!schemaObject) {
    return null;
  }

  const rawType = schemaObject["type"];
  const types = typeof rawType === "string"
    ? [rawType]
    : Array.isArray(rawType)
      ? rawType.filter((entry): entry is string => typeof entry === "string")
      : [];

  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return `${schemaLabel(path)} must be of type ${types.join(" or ")}.`;
  }

  if (types.includes("object") && matchesType(value, "object")) {
    const objectError = validateObject(value as Record<string, unknown>, schemaObject, path);
    if (objectError !== null) {
      return objectError;
    }
  }

  if (typeof value === "string") {
    const stringError = validateString(value, schemaObject, path);
    if (stringError !== null) {
      return stringError;
    }
  }

  // Numeric minimum/maximum are intentionally NOT enforced here: bee tool
  // handlers clamp numbers via numberArg, so bounds must not reject input.

  return null;
}

function validateObject(
  value: Record<string, unknown>,
  schema: { [key: string]: JsonValue },
  path: string
): string | null {
  const properties = asSchemaObject(schema["properties"]) ?? emptyProperties;
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((entry): entry is string => typeof entry === "string")
    : [];

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      return `${schemaLabel(joinPath(path, key))} is required.`;
    }
  }

  if (schema["additionalProperties"] === false) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        return `${schemaLabel(joinPath(path, key))} is not a recognized property.`;
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
      const childError = validateValue(value[key], propertySchema, joinPath(path, key));
      if (childError !== null) {
        return childError;
      }
    }
  }

  return null;
}

function validateString(
  value: string,
  schema: { [key: string]: JsonValue },
  path: string
): string | null {
  const minLength = schema["minLength"];
  if (typeof minLength === "number" && value.length < minLength) {
    return `${schemaLabel(path)} must be at least ${minLength} characters.`;
  }
  const maxLength = schema["maxLength"];
  if (typeof maxLength === "number" && value.length > maxLength) {
    return `${schemaLabel(path)} must be at most ${maxLength} characters.`;
  }
  return null;
}

function joinPath(path: string, key: string): string {
  return path.length > 0 ? `${path}.${key}` : key;
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
