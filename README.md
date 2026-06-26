<div align="center"><img width="495" height="174" alt="Bee Rounded@2x" src="https://github.com/user-attachments/assets/d24ad62a-aad7-487a-a634-efde561194fe" />
</div>

<h1 align="center">
  CLI Client for Bee AI
</h1>

<div align="center">

[🌐 **Website**](https://bee.computer) • [📱 **iOS App**](https://apps.apple.com/us/app/bee-your-personal-ai/id6480349491) • [🤖 **Android App**](https://play.google.com/store/apps/details?id=com.bee.android&hl=en_US) • [🧩 **Agent Skill**](https://github.com/bee-computer/bee-skill)

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

## Use Bee with AI assistants (MCP)

The Bee CLI is also a [Model Context Protocol](https://modelcontextprotocol.io) server, so assistants like Claude and Codex can read your Bee context — search conversations, look up facts and todos, fetch daily summaries — directly, with your data staying on your machine.

Connect it to a client in one step:

```bash
bee mcp connect claude          # Claude Desktop (one-click install)
bee mcp connect claude-code     # Claude Code (CLI)
bee mcp connect codex           # Codex
bee mcp status                  # show what's connected
bee mcp disconnect claude-code  # remove
```

The server authenticates with your existing Bee login — no extra tokens to manage. To run it yourself (for another MCP client, or to debug), use one of the transports directly:

```bash
bee mcp serve                   # stdio JSON-RPC (what the connectors launch)
bee mcp serve-http [--port N]   # local HTTP, 127.0.0.1, bearer-token auth
```

> [!NOTE]
> `serve-http` binds to localhost only and requires an auth token, supplied with `--token` or the `BEE_MCP_HTTP_TOKEN` environment variable (at least 32 characters). Clients send it as `Authorization: Bearer <token>`.

Every read, search, and manage capability below is exposed as an MCP tool (`bee_search`, `bee_list_facts`, `bee_get_daily_summary`, …), so the CLI and your assistant work from the same data.

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

## Library (Node)

You can also import a small library wrapper that shells out to the `bee` binary
and uses the JSON output flags. This runs in Node.js. Ensure `bee` is on your
`PATH`, or pass a custom `command` path when creating the client.

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

- `login` - Log in interactively, with `--token <token>` / `--token-stdin`, or via proxy with `--proxy <url|socket>`. Use `--no-wait` to print the authentication link and exit immediately instead of polling for approval (useful for agents/automation; finish later with `bee status` or by re-running `bee login`).
- `status` - Show current authentication status.
- `logout` - Log out and clear stored credentials.

- `me` - Fetch your user profile. Use `--json` for JSON output.

- `today` - Fetch today's brief (calendar events and emails). Use `--context` for Bee wearable context (daily summary, active todos, notes, conversations) instead, and `--json` for JSON output.

- `now` - Fetch conversations from the last 10 hours with utterances. Use `--json` for JSON output.

- `activity` - Show recent activity across conversations, summaries, notes, todos, and insights. Options: `--limit N`, `--json`.

- `changed` - Fetch recent changes (defaults to last 24 hours). Use `--cursor <cursor>` and `--json` for JSON output.

- `stream` - Stream real-time events. Options: `--types <list>`, `--json`, `--agent`, `--webhook-endpoint <url>`, `--webhook-body <template>`.

- `facts` - Manage your facts (things Bee remembers about you).
  - `facts list` - List facts. Options: `--limit N`, `--cursor <cursor>`, `--unconfirmed`, `--json`.
  - `facts get <id>` - Get a specific fact. Options: `--json`.
  - `facts create --text <text>` - Create a new fact. Options: `--json`.
  - `facts update <id>` - Update a fact. Options: `--text <text>` (when omitted, the existing text is preserved), `--confirmed <true|false>`, `--json`.
  - `facts confirm <id>` - Confirm a fact (sets `confirmed=true`) while preserving its existing text. Options: `--json`.
  - `facts delete <id>` - Delete a fact. Options: `--json`.
  - `facts search --query <text>` - Search saved facts. Options: `--limit N`, `--json`.

- `todos` - Manage your todos.
  - `todos list` - List todos. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `todos get <id>` - Get a specific todo. Options: `--json`.
  - `todos create --text <text>` - Create a new todo. Options: `--alarm-at <iso>`, `--json`.
  - `todos update <id>` - Update a todo. Options: `--text <text>`, `--completed <true|false>`, `--alarm-at <iso>`, `--clear-alarm`, `--json`.
  - `todos complete <id>` - Mark a todo complete. Options: `--json`.
  - `todos delete <id>` - Delete a todo. Options: `--json`.
  - `todos suggestions` - List pending Bee-suggested todos. Options: `--limit N`, `--json`.
  - `todos accept-suggestion <id>` - Accept a suggested todo, turning it into a real todo. Options: `--json`.
  - `todos dismiss-suggestion <id>` - Dismiss a suggested todo. Options: `--json`.

- `conversations` - Access your recorded conversations.
  - `conversations list` - List conversations. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `conversations get <id>` - Get a specific conversation with full transcript. Options: `--json`.
  - `conversations transcript <id>` - Get just the transcript utterances. Options: `--json`.
  - `conversations related <id>` - Find conversations related to one. Options: `--limit N`, `--json`.

- `daily` - Access daily summaries of your activity.
  - `daily list` - List daily summaries. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `daily get <id>` - Get a specific daily summary. Options: `--json`.
  - `daily find <YYYY-MM-DD>` - Find the daily summary for a date. Options: `--json`.

- `journals` - Access your journals.
  - `journals list` - List journals. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `journals get <id>` - Get a specific journal. Options: `--json`.
  - `journals search --query <text>` - Search voice notes / journal entries. Options: `--limit N`, `--json`.

- `insights` - Access Bee's insights about you.
  - `insights list` - List recent insights. Options: `--limit N`, `--cursor <cursor>`, `--json`.
  - `insights get <id>` - Get a specific insight. Options: `--json`.

- `locations` - Access where you've been.
  - `locations clusters` - Show places grouped by visit frequency. Options: `--limit N`, `--min-visits N`, `--visits`, `--json`.
  - `locations recent` - Show recent individual visits. Options: `--from <date>`, `--to <date>`, `--limit N`, `--json`.
  - `locations current` - Show your latest known location. Options: `--json`.

- `photos` - Access photos synced from your photo gallery.
  - `photos list` - List photos, newest first. Options: `--daily-id N`, `--date YYYY-MM-DD`, `--limit N`, `--json`.
  - `photos get <id>` - Download one photo. Options: `--output <path>`, `--json`.

- `search` - Search your Bee data.
  - `search --query <text>` - Keyword search (default) across conversations, daily summaries, and facts. Scope with `--filter conversations|daily|facts|all` and order with `--sort relevance|mostRecent`. Use `--neural` for semantic conversation search (conversations only; `--filter`/`--sort` do not apply). Bound either mode by time with `--since`/`--until` (epoch milliseconds). Options: `--limit N`, `--json`.

- `mcp` - Run or connect the MCP server (see [Use Bee with AI assistants](#use-bee-with-ai-assistants-mcp)). Subcommands: `serve`, `serve-http [--port N] [--token VALUE]`, `connect|disconnect <claude|claude-code|codex>`, `status`.

- `sync` - Export your Bee data to markdown files for AI agents. Re-runs are incremental by default (only changed daily summaries/conversations are re-fetched). Options: `--output <dir>`, `--recent-days N`, `--only <facts|todos|daily|conversations>`, `--full`, `--since <epochMs>`.

- `proxy` - Start a local Bee API proxy. Options: `--port N`, `--socket [path]`, `--idle-timeout SECONDS`.

- `ping` - Run a quick connectivity check. Use `--count N` to repeat.

- `version` - Print the CLI version. Use `--json` for JSON output.

## Proxy Authentication

Use proxy auth when another trusted local process handles Bee API authentication and this CLI should send requests through it.

### Configure Proxy Mode

```bash
# HTTP proxy
bee login --proxy http://127.0.0.1:8787

# Unix socket proxy
bee login --proxy ~/.bee/proxy.sock
```

This saves proxy config to `~/.bee/proxy-{env}.json`. When proxy config exists, it takes precedence over stored token auth.

### Start Local Proxy Server

```bash
# TCP listener (default auto-picks from 8787)
bee proxy
bee proxy --port 8787
bee proxy --idle-timeout 300

# Unix socket listener (default: ~/.bee/proxy.sock)
bee proxy --socket
bee proxy --socket /tmp/bee-proxy.sock
```

Bee Proxy sets Bun's server idle timeout to 120 seconds by default. Use
`--idle-timeout SECONDS` to increase it for large exports, or `--idle-timeout 0`
to disable idle request timeouts. In socket mode, the CLI removes stale socket
files before listening.

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

### journal-text

Raw journal text streamed in (e.g. as a voice note is transcribed).

Payload:
```json
{
  "journalId": 55,
  "text": "Optional raw text"
}
```

## Sync Command

The `sync` command exports all your Bee data to a local directory as markdown files.

### Usage

```bash
bee sync [--output <dir>] [--recent-days N] [--only <facts|todos|daily|conversations>] [--full] [--since <epochMs>]
```

After a first sync, re-running `bee sync` on the same output directory is
**incremental**: it re-fetches only the daily summaries and conversations that
have changed since the last run (facts and todos are always re-fetched in full,
since they are small). Sync state is tracked in a `.bee-sync.json` manifest
inside the output directory; delete it (or the directory) to force a full
re-sync.

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--output <dir>` | `bee-sync` | Output directory for synced files |
| `--recent-days N` | all | Limit daily summaries and conversations to the last N days (facts and todos are always synced in full). Applies to full syncs only; ignored on an incremental run |
| `--only <targets>` | all | Limit sync to a comma-separated list: `facts`, `todos`, `daily`, `conversations` (or `all`) |
| `--full` | off | Force a complete re-sync, ignoring the saved manifest, and rewrite it with fresh cursors |
| `--since <epochMs>` | — | Advanced/recovery: override the saved incremental cursor with an explicit epoch-milliseconds timestamp for changefeed-driven targets |

### Output Structure

```
bee-sync/
├── facts.md              # All facts (confirmed and pending)
├── todos.md              # All todos (open and completed)
├── daily/
│   └── YYYY-MM-DD/       # One folder per day
│       └── summary.md    # Daily summary
└── conversations/
    └── YYYY-MM-DD/       # One folder per day
        ├── 123.md        # Individual conversation files
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

- 123 (2024-01-15T09:00:00.000Z - 2024-01-15T09:30:00.000Z) — Meeting with team
- 124 (2024-01-15T14:00:00.000Z - 2024-01-15T14:15:00.000Z) — Quick chat
```

#### conversations/YYYY-MM-DD/ID.md

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

- Speaker 1: Hello, how are you?
- Speaker 2: I'm doing well, thanks!
```

Each conversation file includes:
- Metadata (timestamps, device type, state)
- Short and detailed summaries
- Primary location with coordinates
- Suggested links extracted from the conversation
- Full transcription with speaker labels

### Examples

Sync to the default directory:

```bash
bee sync
```

Sync to a custom directory:

```bash
bee sync --output ~/Documents/bee-backup
```

Sync only specific data:

```bash
bee sync --only facts,todos
```

Limit daily summaries and conversations to the last 7 days:

```bash
bee sync --recent-days 7
```

### Notes

- The first sync (or `--full`) fetches everything; facts and todos are always re-fetched in full
- Re-runs are incremental: only daily summaries and conversations that changed since the last run are re-fetched, tracked via the `.bee-sync.json` manifest in the output directory
- Conversations and daily summaries are fetched concurrently for faster syncing
- All timestamps are in ISO 8601 format (UTC)
- The output directory is created if it doesn't exist
- Existing files for changed items are overwritten in place; deletes are not reconciled, so a local file for an item later deleted on the server remains until a `--full` re-sync into a fresh directory

## License

MIT
