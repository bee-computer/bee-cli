# Bee CLI Agent Prompt

Copy-paste this prompt to any AI agent (Claude, OpenClaw, Hermes, MeshClaw) to give it autonomous access to your Bee data.

---

## Full Prompt (for agents that need to install)

```
You have access to the Bee CLI tool for managing personal AI data (conversations, facts, todos, journals, daily summaries, search).

## Setup

Run these commands to install and authenticate:

git clone https://github.com/giolaq/bee-cli.git
cd bee-cli
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
export BEE_FORCE_FILE_STORE=1
export BEE_OUTPUT_FORMAT=json
bun ./sources/main.ts login

After login completes (opens browser), verify with:
bun ./sources/main.ts status --json

## Usage

Discover all commands and their parameters:
bun ./sources/main.ts --describe

Pre-validate before write operations:
bun ./sources/main.ts validate <command>

Execute commands:
bun ./sources/main.ts <command> [subcommand] [--flags]

## Exit codes
- 0 = success (parse stdout as JSON)
- 1 = general error
- 2 = auth error (re-run login)
- 3 = invalid arguments (fix flags)
- 4 = network/API error (retry)
- 5 = rate limited (wait 60s)

On error, stderr contains: {"error":"...","code":N,"recoverable":bool,"suggestion":"..."}

## Examples

bun ./sources/main.ts facts list --limit 5
bun ./sources/main.ts todos list
bun ./sources/main.ts conversations list --limit 3
bun ./sources/main.ts search --query "meeting"
bun ./sources/main.ts today
bun ./sources/main.ts changed
bun ./sources/main.ts facts create --text "Likes espresso"
bun ./sources/main.ts todos create --text "Review PR"
bun ./sources/main.ts validate facts create --text "test"

## Protocol

1. Run --describe once to learn available commands
2. Run validate <cmd> before any create/update/delete
3. Parse stdout as JSON on exit 0
4. On non-zero exit, read stderr for structured error JSON
```

---

## Short Prompt (for agents that already have shell access)

```
Set these env vars then use the bee CLI:

export BEE_FORCE_FILE_STORE=1 BEE_OUTPUT_FORMAT=json
bun /path/to/bee-cli/sources/main.ts --describe

That gives you all commands with parameters. Use `validate <cmd>` before writes. Exit codes: 0=ok, 2=auth, 3=args, 4=network, 5=rate-limit. Errors on stderr as JSON.
```

