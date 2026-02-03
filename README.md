# bee-cli

CLI client for bee.computer.

## Installation

Download the latest release from the releases page or build from source.

## Usage

```bash
bee <command> [options]
```

## Commands

- `auth` - Manage developer API authentication.
  - `auth login` - Log in interactively, or with `--token <token>` / `--token-stdin`.
  - `auth status` - Show current authentication status.
  - `auth logout` - Log out and clear stored credentials.

- `me` - Fetch the developer profile.

- `today` - Fetch today's brief (calendar events and emails).

- `facts` - Manage developer facts.
  - `facts list` - List facts. Options: `--limit N`, `--cursor <cursor>`, `--confirmed <true|false>`.
  - `facts get <id>` - Get a specific fact.
  - `facts create --text <text>` - Create a new fact.
  - `facts update <id> --text <text>` - Update a fact. Options: `--confirmed <true|false>`.
  - `facts delete <id>` - Delete a fact.

- `todos` - Manage developer todos.
  - `todos list` - List todos. Options: `--limit N`, `--cursor <cursor>`.
  - `todos get <id>` - Get a specific todo.
  - `todos create --text <text>` - Create a new todo. Options: `--alarm-at <iso>`.
  - `todos update <id>` - Update a todo. Options: `--text <text>`, `--completed <true|false>`, `--alarm-at <iso>`, `--clear-alarm`.
  - `todos delete <id>` - Delete a todo.

- `conversations` - Access developer conversations.
  - `conversations list` - List conversations. Options: `--limit N`, `--cursor <cursor>`.
  - `conversations get <id>` - Get a specific conversation.

- `daily` - Access daily summaries.
  - `daily list` - List daily summaries. Options: `--limit N`.
  - `daily get <id>` - Get a specific daily summary.

- `search` - Search developer data.
  - `search conversations --query <text>` - Search conversations. Options: `--limit N`, `--cursor <cursor>`.

- `sync` - Sync developer data to markdown files. Options: `--output <dir>`, `--recent-days N`.

- `ping` - Run a quick connectivity check. Use `--count N` to repeat.

- `version` - Print the CLI version. Use `--json` for JSON output.

## License

MIT
