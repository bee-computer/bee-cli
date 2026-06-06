import type { ToolDefinition } from "@/mcp/types";

// Canonical snapshot defining the MCP tools/list ordering.
// All tools are DERIVED from the resource registry (sources/resources/*); this
// hand-frozen array is the single source of tool ordering and guards the tool
// list against accidental drift: toolRegistry.buildToolList() uses it as the
// ordering anchor, and sources/mcp/toolRegistry.test.ts deep-equals the derived
// output against it. Adding/removing a tool here is intentional and must mirror a
// resource action.
export const TOOL_SNAPSHOT: ToolDefinition[] = [
  {
    "name": "bee_status",
    "description": "Check whether Bee CLI is signed in and ready.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "bee_search",
    "description": "Search Bee ambient wearable context server-side. Conversations, daily summaries, and facts are searched server-side via a BM25 keyword index (use the filter argument to scope). Set mode to 'semantic' for neural search over conversations only (filter and sortBy do not apply in semantic mode). Todos and insights are NOT searchable here; use bee_list_todos and bee_get_insights instead. Returns the server response verbatim. Use for questions about what the user discussed, heard, did, or captured.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Topic, person, phrase, or context to search for."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 100,
          "description": "Maximum items to return."
        },
        "filter": {
          "type": "string",
          "enum": [
            "all",
            "conversations",
            "daily",
            "facts"
          ],
          "description": "Scope the BM25 search (keyword mode only). Defaults to 'all'."
        },
        "sortBy": {
          "type": "string",
          "enum": [
            "relevance",
            "mostRecent"
          ],
          "description": "Order results by relevance or recency (keyword mode only). Defaults to 'relevance'."
        },
        "mode": {
          "type": "string",
          "enum": [
            "keyword",
            "semantic"
          ],
          "description": "'keyword' for BM25 search (default), 'semantic' for neural search over conversations only."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_list_facts",
    "description": "List saved Bee facts. Paginate with cursor using the returned next_cursor.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum items to return."
        },
        "includeUnconfirmed": {
          "type": "boolean",
          "description": "Include facts Bee has not confirmed yet."
        },
        "cursor": {
          "type": "string",
          "description": "Pagination cursor from a previous response's next_cursor; omit for the first page."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_search_facts",
    "description": "Search saved Bee facts only, server-side via the BM25 facts index. Returns the server response verbatim.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Topic, person, phrase, or context to search for."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 100,
          "description": "Maximum items to return."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_fact",
    "description": "Get one saved Bee fact by ID.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee fact ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_create_fact",
    "description": "Create a saved Bee fact.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "Fact text."
        }
      },
      "required": [
        "text"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_update_fact",
    "description": "Update a saved Bee fact.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee fact ID."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "New fact text."
        },
        "confirmed": {
          "type": "boolean",
          "description": "Whether this fact is confirmed."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_delete_fact",
    "description": "Delete one saved Bee fact.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee fact ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_recent_activity",
    "description": "Show recent activity captured by Bee: conversations, summaries, notes, todos, and insights.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 20,
          "description": "Maximum items to return."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_today",
    "description": "Show today's Bee wearable context: daily summary, active todos, notes, and captured conversations.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "bee_list_conversations",
    "description": "List captured Bee conversations. Paginate with cursor using the returned next_cursor.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 20,
          "description": "Maximum items to return."
        },
        "cursor": {
          "type": "string",
          "description": "Pagination cursor from a previous response's next_cursor; omit for the first page."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_conversation",
    "description": "Get one captured Bee conversation with summary and metadata. Bee conversations come from an ambient wearable; transcript text may include ASR errors, so avoid direct quotes or transcript-only summaries unless corroborated by surrounding context.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee conversation ID."
        },
        "includeTranscript": {
          "type": "boolean",
          "description": "Include ASR transcript utterances too. Exact wording may contain recognition errors."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_conversation_transcript",
    "description": "Get ASR transcript utterances for one captured Bee conversation. Use only when transcript detail is needed; avoid direct quotes unless surrounding context gives high confidence.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee conversation ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_related_conversations",
    "description": "Find captured Bee conversations related to one conversation for surrounding context.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee conversation ID."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 10,
          "description": "Maximum items to return."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_daily_summary",
    "description": "Get a Bee daily summary by ID or YYYY-MM-DD date, including context from conversations and other wearable-captured activity.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee daily summary ID."
        },
        "date": {
          "type": "string",
          "description": "Date as YYYY-MM-DD."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_list_daily_summaries",
    "description": "List Bee daily summaries over a date range to find days with relevant captured conversations or activity.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "startDate": {
          "type": "string",
          "description": "Start date as YYYY-MM-DD."
        },
        "endDate": {
          "type": "string",
          "description": "End date as YYYY-MM-DD."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 30,
          "description": "Maximum summaries to return."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_list_voice_notes",
    "description": "List Bee voice notes or journal-style entries. Paginate with cursor using the returned next_cursor.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum items to return."
        },
        "cursor": {
          "type": "string",
          "description": "Pagination cursor from a previous response's next_cursor; omit for the first page."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_search_voice_notes",
    "description": "Search Bee voice notes or journal-style entries server-side via the BM25 journals index. Returns the server response verbatim.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Topic, person, phrase, or context to search for."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum items to return."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_voice_note",
    "description": "Get one Bee voice note or journal-style entry by ID.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "Bee voice note ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_list_todos",
    "description": "List active Bee todos. Paginate with cursor using the returned next_cursor.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum todos to return."
        },
        "cursor": {
          "type": "string",
          "description": "Pagination cursor from a previous response's next_cursor; omit for the first page."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_create_todo",
    "description": "Create a Bee todo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "Todo text."
        },
        "alarmAt": {
          "type": "string",
          "description": "Optional reminder time as an ISO date string."
        }
      },
      "required": [
        "text"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_update_todo",
    "description": "Update a Bee todo's text, completion state, or reminder time.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee todo ID."
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        },
        "completed": {
          "type": "boolean"
        },
        "alarmAt": {
          "type": [
            "string",
            "null"
          ],
          "description": "Reminder time as ISO string, or null to clear."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_complete_todo",
    "description": "Mark one Bee todo complete.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee todo ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_delete_todo",
    "description": "Delete one Bee todo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee todo ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_todo_suggestions",
    "description": "List pending Bee-suggested todos awaiting the user's review.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 20,
          "description": "Maximum items to return."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_accept_todo_suggestion",
    "description": "Accept a pending Bee-suggested todo, turning it into a real todo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee todo suggestion ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_dismiss_todo_suggestion",
    "description": "Dismiss a pending Bee-suggested todo without creating a todo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee todo suggestion ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_insights",
    "description": "List recent Bee insights. Paginate with cursor using the returned next_cursor.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum insights to return."
        },
        "cursor": {
          "type": "string",
          "description": "Pagination cursor from a previous response's next_cursor; omit for the first page."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_insight",
    "description": "Get one Bee insight by ID.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "number",
          "description": "Bee insight ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_location_clusters",
    "description": "Show Bee location clusters: places grouped by visit frequency. Lower minVisits to surface places visited only once or twice (default 3).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 20,
          "description": "Maximum items to return."
        },
        "minVisits": {
          "type": "number",
          "minimum": 1,
          "maximum": 1000,
          "description": "Minimum visits for a place to appear. Defaults to 3."
        },
        "includeVisits": {
          "type": "boolean",
          "description": "Include individual visits inside each cluster."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_recent_visits",
    "description": "List individual Bee location visits in reverse-chronological order (each with start/end time, duration, and address). Use 'from'/'to' to scope a date range; omit for the most recent window. For places grouped by frequency, use bee_get_location_clusters instead.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "description": "Start of range. Date as YYYY-MM-DD or an ISO timestamp (interpreted in your timezone)."
        },
        "to": {
          "type": "string",
          "description": "End of range. Date as YYYY-MM-DD or an ISO timestamp (interpreted in your timezone)."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum items to return."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_current_location",
    "description": "Show Bee's latest known location. Very sensitive.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_photos",
    "description": "List Bee photos, newest first. Filter by date (YYYY-MM-DD) or scope to one daily summary with dailyId. Set includeImages to return image content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dailyId": {
          "type": "number",
          "description": "Optional Bee daily summary ID."
        },
        "date": {
          "type": "string",
          "description": "Optional date as YYYY-MM-DD."
        },
        "limit": {
          "type": "number",
          "minimum": 1,
          "maximum": 20,
          "description": "Maximum items to return."
        },
        "includeImages": {
          "type": "boolean",
          "description": "Include image content when possible."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "bee_get_photo",
    "description": "Download one Bee photo by ID as image content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": [
            "number",
            "string"
          ],
          "description": "Bee photo ID."
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  }
];
