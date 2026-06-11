import type { OutputFormat } from "@/utils/format";

export type TuiTheme = {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  heading: string;
};

const THEME: TuiTheme = {
  primary: "36",
  secondary: "35",
  success: "32",
  warning: "33",
  error: "31",
  muted: "90",
  heading: "1;37",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAMES_ASCII = ["|", "/", "-", "\\"];

type TerminalCaps = {
  color: "none" | "16" | "256" | "truecolor";
  hyperlinks: boolean;
  unicode: boolean;
  italic: boolean;
};

function detectCapabilities(): TerminalCaps {
  const term = process.env["TERM"] ?? "";
  const colorterm = process.env["COLORTERM"] ?? "";
  const termProgram = process.env["TERM_PROGRAM"] ?? "";

  // Hyperlink support (OSC 8)
  const hyperlinkTerminals = [
    "iterm2", "iterm.app",
    "wezterm",
    "ghostty",
    "windows terminal", "windowsterminal",
    "vscode",
    "rio",
    "alacritty",
    "contour",
    "foot",
    "kitty",
  ];
  const hyperlinks = hyperlinkTerminals.some(t =>
    termProgram.toLowerCase().includes(t) ||
    term.toLowerCase().includes(t)
  ) || process.env["TERM_PROGRAM_VERSION"]?.includes("WezTerm") === true;

  // Color depth
  let color: TerminalCaps["color"] = "16";
  if (colorterm === "truecolor" || colorterm === "24bit") {
    color = "truecolor";
  } else if (term.includes("256color") || colorterm === "256color") {
    color = "256";
  } else if (term === "linux" || term === "dumb") {
    color = term === "dumb" ? "none" : "16";
  }

  // macOS Terminal.app: 256 color max, no truecolor
  if (termProgram === "Apple_Terminal") {
    color = "256";
  }

  // Unicode support (linux console is the main exception)
  const unicode = term !== "linux" && term !== "dumb";

  // Italic support
  const italic = term !== "linux" && term !== "dumb" && termProgram !== "Apple_Terminal";

  return { color, hyperlinks, unicode, italic };
}

let _caps: TerminalCaps | null = null;
function getCaps(): TerminalCaps {
  if (!_caps) _caps = detectCapabilities();
  return _caps;
}

function noColorEnabled(): boolean {
  return process.env["NO_COLOR"] !== undefined ||
    process.env["BEE_NO_COLOR"] === "1" ||
    getCaps().color === "none";
}

function c(code: string, text: string): string {
  if (noColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function dim(text: string): string {
  return c(THEME.muted, text);
}

function bold(text: string): string {
  return c("1", text);
}

function italic(text: string): string {
  if (!getCaps().italic) return text;
  return c("3", text);
}

function underline(text: string): string {
  return c("4", text);
}

function strikethrough(text: string): string {
  return c("9", text);
}

function link(url: string, label?: string): string {
  if (noColorEnabled()) return label ? `${label} (${url})` : url;
  const display = label ?? url;
  if (!getCaps().hyperlinks) {
    return label ? `${c(THEME.primary, underline(display))} ${dim(`(${url})`)}` : c(THEME.primary, underline(url));
  }
  return `\x1b]8;;${url}\x1b\\${c(THEME.primary, underline(display))}\x1b]8;;\x1b\\`;
}

function bg(code: string, text: string): string {
  if (noColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function rgb(r: number, g: number, b: number, text: string): string {
  if (noColorEnabled()) return text;
  const caps = getCaps();
  if (caps.color === "truecolor") {
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  }
  // Fallback: map to closest 256-color or 16-color ANSI
  if (caps.color === "256") {
    const code = rgbTo256(r, g, b);
    return `\x1b[38;5;${code}m${text}\x1b[0m`;
  }
  // 16-color fallback: use closest basic color
  return c(rgbTo16(r, g, b), text);
}

function bgRgb(r: number, g: number, b: number, text: string): string {
  if (noColorEnabled()) return text;
  const caps = getCaps();
  if (caps.color === "truecolor") {
    return `\x1b[48;2;${r};${g};${b}m${text}\x1b[0m`;
  }
  if (caps.color === "256") {
    const code = rgbTo256(r, g, b);
    return `\x1b[48;5;${code}m${text}\x1b[0m`;
  }
  return text;
}

function rgbTo256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round((r - 8) / 247 * 24) + 232;
  }
  return 16 + (36 * Math.round(r / 255 * 5)) + (6 * Math.round(g / 255 * 5)) + Math.round(b / 255 * 5);
}

function rgbTo16(r: number, g: number, b: number): string {
  const brightness = (r + g + b) / 3;
  if (brightness < 64) return "30";
  if (r > g && r > b) return brightness > 180 ? "91" : "31";
  if (g > r && g > b) return brightness > 180 ? "92" : "32";
  if (b > r && b > g) return brightness > 180 ? "94" : "34";
  if (r > 200 && g > 200) return "93";
  if (r > 200 && b > 200) return "95";
  if (g > 200 && b > 200) return "96";
  return brightness > 180 ? "97" : "37";
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function header(title: string, subtitle?: string): string {
  const cols = process.stdout.columns ?? 80;
  const sub = subtitle ? `  ${dim(subtitle)}` : "";
  const line = dim("─".repeat(Math.max(0, cols - stripAnsi(title).length - stripAnsi(sub).length - 2)));
  return `${c(THEME.heading, title)}${sub} ${line}`;
}

function footer(info?: string): string {
  if (!info) return "";
  return dim(info);
}

export const ansi = {
  c,
  dim,
  bold,
  italic,
  underline,
  strikethrough,
  link,
  bg,
  rgb,
  bgRgb,
  stripAnsi,
  noColorEnabled,
  getCaps,
};

export function shouldUseTui(format: OutputFormat): boolean {
  if (format === "json" || format === "minimal") return false;
  if (process.env["BEE_NO_TUI"] === "1") return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

export type PaginationInfo = {
  showing: number;
  total?: number;
  hasMore: boolean;
  cursor?: string | null;
};

function paginationHint(info: PaginationInfo): string {
  if (!info.hasMore) return "";
  const totalStr = info.total ? ` of ${info.total}` : "+";
  return dim(`  ↓ showing ${info.showing}${totalStr} — use --limit N or --all for more`);
}

export function createSpinner(message: string): { start: () => void; stop: (finalMessage?: string) => void } {
  if (!process.stdout.isTTY || noColorEnabled()) {
    return {
      start: () => process.stderr.write(`${message}...\n`),
      stop: (final?: string) => { if (final) process.stderr.write(`${final}\n`); },
    };
  }

  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  const frames = getCaps().unicode ? SPINNER_FRAMES : SPINNER_FRAMES_ASCII;

  return {
    start: () => {
      process.stderr.write(`\x1b[?25l`);
      interval = setInterval(() => {
        const frame = frames[frameIndex % frames.length];
        process.stderr.write(`\r${c(THEME.primary, frame!)} ${message}`);
        frameIndex++;
      }, 80);
    },
    stop: (final?: string) => {
      if (interval) clearInterval(interval);
      process.stderr.write(`\r\x1b[2K`);
      process.stderr.write(`\x1b[?25h`);
      if (final) process.stderr.write(`${c(THEME.success, "✓")} ${final}\n`);
    },
  };
}

export function renderFactsList(
  facts: Array<{ id: number; text: string; tags: string[]; confirmed: boolean }>,
  pagination?: PaginationInfo
): void {
  const confirmed = facts.filter(f => f.confirmed);
  const pending = facts.filter(f => !f.confirmed);

  console.log(header("Facts", `${facts.length} items`));
  console.log("");

  if (confirmed.length > 0) {
    console.log(c(THEME.success, `  ▸ Confirmed (${confirmed.length})`));
    for (const fact of confirmed) {
      const tags = fact.tags.length > 0 ? dim(` [${fact.tags.join(", ")}]`) : "";
      console.log(`    ${c(THEME.primary, fact.text)}${tags}`);
    }
    console.log("");
  }

  if (pending.length > 0) {
    console.log(c(THEME.warning, `  ▸ Pending (${pending.length})`));
    for (const fact of pending) {
      console.log(`    ${dim(fact.text)}`);
    }
    console.log("");
  }

  if (facts.length === 0) {
    console.log(dim("  (none)"));
    console.log("");
  }

  if (pagination) console.log(paginationHint(pagination));
}

export function renderTodosList(
  todos: Array<{ id: number; text: string; completed: boolean; alarm_at: number | null }>,
  pagination?: PaginationInfo
): void {
  const open = todos.filter(t => !t.completed);
  const done = todos.filter(t => t.completed);

  console.log(header("Todos", `${open.length} open, ${done.length} done`));
  console.log("");

  if (open.length > 0) {
    for (const todo of open) {
      const alarm = todo.alarm_at ? dim(" ⏰") : "";
      console.log(`  ${c(THEME.primary, "○")} ${todo.text}${alarm}`);
    }
    console.log("");
  }

  if (done.length > 0) {
    console.log(dim(`  ── completed ──`));
    for (const todo of done) {
      console.log(`  ${dim("●")} ${dim(todo.text)}`);
    }
    console.log("");
  }

  if (todos.length === 0) {
    console.log(dim("  (none)"));
    console.log("");
  }

  if (pagination) console.log(paginationHint(pagination));
}

export function renderConversationsList(
  conversations: Array<{ id: number; short_summary: string | null; state: string; start_time: number }>,
  pagination?: PaginationInfo
): void {
  console.log(header("Conversations", `${conversations.length} items`));
  console.log("");

  if (conversations.length === 0) {
    console.log(dim("  (none)"));
  } else {
    for (const conv of conversations) {
      const date = new Date(conv.start_time).toLocaleDateString("en-CA");
      const time = new Date(conv.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const stateColor = conv.state === "COMPLETED" ? THEME.success : conv.state === "CAPTURING" ? THEME.warning : THEME.muted;
      const summary = conv.short_summary ?? "(processing...)";
      console.log(`  ${dim(`${date} ${time}`)} ${c(stateColor, conv.state.toLowerCase())} ${c(THEME.primary, summary)}`);
    }
  }
  console.log("");

  if (pagination) console.log(paginationHint(pagination));
}

export function renderDevicesList(
  devices: Array<{ id: string; name: string; vendor: string; model: string; type: string; active: boolean }>
): void {
  console.log(header("Devices", `${devices.length} connected`));
  console.log("");

  if (devices.length === 0) {
    console.log(dim("  (none)"));
  } else {
    for (const device of devices) {
      const dot = device.active ? c(THEME.success, "●") : c(THEME.error, "○");
      console.log(`  ${dot} ${c(THEME.primary, device.name)}  ${dim(`${device.vendor} ${device.model}`)}  ${c(THEME.secondary, device.type)}`);
    }
  }
  console.log("");
}

export function renderSearchResults(
  results: Array<{ id: string; type: string; score: number; title_snippet?: string; snippet?: string }>
): void {
  console.log(header("Search", `${results.length} results`));
  console.log("");

  if (results.length === 0) {
    console.log(dim("  No results found."));
  } else {
    for (const result of results) {
      const scoreBar = c(THEME.success, "█".repeat(Math.min(8, Math.round(result.score * 6))));
      const title = (result.title_snippet ?? result.id).replace(/\*\*/g, "");
      console.log(`  ${c(THEME.secondary, `[${result.type}]`)} ${c(THEME.primary, title)} ${scoreBar}`);
      if (result.snippet) {
        const clean = result.snippet.replace(/\*\*/g, "").slice(0, 90);
        console.log(`  ${dim(clean)}`);
      }
      console.log("");
    }
  }
}

export function renderProfile(profile: { id: number; first_name: string; last_name: string; timezone: string }): void {
  console.log(header("Profile"));
  console.log("");
  console.log(`  ${dim("Name")}      ${c(THEME.primary, `${profile.first_name} ${profile.last_name}`)}`);
  console.log(`  ${dim("ID")}        ${c(THEME.primary, String(profile.id))}`);
  console.log(`  ${dim("Timezone")}  ${c(THEME.primary, profile.timezone)}`);
  console.log("");
}

export function renderStatus(status: { authenticated: boolean; user_id: number | null; environment: string; api_reachable: boolean; version: string }): void {
  const authIcon = status.authenticated ? c(THEME.success, "●") : c(THEME.error, "○");
  const apiIcon = status.api_reachable ? c(THEME.success, "●") : c(THEME.error, "○");

  console.log(header("Status"));
  console.log("");
  console.log(`  ${dim("Auth")}     ${authIcon} ${status.authenticated ? "authenticated" : "not authenticated"}`);
  console.log(`  ${dim("User")}     ${c(THEME.primary, String(status.user_id ?? "—"))}`);
  console.log(`  ${dim("Env")}      ${c(THEME.primary, status.environment)}`);
  console.log(`  ${dim("API")}      ${apiIcon} ${status.api_reachable ? "reachable" : "unreachable"}`);
  console.log(`  ${dim("Version")}  ${c(THEME.primary, status.version)}`);
  console.log("");
}

export function renderError(error: { message: string; code: number; recoverable: boolean; suggestion?: string }): void {
  console.error("");
  console.error(`  ${c(THEME.error, "✗")} ${error.message}`);
  console.error(`    ${dim(`exit ${error.code}`)}${error.recoverable ? dim(" (recoverable)") : ""}`);
  if (error.suggestion) {
    console.error(`    ${c(THEME.success, "→")} ${error.suggestion}`);
  }
  console.error("");
}

export function renderDailySummary(daily: { id: number; short_summary: string; date_time: number }): void {
  const date = new Date(daily.date_time).toLocaleDateString("en-CA");
  console.log(header("Daily Summary", date));
  console.log("");
  console.log(`  ${daily.short_summary}`);
  console.log("");
  console.log(footer(dim(`id: ${daily.id}`)));
}

export function renderChanged(
  meta: { since: number; until: number; updated: boolean; next_cursor: string | null },
  counts: { facts: number; todos: number; conversations: number; dailies: number; journals: number }
): void {
  const since = new Date(meta.since).toLocaleString();
  const until = new Date(meta.until).toLocaleString();
  const total = counts.facts + counts.todos + counts.conversations + counts.dailies + counts.journals;

  console.log(header("Changed", `${total} updates`));
  console.log("");
  console.log(`  ${dim("Period")}  ${c(THEME.primary, since)} → ${c(THEME.primary, until)}`);
  console.log("");

  const items = [
    { label: "Facts", count: counts.facts, color: THEME.primary },
    { label: "Todos", count: counts.todos, color: THEME.warning },
    { label: "Conversations", count: counts.conversations, color: THEME.secondary },
    { label: "Dailies", count: counts.dailies, color: THEME.success },
    { label: "Journals", count: counts.journals, color: THEME.muted },
  ];

  for (const item of items) {
    if (item.count > 0) {
      const bar = c(item.color, "█".repeat(Math.min(15, item.count)));
      console.log(`  ${dim(item.label.padEnd(14))} ${bar} ${dim(String(item.count))}`);
    }
  }
  console.log("");

  if (meta.next_cursor) {
    console.log(footer(dim(`cursor: ${meta.next_cursor}`)));
  }
}
