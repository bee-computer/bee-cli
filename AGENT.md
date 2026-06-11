# Bee CLI Agent Instructions

Instructions for AI agents (OpenClaw, Hermes, etc.) to use bee-cli autonomously.

## Setup

```bash
export BEE_OUTPUT_FORMAT=json
export BEE_FORCE_FILE_STORE=1
```

Verify authentication:
```bash
bee status --json
```

If `"authenticated": false`, run `bee login` (requires human interaction once).

Discover available commands:
```bash
bee --describe
```

## Usage Pattern

1. Set `BEE_OUTPUT_FORMAT=json` in your environment (all output becomes JSON).
2. Call `bee validate <command> [subcommand] [--flags]` before mutating commands to pre-check.
3. Read stdout as JSON. All commands return structured data.
4. Check exit code after every call:
   - `0` = success, process the JSON response
   - `2` = auth error, run `bee login` or refresh token
   - `3` = invalid arguments, fix the flags and retry
   - `4` = API/network error, retry with exponential backoff
   - `5` = rate limited, wait and retry
   - `1` = general error, report to user
5. On non-zero exit, read stderr for structured error JSON:
   ```json
   {"error": "message", "code": 3, "recoverable": false, "suggestion": "..."}
   ```

## Commands

### Read operations (no side effects)

| Command | Description |
|---------|-------------|
| `bee facts list [--limit N] [--cursor C]` | List personal facts |
| `bee facts get <id>` | Get a single fact |
| `bee todos list [--limit N] [--cursor C]` | List todos |
| `bee todos get <id>` | Get a single todo |
| `bee conversations list [--limit N] [--cursor C] [--bookmarked]` | List conversations |
| `bee conversations get <id>` | Get conversation detail |
| `bee daily list [--limit N] [--cursor C]` | List daily summaries |
| `bee daily get <id>` | Get daily summary detail |
| `bee journals list [--limit N] [--cursor C]` | List journal entries |
| `bee search --query <text> [--type conversations\|emails\|calendar] [--neural]` | Search across data |
| `bee today` | Today's calendar + emails brief |
| `bee now` | Recent conversations (last 10 hours) |
| `bee changed [--cursor C]` | Changes since last check |
| `bee insights list [--category C]` | List insights |
| `bee me` | User profile |
| `bee status` | Auth and connection status |
| `bee activity [--limit N]` | Recent activity |
| `bee locations [--limit N]` | Location history |
| `bee photos [--limit N]` | Photos with AI descriptions |

### Write operations (have side effects)

| Command | Description |
|---------|-------------|
| `bee facts create --text <text>` | Create a fact |
| `bee facts update <id> --text <text> [--confirmed true\|false]` | Update a fact |
| `bee facts delete <id>` | Delete a fact |
| `bee todos create --text <text> [--priority N] [--alarm-at <iso>]` | Create a todo |
| `bee todos update <id> [--text T] [--completed true\|false]` | Update a todo |
| `bee todos delete <id>` | Delete a todo |

### Utility

| Command | Description |
|---------|-------------|
| `bee --describe` | Full command schema (JSON blob for discovery) |
| `bee validate <command> [args]` | Pre-validate without executing |
| `bee status --json` | Structured auth/connection status |
| `bee sync --output <dir> [--only facts\|todos\|daily\|conversations]` | Export to markdown files |
| `bee stream [--types T] [--json\|--agent]` | Real-time event stream (SSE) |

## Pagination

List commands return `next_cursor` in the response. Pass it back:
```bash
bee facts list --cursor "v1-1779315328643-10583865"
```

## Output Modes

| Flag | Effect |
|------|--------|
| (none with `BEE_OUTPUT_FORMAT=json`) | JSON output (agent default) |
| `--pretty` | Human-readable markdown |
| `--minimal` | Compact JSON (strips timezone, no indentation) |
| `--json` | Explicit JSON (same as env var) |

## Error Recovery

```
Exit 2 (auth)    → bee login (needs human), then retry
Exit 3 (args)    → fix command flags, retry immediately
Exit 4 (network) → exponential backoff: 1s, 2s, 4s, 8s, max 3 retries
Exit 5 (rate)    → wait 60s, then retry
Exit 1 (general) → log and report to user
```
