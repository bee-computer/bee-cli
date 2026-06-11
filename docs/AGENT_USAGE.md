# Bee CLI — Agent Instructions

Instructions for AI agents to use bee-cli autonomously via shell.

## Quick Start (copy-paste to any agent)

```
You have access to the Bee CLI for managing personal AI data.

Environment:
  export PATH="$HOME/.bun/bin:$PATH"
  export BEE_FORCE_FILE_STORE=1
  export BEE_OUTPUT_FORMAT=json

Discover all commands:
  bun ./sources/main.ts --describe

Pre-validate before writes:
  bun ./sources/main.ts validate <command>

Execute:
  bun ./sources/main.ts <command> [subcommand] [--flags]

Exit codes: 0=success, 2=auth, 3=bad args, 4=network, 5=rate-limit
On error, stderr contains: {"error":"...","code":N,"recoverable":bool,"suggestion":"..."}
```

## Installation (if not already installed)

```bash
git clone https://github.com/bee-computer/bee-cli.git
cd bee-cli
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
export BEE_FORCE_FILE_STORE=1
export BEE_OUTPUT_FORMAT=json
bun ./sources/main.ts login
```

## Protocol

1. Run `--describe` once to learn available commands and their parameters
2. Run `validate <command>` before any create/update/delete
3. Parse stdout as JSON on exit code 0
4. On non-zero exit, read stderr for structured error JSON

## Exit Codes

| Code | Meaning | Agent Action |
|------|---------|-------------|
| 0 | Success | Parse stdout JSON |
| 1 | General error | Report to user |
| 2 | Auth error | Run `bee login` |
| 3 | Invalid arguments | Fix flags, retry |
| 4 | Network/API error | Retry with backoff |
| 5 | Rate limited | Wait 60s, retry |

## Commands

### Read (no side effects)

| Command | Description |
|---------|-------------|
| `bee facts list [--limit N] [--cursor C]` | List personal facts |
| `bee facts get <id>` | Get a single fact |
| `bee todos list [--limit N] [--cursor C]` | List todos |
| `bee todos get <id>` | Get a single todo |
| `bee conversations list [--limit N] [--cursor C]` | List conversations |
| `bee conversations get <id>` | Get conversation detail |
| `bee conversations transcript <id>` | Get full transcript |
| `bee daily list [--limit N] [--cursor C]` | List daily summaries |
| `bee daily get <id>` | Get daily summary detail |
| `bee journals list [--limit N] [--cursor C]` | List journal entries |
| `bee journals get <id>` | Get a journal entry |
| `bee search --query <text>` | Search across data |
| `bee today` | Today's brief |
| `bee now` | Recent conversations (last 10 hours) |
| `bee changed [--cursor C]` | Changes since last check |
| `bee activity [--limit N]` | Recent activity |
| `bee insights list [--limit N]` | AI insights |
| `bee locations [--limit N]` | Location history |
| `bee photos [--limit N]` | Photos with descriptions |
| `bee me` | User profile |
| `bee status --json` | Auth and connection status |

### Write (validate first)

| Command | Description |
|---------|-------------|
| `bee facts create --text <text>` | Create a fact |
| `bee facts update <id> --text <text>` | Update a fact |
| `bee facts delete <id>` | Delete a fact |
| `bee todos create --text <text>` | Create a todo |
| `bee todos update <id> [--text T] [--completed true\|false]` | Update a todo |
| `bee todos delete <id>` | Delete a todo |

### Utility

| Command | Description |
|---------|-------------|
| `bee --describe` | Full command schema with parameters (JSON) |
| `bee validate <command>` | Pre-validate without executing |
| `bee sync --output <dir>` | Export to markdown files |
| `bee stream [--json]` | Real-time event stream (SSE) |
| `bee mcp` | Start MCP server (alternative agent interface) |
| `bee dashboard` | Interactive TUI (humans only) |

## Pagination

List commands return `next_cursor` in the response. Pass it back:
```bash
bee facts list --cursor "cursor_value_here"
```

## Error Recovery

```
Exit 2 (auth)    → run bee login (needs human), then retry
Exit 3 (args)    → fix command flags, retry immediately
Exit 4 (network) → exponential backoff: 1s, 2s, 4s, max 3 retries
Exit 5 (rate)    → wait 60s, then retry
Exit 1 (general) → log and report to user
```

## Alternative: MCP Protocol

For agents that support MCP natively, use `bee mcp` to start an MCP server instead of shell commands. MCP provides richer tool schemas and structured responses at the protocol level.
