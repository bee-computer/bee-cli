import { requestClientJson } from "@/client/clientApi";
import { createCommandContext } from "@/context";
import type { CommandContext } from "@/commands/types";

type MenuItem = {
  label: string;
  key: string;
  fetch: (ctx: CommandContext) => Promise<ContentItem[]>;
};

type ContentItem = {
  title: string;
  detail?: string;
  color?: string;
};

const MENU_COL_WIDTH = 22;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function padVisible(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  const pad = Math.max(0, width - visible);
  return s + " ".repeat(pad);
}

function truncateVisible(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const stripped = stripAnsi(s);
  if (stripped.length <= maxWidth) return s;

  let visibleCount = 0;
  let i = 0;
  while (i < s.length && visibleCount < maxWidth - 1) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visibleCount++;
    i++;
  }
  return s.slice(0, i) + "\x1b[0m";
}

const MENU_ITEMS: MenuItem[] = [
  { label: "Profile", key: "me", fetch: fetchProfile },
  { label: "Status", key: "status", fetch: fetchStatus },
  { label: "Facts", key: "facts", fetch: fetchFacts },
  { label: "Todos", key: "todos", fetch: fetchTodos },
  { label: "Conversations", key: "conversations", fetch: fetchConversations },
  { label: "Daily Summaries", key: "daily", fetch: fetchDaily },
  { label: "Journals", key: "journals", fetch: fetchJournals },
  { label: "Insights", key: "insights", fetch: fetchInsights },
  { label: "Today", key: "today", fetch: fetchToday },
  { label: "Now", key: "now", fetch: fetchNow },
  { label: "Changed", key: "changed", fetch: fetchChanged },
  { label: "Activity", key: "activity", fetch: fetchActivity },
  { label: "Locations", key: "locations", fetch: fetchLocations },
  { label: "Photos", key: "photos", fetch: fetchPhotos },
];

async function fetchProfile(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/me", { method: "GET" }) as Record<string, unknown>;
  return [
    { title: `${data["first_name"]} ${data["last_name"]}`, detail: `ID: ${data["id"]}\nTimezone: ${data["timezone"]}`, color: "36" },
  ];
}

async function fetchStatus(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/status", { method: "GET" }) as Record<string, unknown>;
  return [
    { title: `Authenticated: ${data["authenticated"] ?? "unknown"}`, color: "32" },
    { title: `Environment: ${ctx.env}`, color: "36" },
    { title: `Proxy: ${ctx.client.isProxy ? "yes" : "no"}`, color: "90" },
  ];
}

async function fetchFacts(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/facts?limit=20", { method: "GET" }) as { facts: Array<{ id: number; text: string; tags: string[]; confirmed: boolean }> };
  return data.facts.map(f => ({
    title: `${f.confirmed ? "●" : "○"} ${f.text}`,
    detail: `ID: ${f.id}\nTags: ${f.tags.join(", ") || "(none)"}\nConfirmed: ${f.confirmed}`,
    color: f.confirmed ? "36" : "90",
  }));
}

async function fetchTodos(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/todos?limit=20", { method: "GET" }) as { todos: Array<{ id: number; text: string; completed: boolean; alarm_at: number | null; created_at: number }> };
  return data.todos.map(t => ({
    title: `${t.completed ? "●" : "○"} ${t.text}`,
    detail: `ID: ${t.id}\nCompleted: ${t.completed}\nAlarm: ${t.alarm_at ? new Date(t.alarm_at).toLocaleString() : "(none)"}\nCreated: ${new Date(t.created_at).toLocaleString()}`,
    color: t.completed ? "90" : "36",
  }));
}

async function fetchConversations(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/conversations?limit=10", { method: "GET" }) as { conversations: Array<{ id: number; short_summary: string | null; state: string; start_time: number; end_time: number | null }> };
  return data.conversations.map(conv => {
    const date = new Date(conv.start_time).toLocaleDateString("en-CA");
    const summary = conv.short_summary ?? "(processing...)";
    return {
      title: `[${date}] ${summary}`,
      detail: `ID: ${conv.id}\nState: ${conv.state}\nStart: ${new Date(conv.start_time).toLocaleString()}\nEnd: ${conv.end_time ? new Date(conv.end_time).toLocaleString() : "(ongoing)"}`,
      color: conv.state === "COMPLETED" ? "32" : conv.state === "CAPTURING" ? "33" : "90",
    };
  });
}

async function fetchDaily(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/daily?limit=5", { method: "GET" }) as { daily_summaries: Array<{ id: number; short_summary: string; date_time: number }> };
  return data.daily_summaries.map(d => ({
    title: `[${new Date(d.date_time).toLocaleDateString("en-CA")}] ${d.short_summary.slice(0, 50)}`,
    detail: `ID: ${d.id}\nDate: ${new Date(d.date_time).toLocaleDateString("en-CA")}\n\n${d.short_summary}`,
    color: "36",
  }));
}

async function fetchJournals(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/journals?limit=10", { method: "GET" }) as { journals: Array<{ id: string; text: string; state: string; created_at: number }> };
  return data.journals.map(j => ({
    title: `[${j.state}] ${j.text.slice(0, 40)}`,
    detail: `ID: ${j.id}\nState: ${j.state}\nCreated: ${new Date(j.created_at).toLocaleString()}\n\n${j.text}`,
    color: "36",
  }));
}

async function fetchInsights(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/insights", { method: "GET" }) as { insights: Array<{ id: number; title: string; category: string; response: string | null }> };
  if (data.insights.length === 0) return [{ title: "(no insights)", color: "90" }];
  return data.insights.map(i => ({
    title: `[${i.category}] ${i.title}`,
    detail: `ID: ${i.id}\nCategory: ${i.category}\n\n${i.response ?? "(no response)"}`,
    color: "35",
  }));
}

async function fetchToday(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/todayBrief", { method: "GET" }) as { calendar_events: unknown[]; emails: unknown[]; timezone: string };
  return [
    { title: `Calendar: ${data.calendar_events.length} events`, color: "36" },
    { title: `Emails: ${data.emails.length} messages`, color: "33" },
    { title: `Timezone: ${data.timezone}`, color: "90" },
  ];
}

async function fetchNow(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/conversations?limit=5", { method: "GET" }) as { conversations: Array<{ short_summary: string | null; state: string; start_time: number }> };
  const recent = data.conversations.filter(conv => conv.start_time > Date.now() - 36000000);
  if (recent.length === 0) return [{ title: "(no conversations in last 10h)", color: "90" }];
  return recent.map(conv => ({
    title: `[${new Date(conv.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}] ${conv.short_summary ?? "(processing...)"}`,
    color: conv.state === "COMPLETED" ? "32" : "33",
  }));
}

async function fetchChanged(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/changes", { method: "GET" }) as { meta: { since: number; until: number }; facts: Array<{ text: string }>; todos: Array<{ text: string }>; conversations: unknown[]; dailies: unknown[]; journals: unknown[] };
  const items: ContentItem[] = [];
  items.push({ title: `Period: ${new Date(data.meta.since).toLocaleString()} → ${new Date(data.meta.until).toLocaleString()}`, color: "90" });
  for (const f of data.facts) items.push({ title: `[fact] ${f.text}`, color: "36" });
  for (const t of data.todos) items.push({ title: `[todo] ${t.text}`, color: "33" });
  if (data.conversations.length > 0) items.push({ title: `[conversations] ${data.conversations.length} changed`, color: "35" });
  if (data.dailies.length > 0) items.push({ title: `[dailies] ${data.dailies.length} changed`, color: "32" });
  if (data.journals.length > 0) items.push({ title: `[journals] ${data.journals.length} changed`, color: "90" });
  return items;
}

async function fetchActivity(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/activity?limit=10", { method: "GET" }) as { activities: Array<{ id: number; type: string; summary: string; timestamp: number }> };
  if (!data.activities || data.activities.length === 0) return [{ title: "(no recent activity)", color: "90" }];
  return data.activities.map(a => ({
    title: `[${a.type}] ${a.summary}`,
    detail: `ID: ${a.id}\nType: ${a.type}\nTime: ${new Date(a.timestamp).toLocaleString()}`,
    color: "36",
  }));
}

async function fetchLocations(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/locations?limit=10", { method: "GET" }) as { locations: Array<{ id: number; name: string; latitude: number; longitude: number; timestamp: number }> };
  if (!data.locations || data.locations.length === 0) return [{ title: "(no locations)", color: "90" }];
  return data.locations.map(l => ({
    title: `${l.name}`,
    detail: `ID: ${l.id}\nCoords: ${l.latitude}, ${l.longitude}\nTime: ${new Date(l.timestamp).toLocaleString()}`,
    color: "36",
  }));
}

async function fetchPhotos(ctx: CommandContext): Promise<ContentItem[]> {
  const data = await requestClientJson(ctx, "/v1/photos?limit=10", { method: "GET" }) as { photos: Array<{ id: string; description: string; timestamp: number }> };
  if (!data.photos || data.photos.length === 0) return [{ title: "(no photos)", color: "90" }];
  return data.photos.map(p => ({
    title: `${p.description.slice(0, 50)}`,
    detail: `ID: ${p.id}\nTime: ${new Date(p.timestamp).toLocaleString()}\n\n${p.description}`,
    color: "36",
  }));
}

type Pane = "menu" | "content";

export async function startDashboard(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("Dashboard requires an interactive terminal (TTY).");
    process.exitCode = 1;
    return;
  }

  let menuIndex = 0;
  let contentIndex = 0;
  let contentScroll = 0;
  let contentItems: ContentItem[] = [];
  let expandedIndex: number | null = null;
  let activePane: Pane = "menu";
  let loading = false;

  const ctx = await createCommandContext("prod");

  const render = () => {
    const cols = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    const contentMaxWidth = cols - MENU_COL_WIDTH - 4;
    const maxBodyRows = rows - 4;

    process.stdout.write("\x1b[H\x1b[2J");

    // Header
    const menuHighlight = activePane === "menu" ? "\x1b[1;37m" : "\x1b[90m";
    const contentHighlight = activePane === "content" ? "\x1b[1;37m" : "\x1b[90m";
    process.stdout.write(`\u{1F41D} ${menuHighlight}Bee Dashboard\x1b[0m  ${contentHighlight}│ Content\x1b[0m  \x1b[90mTab switch  ↑↓ navigate  Enter expand  q quit\x1b[0m\n`);
    process.stdout.write(`\x1b[90m${"─".repeat(cols)}\x1b[0m\n`);

    // Build content lines
    const contentLines: string[] = [];
    if (contentItems.length === 0) {
      contentLines.push("\x1b[90mPress Enter to load...\x1b[0m");
    } else {
      for (let i = 0; i < contentItems.length; i++) {
        const item = contentItems[i]!;
        const isSelected = activePane === "content" && i === contentIndex;
        const prefix = isSelected ? "\x1b[36;1m ▸ " : `\x1b[${item.color ?? "37"}m   `;
        contentLines.push(`${prefix}${item.title}\x1b[0m`);

        if (expandedIndex === i && item.detail) {
          const detailLines = item.detail.split("\n");
          for (const dl of detailLines) {
            contentLines.push(`\x1b[90m     ${dl}\x1b[0m`);
          }
          contentLines.push("");
        }
      }
    }

    // Apply scroll to content
    const visibleContent = contentLines.slice(contentScroll, contentScroll + maxBodyRows);
    const totalRows = Math.max(MENU_ITEMS.length, visibleContent.length);

    for (let i = 0; i < Math.min(totalRows, maxBodyRows); i++) {
      let menuCell = "";
      if (i < MENU_ITEMS.length) {
        const item = MENU_ITEMS[i]!;
        if (i === menuIndex) {
          const highlight = activePane === "menu" ? "\x1b[36;1m" : "\x1b[37m";
          menuCell = `${highlight} ▸ ${item.label}\x1b[0m`;
        } else {
          menuCell = `\x1b[90m   ${item.label}\x1b[0m`;
        }
      }

      const contentCell = i < visibleContent.length ? truncateVisible(visibleContent[i] ?? "", contentMaxWidth) : "";
      process.stdout.write(`${padVisible(menuCell, MENU_COL_WIDTH)} \x1b[90m│\x1b[0m ${contentCell}\n`);
    }

    // Footer
    process.stdout.write(`\x1b[90m${"─".repeat(cols)}\x1b[0m\n`);
    if (loading) {
      process.stdout.write(` \x1b[33m⟳ Loading...\x1b[0m\n`);
    } else {
      const paneLabel = activePane === "menu" ? "Menu" : "Content";
      const itemCount = contentItems.length > 0 ? `${contentItems.length} items` : "empty";
      const scrollInfo = contentLines.length > maxBodyRows ? ` scroll ${contentScroll + 1}/${contentLines.length}` : "";
      process.stdout.write(` \x1b[32m●\x1b[0m \x1b[90m${MENU_ITEMS[menuIndex]!.label} | ${paneLabel} | ${itemCount}${scrollInfo}\x1b[0m\n`);
    }
  };

  const loadContent = async () => {
    loading = true;
    expandedIndex = null;
    contentIndex = 0;
    contentScroll = 0;
    render();
    try {
      contentItems = await MENU_ITEMS[menuIndex]!.fetch(ctx);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      contentItems = [{ title: `Error: ${msg}`, color: "31" }];
    }
    loading = false;
    render();
  };

  process.stdout.write("\x1b[?25l");
  render();

  // Re-render on terminal resize
  process.stdout.on("resize", () => render());

  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const cleanup = () => {
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.removeAllListeners("resize");
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\x1b[H\x1b[2J");
  };

  stdin.on("data", async (key: string) => {
    if (key === "q" || key === "\x03") {
      cleanup();
      process.exit(0);
    }

    // Tab - switch panes
    if (key === "\t") {
      activePane = activePane === "menu" ? "content" : "menu";
      render();
      return;
    }

    // Escape - collapse expanded or switch to menu
    if (key === "\x1b" && expandedIndex !== null) {
      expandedIndex = null;
      render();
      return;
    }
    if (key === "\x1b") {
      activePane = "menu";
      render();
      return;
    }

    // Arrow up
    if (key === "\x1b[A" || key === "k") {
      if (activePane === "menu") {
        menuIndex = (menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
      } else {
        if (contentIndex > 0) contentIndex--;
        adjustScroll();
      }
      render();
      return;
    }

    // Arrow down
    if (key === "\x1b[B" || key === "j") {
      if (activePane === "menu") {
        menuIndex = (menuIndex + 1) % MENU_ITEMS.length;
      } else {
        if (contentIndex < contentItems.length - 1) contentIndex++;
        adjustScroll();
      }
      render();
      return;
    }

    // Enter
    if (key === "\r" || key === "\n") {
      if (activePane === "menu") {
        await loadContent();
        activePane = "content";
        render();
      } else {
        if (contentItems[contentIndex]?.detail) {
          expandedIndex = expandedIndex === contentIndex ? null : contentIndex;
          render();
        }
      }
      return;
    }

    // Arrow right - switch to content
    if (key === "\x1b[C" || key === "l") {
      if (activePane === "menu" && contentItems.length > 0) {
        activePane = "content";
        render();
      }
      return;
    }

    // Arrow left - switch to menu
    if (key === "\x1b[D" || key === "h") {
      activePane = "menu";
      expandedIndex = null;
      render();
      return;
    }
  });

  function adjustScroll() {
    const rows = process.stdout.rows ?? 24;
    const maxBodyRows = rows - 4;
    let linesBefore = 0;
    for (let i = 0; i < contentIndex; i++) {
      linesBefore++;
      if (expandedIndex === i && contentItems[i]?.detail) {
        linesBefore += contentItems[i]!.detail!.split("\n").length + 1;
      }
    }
    if (linesBefore < contentScroll) contentScroll = linesBefore;
    if (linesBefore >= contentScroll + maxBodyRows) contentScroll = linesBefore - maxBodyRows + 1;
  }
}
