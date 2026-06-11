# Plan: TUI Research Findings — Design Patterns for Bee CLI

## Context

Feedback received: research what makes TUIs great in (1) frontier coding agents (Gemini CLI, Claude Code, OpenCode, Kiro) and (2) SaaS CLIs closer to bee-cli's scope (Stripe, 1Password, Tailscale, gh, Charm tools). The coding agents are heavier workbenches; the SaaS CLIs are closer to what bee-cli should be.

**Goal:** Research only. Compile findings into a reference document for future TUI improvements. No code changes.

---

## Research Results

### Category 1: Frontier Coding Agent TUIs

Researched: Claude Code, OpenCode (OpenTUI), Gemini CLI, Kiro

#### Key Patterns

**1. Adaptive Output Detection**
All tools detect `process.stdout.isTTY` to decide between rich TUI and plain output. Support multiple formats (JSON, text, minimal) for piping. This is exactly what bee-cli already does with `shouldUseTui()`.

**2. Box-Based Panels (not full-screen)**
Rather than full-screen frameworks, these tools use Unicode box rendering (╭─╮ │ ╰─╯) for self-contained panels. Panels are independent units sized to terminal width. Avoids heavyweight TUI libraries.

**3. Semantic ANSI Color Theme**
Consistent palette mapped to developer intent:
- Cyan (36): content, data values
- Green (32): success, active, confirmed
- Yellow (33): pending, in-progress, warnings
- Red (31): errors, inactive
- Gray (90): metadata, secondary info
- Bold white (1;37): section headings

Uses raw ANSI codes, not external libraries.

**4. In-Place Progress (no scrolling)**
Braille spinners (⠋⠙⠹⠸) at 80ms. Multi-task progress uses cursor movement (`\x1b[nA`) to overwrite previous lines rather than scrolling the terminal.

**5. Smart Truncation**
Strip ANSI before measuring width. Truncate mid-line preserving color codes. Virtual scrolling (track offset, render visible window only).

**6. Two-Pane Dashboard**
Fixed narrow left pane (navigation), scrollable right pane (content). Expand items for detail. Vim keys + arrow keys.

**7. Error Boxes with Metadata**
Error display includes: icon (✗), message, error code, recoverability flag, and actionable suggestion in a dedicated box.

**8. What Makes Them "Good"**
- Zero dependencies (raw ANSI)
- Graceful degradation (works in pipes, CI)
- Responsive to terminal width
- Information density over flashiness
- Fast redraws via cursor positioning
- Dashboard is optional; commands work standalone

---

### Category 2: SaaS CLI TUI Patterns

Researched: Stripe CLI, GitHub CLI (gh), 1Password (op), Tailscale, Charm tools (lipgloss, bubbletea, gum)

#### Key Patterns

**1. One-Shot Default, Interactive Optional**
Default behavior: print and exit. Users expect to pipe output. Interactive mode only when explicitly requested (`--interactive`) or when piping is unavailable. Never force modal UI for data commands.

**2. Conservative Color Usage**
- Green: success/positive only
- Red: errors only
- Cyan/blue: interactive prompts
- Dim/faint: timestamps, IDs, supplementary info
- Respect `NO_COLOR` env var
- Auto-downsample to 256/16 color terminals

**3. Data Display Strategy**
- Lists: compact tables with consistent column alignment
- Large datasets: limit by default (e.g., 10 items), show `↓ 47 more` with `--all` flag
- Key-value: left-align keys, dim metadata
- Never paginate interactively for data commands

**4. Flags for Output Control**
- `--json` for machine-readable
- `--limit N` for row count
- `--wide` for expanded columns
- `--no-limit` / `--all` for full dataset
- `--depth N` for nested data

**5. Error Display**
- Print to stderr (not stdout)
- One-line format: `Error: [brief message]`
- Add `--help` suggestion on ambiguous commands
- Structured exit codes for automation

**6. Progress/Status**
- Quick ops (<500ms): no indicator needed
- Long ops: simple spinner
- Streaming: timestamp-prefixed log lines (Stripe webhook listener model)

**7. Lightweight Feel**
- Minimize startup time (no heavy frameworks for simple commands)
- Dense output by default, `--verbose` for extra
- Borders/boxes used sparingly (one per logical section, not every element)
- Fast commands should feel instant

---

## Comparison: Bee CLI Current State vs Best Practices

| Pattern | Bee CLI Current | Best Practice | Gap |
|---------|----------------|---------------|-----|
| TTY detection | ✅ `shouldUseTui()` | Adaptive | None |
| Color scheme | ✅ Semantic ANSI | Consistent palette | None |
| Box rendering | ✅ Unicode borders | Self-contained panels | None |
| One-shot default | ⚠️ Dashboard is separate cmd | One-shot for data cmds | Minor |
| `NO_COLOR` support | ❌ Missing | Respect env var | Gap |
| Data overflow | ✅ Truncation + scroll | `--all` / count indicator | Could add |
| Error on stderr | ✅ In JSON mode | Always stderr for errors | None |
| Progress spinners | ❌ Not in commands | Spinner for API calls | Gap |
| `--wide` flag | ❌ Missing | Expanded output option | Gap |
| Startup speed | ✅ Fast (Bun) | <100ms for simple cmds | None |
| Vim + arrow keys | ✅ In dashboard | Dual bindings | None |
| Borders sparingly | ⚠️ Box around everything | One per section max | Minor |

---

## Top Recommendations (for future implementation)

### High Priority (matches SaaS CLI patterns)
1. **Add `NO_COLOR` env var support** — disable all ANSI when set (standard: https://no-color.org/)
2. **Add item count indicator** — when output is limited, show "showing 10 of 47, use --all for full list"
3. **Add loading spinners** — for API calls taking >500ms, show inline spinner
4. **Lighten the box usage** — in one-shot TUI mode, use boxes only for the outer container, not every sub-section

### Medium Priority (good DX)
5. **Add `--wide` flag** — show all fields without truncation (alternative to `--json`)
6. **Add streaming progress for sync** — show real-time progress during `bee sync` with spinner per target
7. **Respect terminal resize** — listen to SIGWINCH in dashboard mode

### Low Priority (frontier agent patterns, heavier than needed)
8. **In-place multi-task progress** — cursor movement to update multiple progress lines (for sync)
9. **Syntax highlighting for conversation transcripts** — tree-sitter for code blocks in conversations

---

## Key Insight from the Feedback

> "Those are full workbenches built to invoke other tools, so they're heavier than what you're building. Worth comparing against SaaS CLIs too. Lean a bit slimmer than the frontier coding agents."

**Translation for bee-cli:**
- Don't build toward OpenCode/Claude Code's full-screen TUI complexity
- The current two-pane dashboard is fine as an *optional* mode
- Default commands should feel like `gh` or `stripe`: fast, one-shot, pipe-friendly
- The box renderer (`sources/tui/renderer.ts`) is the right weight for one-shot output
- The dashboard (`sources/tui/dashboard.ts`) is the right weight for interactive exploration
- Don't add bubbletea/lipgloss dependencies — raw ANSI is the correct choice for this project size

---

## Deliverable

Write these findings to `docs/TUI_PATTERNS_RESEARCH.md` in the project.

## Verification

N/A — this is a research document, no code changes needed.
