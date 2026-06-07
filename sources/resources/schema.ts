// Schema-fragment factories for building MCP tool inputSchema objects.
import type { JsonObject, JsonValue } from "@/mcp/types";

export const emptySchema: JsonObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const limit = (maximum: number, description = "Maximum items to return."): JsonObject => ({
  type: "number",
  minimum: 1,
  maximum,
  description,
});

export const idNumber = (description: string): JsonObject => ({
  type: "number",
  description,
});

export const query: JsonObject = {
  type: "string",
  minLength: 1,
  maxLength: 500,
  description: "Topic, person, phrase, or context to search for.",
};

export const cursor: JsonObject = {
  type: "string",
  description: "Pagination cursor from a previous response's next_cursor; omit for the first page.",
};

export const nullableString = (description: string): JsonObject => ({
  type: ["string", "null"],
  description,
});

export const numberOrString = (description: string): JsonObject => ({
  type: ["number", "string"],
  description,
});

export const enumOf = (values: readonly string[], description: string): JsonObject => ({
  type: "string",
  enum: [...values],
  description,
});

// Assembles {type:"object", properties, [required], additionalProperties:false}.
// `required` is omitted entirely when not provided.
export function objectSchema(spec: {
  properties: { [key: string]: JsonValue };
  required?: readonly string[];
}): JsonObject {
  const schema: JsonObject = {
    type: "object",
    properties: spec.properties,
  };
  if (spec.required !== undefined) {
    schema["required"] = [...spec.required];
  }
  schema["additionalProperties"] = false;
  return schema;
}
