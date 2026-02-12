<div align="center"><img width="495" height="174" alt="Bee Rounded@2x" src="https://github.com/user-attachments/assets/d24ad62a-aad7-487a-a634-efde561194fe" />
</div>

<h1 align="center">
  CLI Client for Bee AI
</h1>

<div align="center">

[🌐 **Website**](https://bee.computer) • [📱 **iOS App**](https://apps.apple.com/us/app/bee-your-personal-ai/id6480349491) • 🤖 **Android Coming Soon** • [🧩 **Agent Skill**](https://github.com/bee-computer/bee-skill)

</div>

CLI client for [Bee](https://www.bee.computer/) — the wearable AI that captures your conversations and learns about you.

> [!IMPORTANT]
> To use the CLI, you must have the latest Bee app installed and enable Developer Mode by tapping the app version 5 times in Settings.

## How does it work?

Bee is an **encrypted** wearable personal AI device that sits quietly in the background, capturing your conversations and experiences throughout the day. It records and encrypts your data making it available only to you. Then inside of the secure compute units it transforms ambient context into:

- **Conversation transcripts** with speaker identification
- **Daily summaries** of your activities and discussions
- **Facts** — things Bee learns and remembers about you
- **Todos** — action items extracted from your conversations
- **Personal insights** and patterns over time

Bee understands 40+ languages, features 14-day battery life, and works with the iOS app to give you a searchable, AI-powered memory of your life.

## Why Bee CLI?

The Bee CLI exports your personal data as markdown files, making it available to:

- **AI agents**: Give Claude, GPT, or other assistants your personal context so they can help you more effectively
- **Local search**: Use grep, ripgrep, or your editor to search across all your conversations
- **Backup**: Keep a portable, offline copy of your Bee data
- **Custom integrations**: Build workflows with your conversation history, facts, and todos

## Installation

Install from npm:

```bash
npm install -g @beeai/cli
```

Or download the latest release from the releases page or build from source.

## Usage

```bash
bee <command> [options]
```

## Library (Bun)

You can also import a small library wrapper that shells out to the CLI and uses
the JSON output flags.

```ts
import { createBeeClient } from "@beeai/cli/lib";

const bee = createBeeClient();
const profile = await bee.api.me();

const stream = bee.sse.streamJson({ types: ["new-utterance"] });
for await (const event of stream.events) {
  console.log(event.data);
}
```

## Commands

By default, data commands return markdown. Use `--json` to print raw JSON.

- `login` - Log in interactively, or with `--token <token>` / `--token-stdin`.
- `status` - Show current authentication status.
- `logout` - Log out and clear stored credentials.

- `me` - Fetch your user profile. Use `--json` for JSON output.

- `today` - Fetch today's brief (calendar events and emails). Use `--json` for JSON output.

- `now` - Fetch conversations from the last 10 hours with utterances. Use `--json` for JSON output.

- `changed` - Fetch recent changes (defaults to last 24 hours). Use `--cursor <cursor>` and `--json` for JSON output.

- `stream` - Stream real-time events. Options: `--types <list>`, `--json`, `--agent`, `--webhook-endpoint <url>`, `--webhook-body <template>`.

- `facts` - Manage your facts (things Bee remembers about you).
  - `facts list` - List facts. Options: `--limit N`, `--cursor <cursor>`, `--unconfirmed`, `--json`.
  - `facts get <id>` - Get a specific fact. Options: `--json`.
  - `facts create --text <text>` - Create a new fact. Options: `--json`.
  - `facts update <id> --text <text>` - Update a fact. Options: `--confirmed <true|false>`, `--json`.
  - `facts delete <id>` - Delete a fact. Options: `--json`.

- `todos` - Manage your todos.
  - `todos list` - List todos. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `todos get <id>` - Get a specific todo. Options: `--json`.
  - `todos create --text <text>` - Create a new todo. Options: `--alarm-at <iso>`, `--json`.
  - `todos update <id>` - Update a todo. Options: `--text <text>`, `--completed <true|false>`, `--alarm-at <iso>`, `--clear-alarm`, `--json`.
  - `todos delete <id>` - Delete a todo. Options: `--json`.

- `conversations` - Access your recorded conversations.
  - `conversations list` - List conversations. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `conversations get <id>` - Get a specific conversation with full transcript. Options: `--json`.

- `daily` - Access daily summaries of your activity.
  - `daily list` - List daily summaries. Options: `--limit N`, `--json`.
  - `daily get <id>` - Get a specific daily summary. Options: `--json`.

- `journals` - Access your journals.
  - `journals list` - List journals. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `journals get <id>` - Get a specific journal. Options: `--json`.

- `search` - Search your data.
  - `search conversations --query <text>` - Search conversations. Options: `--limit N`, `--cursor <cursor>`, `--json`.

- `sync` - Export your Bee data to markdown files for AI agents. Options: `--output <dir>`, `--recent-days N`, `--only <facts|todos|daily|conversations>`.

- `proxy` - Start a local HTTP proxy for the Bee API. Options: `--port N`.

- `ping` - Run a quick connectivity check. Use `--count N` to repeat.

- `version` - Print the CLI version. Use `--json` for JSON output.

## Stream Events

Use `bee stream` to receive server-sent events (SSE). You can filter events with
`--types` (comma-separated) or pass `--types all` to receive everything. Each
event includes an `event` name and a JSON `data` payload.

Use `--agent` for a single-line, agent-friendly output like:
`Event new-utterance: [speaker_1] "Hello there" conv=uuid-string`.
Webhook templates use the same agent-friendly message for `{{message}}`.

Below are the event types and the payload fields the CLI expects/prints.

### connected

Sent when the stream connects. The `data` payload is typically empty or ignored.

### new-utterance

New transcript snippet.

Payload:
```json
{
  "utterance": {
    "text": "Hello there",
    "speaker": "speaker_1"
  },
  "conversation_uuid": "uuid-string"
}
```

### new-conversation

Conversation created.

Payload:
```json
{
  "conversation": {
    "id": 123,
    "uuid": "uuid-string",
    "state": "processing",
    "title": "Optional title"
  }
}
```

### update-conversation

Conversation updated.

Payload:
```json
{
  "conversation": {
    "id": 123,
    "state": "processed",
    "title": "Optional title",
    "short_summary": "Optional short summary"
  }
}
```

### update-conversation-summary

Short summary updated.

Payload:
```json
{
  "conversation_id": 123,
  "short_summary": "Summary text"
}
```

### delete-conversation

Conversation deleted.

Payload:
```json
{
  "conversation": {
    "id": 123,
    "title": "Optional title"
  }
}
```

### update-location

Conversation location updated.

Payload:
```json
{
  "conversation_id": 123,
  "location": {
    "latitude": 37.77,
    "longitude": -122.41,
    "name": "Optional name"
  }
}
```

### todo-created

Todo created.

Payload:
```json
{
  "todo": {
    "id": 10,
    "text": "Call dentist",
    "completed": false,
    "alarmAt": 1700000000000
  }
}
```

### todo-updated

Todo updated (same payload as todo-created).

### todo-deleted

Todo deleted.

Payload:
```json
{
  "todo": {
    "id": 10,
    "text": "Optional text"
  }
}
```

### journal-created

Journal created.

Payload:
```json
{
  "journal": {
    "id": 55,
    "state": "processed",
    "text": "Optional raw text",
    "aiResponse": {
      "message": "Optional assistant message",
      "cleanedUpText": "Optional cleaned text",
      "followUp": "Optional follow up",
      "todos": ["Optional todo"]
    }
  }
}
```

### journal-updated

Journal updated (same payload as journal-created).

### journal-deleted

Journal deleted.

Payload:
```json
{
  "journalId": 55,
  "reason": "Optional reason"
}
```

## Sync Command

The `sync` command exports all your Bee data to a local directory as markdown files.

### Usage

```bash
bee sync [--output <dir>] [--recent-days N] [--only <facts|todos|daily|conversations>]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output <dir>` | `bee-sync` | Output directory for synced files |
| `--recent-days N` | `3` | Number of recent days to sync with full conversation details |
| `--only <targets>` | all | Limit sync to a comma-separated list: `facts`, `todos`, `daily`, `conversations` |

### Output Structure

```
bee-sync/
├── facts.md              # All facts (confirmed and pending)
├── todos.md              # All todos (open and completed)
└── daily/
    └── YYYY-MM-DD/       # One folder per day
        ├── summary.md    # Daily summary
        └── conversations/
            ├── 123.md    # Individual conversation files
            ├── 456.md
            └── ...
```

### File Formats

#### facts.md

Contains all your facts organized by confirmation status.

```markdown
# Facts

## Confirmed

- Fact text here [tag1, tag2] (2024-01-15T10:30:00.000Z, id 42)
- Another fact (2024-01-14T08:00:00.000Z, id 41)

## Pending

- Unconfirmed fact (2024-01-16T12:00:00.000Z, id 43)
```

Each fact entry includes:
- The fact text
- Tags (if any) in brackets
- Creation timestamp in ISO 8601 format
- Unique fact ID

#### todos.md

Contains all your todos organized by completion status.

```markdown
# Todos

## Open

- Buy groceries (id 10, created 2024-01-15T09:00:00.000Z, alarm 2024-01-16T18:00:00.000Z)
- Call dentist (id 11, created 2024-01-15T10:00:00.000Z)

## Completed

- Finish report (id 9, created 2024-01-14T08:00:00.000Z)
```

Each todo entry includes:
- The todo text
- Unique todo ID
- Creation timestamp
- Alarm time (if set)

#### daily/YYYY-MM-DD/summary.md

Daily summary containing an overview of the day.

```markdown
# Daily Summary — 2024-01-15

- id: 100
- date_time: 2024-01-15T00:00:00.000Z
- created_at: 2024-01-16T02:00:00.000Z
- conversations_count: 5

## Short Summary

Brief overview of the day's activities.

## Summary

Detailed summary of conversations and events.

## Email Summary

Summary of email activity (if available).

## Calendar Summary

Summary of calendar events (if available).

## Locations

- 123 Main St, City (37.77490, -122.41940)
- Coffee Shop (37.78500, -122.40900)

## Conversations

- 123 (2024-01-15T09:00:00.000Z - 2024-01-15T09:30:00.000Z) — Meeting with team (conversations/123.md)
- 124 (2024-01-15T14:00:00.000Z - 2024-01-15T14:15:00.000Z) — Quick chat (conversations/124.md)
```

#### daily/YYYY-MM-DD/conversations/ID.md

Individual conversation transcripts with full details.

```markdown
# Conversation 123

- start_time: 2024-01-15T09:00:00.000Z
- end_time: 2024-01-15T09:30:00.000Z
- device_type: ios
- state: processed
- created_at: 2024-01-15T09:00:00.000Z
- updated_at: 2024-01-15T10:00:00.000Z

## Short Summary

Brief description of the conversation.

## Summary

Detailed summary of what was discussed.

## Primary Location

- 123 Main St, City (37.77490, -122.41940)
- created_at: 2024-01-15T09:00:00.000Z

## Suggested Links

- https://example.com/resource (2024-01-15T09:15:00.000Z)

## Transcriptions

### Transcription 456
- realtime: false

- Speaker 1: Hello, how are you? (2024-01-15T09:00:00.000Z - 2024-01-15T09:00:05.000Z)
- Speaker 2: I'm doing well, thanks! (2024-01-15T09:00:06.000Z - 2024-01-15T09:00:10.000Z)
```

Each conversation file includes:
- Metadata (timestamps, device type, state)
- Short and detailed summaries
- Primary location with coordinates
- Suggested links extracted from the conversation
- Full transcription with speaker labels and timestamps

### Examples

Sync to the default directory:

```bash
bee sync
```

Sync to a custom directory:

```bash
bee sync --output ~/Documents/bee-backup
```

Sync with more recent days for full details:

```bash
bee sync --recent-days 7
```

### Notes

- The sync command fetches all facts, todos, and daily summaries
- Conversations are fetched concurrently (4 at a time) for faster syncing
- Recent days (controlled by `--recent-days`) get their conversations synced twice to ensure completeness
- All timestamps are in ISO 8601 format (UTC)
- The output directory is created if it doesn't exist
- Existing files are overwritten on subsequent syncs

## License

MIT
