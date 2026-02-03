# 🐝 Bee CLI

CLI client for bee.computer. Export your Bee data as markdown files for use with AI agents, local search, and backup.

## Installation

Download the latest release from the releases page or build from source.

## Usage

```bash
bee <command> [options]
```

## Commands

- `auth` - Authenticate the CLI with your Bee account.
  - `auth login` - Log in interactively, or with `--token <token>` / `--token-stdin`.
  - `auth status` - Show current authentication status.
  - `auth logout` - Log out and clear stored credentials.

- `me` - Fetch your user profile.

- `today` - Fetch today's brief (calendar events and emails).

- `facts` - Manage your facts (things Bee remembers about you).
  - `facts list` - List facts. Options: `--limit N`, `--cursor <cursor>`, `--confirmed <true|false>`.
  - `facts get <id>` - Get a specific fact.
  - `facts create --text <text>` - Create a new fact.
  - `facts update <id> --text <text>` - Update a fact. Options: `--confirmed <true|false>`.
  - `facts delete <id>` - Delete a fact.

- `todos` - Manage your todos.
  - `todos list` - List todos. Options: `--limit N`, `--cursor <cursor>`.
  - `todos get <id>` - Get a specific todo.
  - `todos create --text <text>` - Create a new todo. Options: `--alarm-at <iso>`.
  - `todos update <id>` - Update a todo. Options: `--text <text>`, `--completed <true|false>`, `--alarm-at <iso>`, `--clear-alarm`.
  - `todos delete <id>` - Delete a todo.

- `conversations` - Access your recorded conversations.
  - `conversations list` - List conversations. Options: `--limit N`, `--cursor <cursor>`.
  - `conversations get <id>` - Get a specific conversation with full transcript.

- `daily` - Access daily summaries of your activity.
  - `daily list` - List daily summaries. Options: `--limit N`.
  - `daily get <id>` - Get a specific daily summary.

- `search` - Search your data.
  - `search conversations --query <text>` - Search conversations. Options: `--limit N`, `--cursor <cursor>`.

- `sync` - Export your Bee data to markdown files for AI agents. Options: `--output <dir>`, `--recent-days N`, `--only <facts|todos|daily|conversations>`.

- `ping` - Run a quick connectivity check. Use `--count N` to repeat.

- `version` - Print the CLI version. Use `--json` for JSON output.

## Sync Command

The `sync` command exports all your Bee data to a local directory as markdown files. This is ideal for:

- **AI agents**: Feed your personal context to Claude, GPT, or other AI assistants
- **Local search**: Use grep, ripgrep, or your favorite tools to search your data
- **Backup**: Keep a local copy of your Bee data in a portable format
- **Integration**: Build custom workflows with your personal data

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
