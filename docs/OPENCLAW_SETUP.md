# Running Bee CLI with OpenClaw

This guide explains how to set up bee-cli for use as a tool by an OpenClaw agent, enabling autonomous access to your Bee personal AI data (conversations, facts, todos, health, calendar, emails, and more).

---

## Prerequisites

- **Node.js 18+** or **Bun 1.0+** installed
- A **Bee account** (sign up at bee.computer)
- **OpenClaw** configured and running

---

## 1. Install Bee CLI

### Option A: From npm (recommended)

```bash
npm install -g @beeai/cli
```

### Option B: From source

```bash
git clone https://github.com/giolaq/bee-cli.git
cd bee-cli
bun install
bun run build
# Binary at ./dist/bee
```

### Option C: Direct with Bun (development)

```bash
git clone https://github.com/giolaq/bee-cli.git
cd bee-cli
bun install
# Run directly:
bun ./sources/main.ts <command>
```

---

## 2. Authenticate

Bee CLI requires a one-time human login to obtain an API token:

```bash
bee login
```

This opens a browser for pairing. Follow the prompts. Once complete, the token is stored locally at `~/.bee/token-prod`.

Verify authentication:

```bash
bee status
```

Expected output:
```
API: production (https://app-api-developer.ce.bee.amazon.dev/)
Token: eyJ4...Xm2k
Verified as Giovanni Laquidara (id 33070).
```

### Headless environments

If running in a CI/headless environment, copy the token file from an authenticated machine:

```bash
# On authenticated machine:
cat ~/.bee/token-prod

# On headless machine:
mkdir -p ~/.bee && chmod 700 ~/.bee
echo "YOUR_TOKEN_HERE" > ~/.bee/token-prod
chmod 600 ~/.bee/token-prod
export BEE_FORCE_FILE_STORE=1
```

---

## 3. Configure for Agent Mode

Set these environment variables in your OpenClaw agent configuration:

```bash
export BEE_OUTPUT_FORMAT=json      # All output as structured JSON
export BEE_FORCE_FILE_STORE=1      # Use file-based token (no keychain dependency)
```

These ensure:
- Every command returns parseable JSON on stdout
- Errors return structured JSON on stderr
- No interactive prompts or UI formatting

---

## 4. OpenClaw Configuration

### Tool Definition

Add bee-cli as a tool in your OpenClaw agent's configuration. The tool wraps shell execution of `bee` commands.

```yaml
# openclaw-agent.yaml
tools:
  - name: bee
    description: |
      Access the user's Bee personal AI data. Manages conversations, facts,
      todos, journals, health data, calendar, emails, and more.
      
      SETUP: Run `bee --describe` first to discover all available commands.
      Run `bee validate <command> [args]` before mutating operations.
      
      EXIT CODES:
        0 = success (read stdout as JSON)
        2 = auth error (suggest re-login)
        3 = invalid arguments (fix and retry)
        4 = network/API error (retry with backoff)
        5 = rate limited (wait 60s)
    type: shell
    command: bee
    env:
      BEE_OUTPUT_FORMAT: json
      BEE_FORCE_FILE_STORE: "1"
```

### Agent System Prompt

Include this in your agent's system prompt so it knows how to use bee-cli:

```
You have access to the `bee` CLI tool which manages the user's personal AI data.

## Discovery
Run `bee --describe` to get a JSON schema of all available commands, their parameters,
and whether they have side effects.

## Usage Protocol
1. Before any write operation, run: bee validate <command> [args]
2. Execute: bee <command> [args]  
3. Read stdout (JSON). Check exit code.
4. On error, read stderr for: {"error": "...", "code": N, "recoverable": bool, "suggestion": "..."}

## Exit Code Handling
- 0: Success. Parse stdout JSON.
- 2: Auth expired. Tell user to run `bee login`.
- 3: Bad arguments. Fix flags and retry immediately.
- 4: Network/API error. Retry up to 3 times with backoff (1s, 2s, 4s).
- 5: Rate limited. Wait 60 seconds, then retry.
- 1: General error. Report to user.

## Key Commands
- bee facts list/create/update/delete — personal knowledge base
- bee todos list/create/update/delete — task management  
- bee conversations list/get — recorded conversations
- bee search --query "..." — semantic search across all data
- bee changed — what's new since last check
- bee today — today's calendar + email brief
- bee now — recent conversations (last 10 hours)
- bee daily list/get — daily narrative summaries
- bee journals list — voice journal entries
- bee health heart-rate|steps|sleep|alerts — health data
- bee calendar list — calendar events
- bee emails list — email inbox
- bee sync --output ./data — export everything to markdown files

## Pagination
List commands may return "next_cursor" in the response. 
Pass it back: bee <command> list --cursor "cursor_value"

## Important
- Always use `bee validate` before create/update/delete operations
- The `bee stream` command is for real-time SSE events (long-running)
- The `bee sync` command writes files to disk (specify --output directory)
```

---

## 5. Verify Agent Setup

Run these commands to confirm everything works:

```bash
# 1. Check auth
bee status --json
# Expected: {"authenticated":true,"user_id":...,"api_reachable":true}

# 2. Discover commands
bee --describe | head -20
# Expected: JSON blob with version, auth_status, commands object

# 3. Validate a command
bee validate facts list --limit 5
# Expected: {"valid":true}

# 4. Execute a command
bee facts list --limit 2
# Expected: {"facts":[...],"next_cursor":...,"timezone":"..."}

# 5. Test error handling
bee facts create
# Expected exit 3, stderr: {"error":"Missing fact text...","code":3,...}
```

---

## 6. Example Agent Session

Here's what a typical OpenClaw agent session looks like using bee-cli:

```
Agent: I'll check what the user has been up to today.

[Executes: bee today]
→ {"calendar_events":[],"emails":[],"timezone":"America/Los_Angeles"}

Agent: No calendar or emails today. Let me check recent conversations.

[Executes: bee now]  
→ {"since":1779275504,"until":1779311504,"timezone":"America/Los_Angeles","conversations":[]}

Agent: No recent conversations. Let me check what changed since last time.

[Executes: bee changed]
→ {"meta":{"next_cursor":"v1-...","updated":true},"facts":[{"id":10580853,"text":"I dance bachata",...}],"todos":[],...}

Agent: I see a new fact was recorded. The user likes to dance bachata.
       Let me search for related conversations.

[Executes: bee validate search --query "bachata"]
→ {"valid":true}

[Executes: bee search --query "bachata"]
→ {"results":[...],"timezone":"America/Los_Angeles"}

Agent: Found a conversation about dancing. Let me create a todo reminder.

[Executes: bee validate todos create --text "Look up bachata classes nearby"]
→ {"valid":true}

[Executes: bee todos create --text "Look up bachata classes nearby"]
→ {"id":27571800,"text":"Look up bachata classes nearby","completed":false,...}

Agent: Done! Created a todo to look up bachata classes.
```

---

## 7. Troubleshooting

### "Not authenticated" (exit code 2)

The token has expired or is missing. A human needs to run `bee login` once to re-authenticate.

### "Request failed with status 500" (exit code 4)

The Bee API is having issues. Retry with backoff. If persistent, the feature may not be enabled for this account (e.g., calendar/email require linking a provider in the Bee app).

### "--limit must be a positive integer" (exit code 3)

The agent sent invalid arguments. Check the `--describe` output for correct parameter types.

### Commands returning 404

Some endpoints (contacts, photos, screen, checkins, health, products) require the Bee Pioneer wearable to be connected and actively recording. If the user doesn't have these features enabled, the API returns 404.

### Token storage

Tokens are stored at:
- `~/.bee/token-prod` (production)
- `~/.bee/token-staging` (staging)

Ensure the directory has correct permissions: `chmod 700 ~/.bee`

---

## 8. Reference

| Resource | Location |
|----------|----------|
| Full agent instructions | `AGENT.md` in repo root |
| Command schema | `bee --describe` (runtime) |
| Validation | `bee validate <command> [args]` |
| Source code | `sources/commands/*/index.ts` |
| Mock server (for testing) | `bun ./mock-server.ts` |
| API endpoint comparison | See `API_ENDPOINTS_COMPARISON.md` (if generated) |
