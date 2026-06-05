import type { ToolDefinition } from "@/mcp/types";

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const limit = (maximum: number, description = "Maximum items to return.") => ({
  type: "number",
  minimum: 1,
  maximum,
  description,
});

const idNumber = (description: string) => ({
  type: "number",
  description,
});

const query = {
  type: "string",
  minLength: 1,
  maxLength: 500,
  description: "Topic, person, phrase, or context to search for.",
};

export const MCP_SERVER_SCHEMA_VERSION = "bee-cli-mcp-2026-06-05";

export const BEE_MCP_TOOLS: ToolDefinition[] = [
  {
    name: "bee_status",
    description: "Check whether Bee CLI is signed in and ready.",
    inputSchema: emptySchema,
  },
  {
    name: "bee_search",
    description: "Search Bee ambient wearable context, including captured conversations, summaries, voice notes, facts, todos, and insights. Use for questions about what the user discussed, heard, did, or captured.",
    inputSchema: {
      type: "object",
      properties: { query, limit: limit(20) },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_list_facts",
    description: "List saved Bee facts.",
    inputSchema: {
      type: "object",
      properties: {
        limit: limit(50),
        includeUnconfirmed: {
          type: "boolean",
          description: "Include facts Bee has not confirmed yet.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bee_search_facts",
    description: "Search saved Bee facts only.",
    inputSchema: {
      type: "object",
      properties: { query, limit: limit(20), includeUnconfirmed: { type: "boolean" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_fact",
    description: "Get one saved Bee fact by ID.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee fact ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_create_fact",
    description: "Create a saved Bee fact.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 2000, description: "Fact text." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_update_fact",
    description: "Update a saved Bee fact.",
    inputSchema: {
      type: "object",
      properties: {
        id: idNumber("Bee fact ID."),
        text: { type: "string", minLength: 1, maxLength: 2000, description: "New fact text." },
        confirmed: { type: "boolean", description: "Whether this fact is confirmed." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_delete_fact",
    description: "Delete one saved Bee fact.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee fact ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_recent_activity",
    description: "Show recent activity captured by Bee: conversations, summaries, notes, todos, and insights.",
    inputSchema: {
      type: "object",
      properties: { limit: limit(20) },
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_today",
    description: "Show today's Bee wearable context: daily summary, active todos, notes, and captured conversations.",
    inputSchema: emptySchema,
  },
  {
    name: "bee_get_conversation",
    description: "Get one captured Bee conversation with summary and metadata. Bee conversations come from an ambient wearable; transcript text may include ASR errors, so avoid direct quotes or transcript-only summaries unless corroborated by surrounding context.",
    inputSchema: {
      type: "object",
      properties: {
        id: idNumber("Bee conversation ID."),
        includeTranscript: {
          type: "boolean",
          description: "Include ASR transcript utterances too. Exact wording may contain recognition errors.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_conversation_transcript",
    description: "Get ASR transcript utterances for one captured Bee conversation. Use only when transcript detail is needed; avoid direct quotes unless surrounding context gives high confidence.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee conversation ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_related_conversations",
    description: "Find captured Bee conversations related to one conversation for surrounding context.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee conversation ID."), limit: limit(10) },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_daily_summary",
    description: "Get a Bee daily summary by ID or YYYY-MM-DD date, including context from conversations and other wearable-captured activity.",
    inputSchema: {
      type: "object",
      properties: {
        id: idNumber("Bee daily summary ID."),
        date: { type: "string", description: "Date as YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bee_list_daily_summaries",
    description: "List Bee daily summaries over a date range to find days with relevant captured conversations or activity.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date as YYYY-MM-DD." },
        endDate: { type: "string", description: "End date as YYYY-MM-DD." },
        limit: limit(30, "Maximum summaries to return."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "bee_search_voice_notes",
    description: "Search Bee voice notes or journal-style entries captured or saved through Bee.",
    inputSchema: {
      type: "object",
      properties: { query, limit: limit(20) },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_voice_note",
    description: "Get one Bee voice note or journal-style entry by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Bee voice note ID." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_list_todos",
    description: "List active Bee todos.",
    inputSchema: {
      type: "object",
      properties: { limit: limit(50, "Maximum todos to return.") },
      additionalProperties: false,
    },
  },
  {
    name: "bee_create_todo",
    description: "Create a Bee todo.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: 2000, description: "Todo text." },
        alarmAt: { type: "string", description: "Optional reminder time as an ISO date string." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_update_todo",
    description: "Update a Bee todo's text, completion state, or reminder time.",
    inputSchema: {
      type: "object",
      properties: {
        id: idNumber("Bee todo ID."),
        text: { type: "string", minLength: 1, maxLength: 2000 },
        completed: { type: "boolean" },
        alarmAt: { type: ["string", "null"], description: "Reminder time as ISO string, or null to clear." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_complete_todo",
    description: "Mark one Bee todo complete.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_delete_todo",
    description: "Delete one Bee todo.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee todo ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_todo_suggestions",
    description: "Show Bee-suggested todos when available.",
    inputSchema: {
      type: "object",
      properties: { limit: limit(20) },
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_insights",
    description: "List recent Bee insights.",
    inputSchema: {
      type: "object",
      properties: { limit: limit(50, "Maximum insights to return.") },
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_insight",
    description: "Get one Bee insight by ID.",
    inputSchema: {
      type: "object",
      properties: { id: idNumber("Bee insight ID.") },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_recent_locations",
    description: "Show recent Bee location clusters.",
    inputSchema: {
      type: "object",
      properties: {
        limit: limit(20),
        includeVisits: { type: "boolean", description: "Include individual visits inside each cluster." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_current_location",
    description: "Show Bee's latest known location. Very sensitive.",
    inputSchema: emptySchema,
  },
  {
    name: "bee_get_photos",
    description: "List Bee photos from summaries. Set includeImages to return image content when numeric photo IDs are available.",
    inputSchema: {
      type: "object",
      properties: {
        dailyId: idNumber("Optional Bee daily summary ID."),
        date: { type: "string", description: "Optional date as YYYY-MM-DD." },
        limit: limit(20),
        includeImages: { type: "boolean", description: "Include image content when possible." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bee_get_photo",
    description: "Download one Bee photo by ID as image content.",
    inputSchema: {
      type: "object",
      properties: { id: { type: ["number", "string"], description: "Bee photo ID." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];
