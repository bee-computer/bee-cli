import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CommandContext } from "@/commands/types";
import type { Environment } from "@/environment";
import { createProxyClient } from "@/client";
import { syncCommand, __testing } from "@/commands/sync";

type BunServer = ReturnType<typeof Bun.serve>;

const activeServers: BunServer[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true);
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
  process.exitCode = 0;
});

beforeEach(() => {
  process.exitCode = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bee-sync-test-"));
  tempDirs.push(dir);
  return dir;
}

type RequestRecord = { method: string; pathname: string; search: string };

function proxyContext(
  handler: (request: Request) => Response | Promise<Response>,
  env: Environment = "prod"
): { context: CommandContext; requests: RequestRecord[] } {
  const requests: RequestRecord[] = [];
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push({ method: request.method, pathname: url.pathname, search: url.search });
      return handler(request);
    },
  });
  activeServers.push(upstream);
  return {
    requests,
    context: {
      env,
      client: createProxyClient(env, { address: `http://127.0.0.1:${upstream.port}` }),
    },
  };
}

// ---- mock data builders ----------------------------------------------------

function changesResponse(
  overrides: Partial<{
    dailies: number[];
    conversations: number[];
    facts: number[];
    todos: number[];
    journals: string[];
    since: number;
    until: number;
    updated: boolean;
    next_cursor: string | null;
  }> = {}
): Response {
  return Response.json({
    facts: overrides.facts ?? [],
    todos: overrides.todos ?? [],
    dailies: overrides.dailies ?? [],
    conversations: overrides.conversations ?? [],
    journals: overrides.journals ?? [],
    since: overrides.since ?? 0,
    until: overrides.until ?? 1_000_000_000_000,
    updated: overrides.updated ?? true,
    next_cursor: overrides.next_cursor ?? null,
  });
}

function dailyDetail(id: number, dateTime = 1_700_000_000_000): Response {
  return Response.json({
    daily_summary: {
      id,
      date: null,
      date_time: dateTime,
      timezone: "UTC",
      short_summary: `daily ${id}`,
      summary: null,
      email_summary: null,
      calendar_summary: null,
      conversations_count: 0,
      locations: null,
      created_at: dateTime,
      conversations: null,
    },
  });
}

function conversationDetailShape(id: number, startTime = 1_700_000_000_000) {
  return {
    id,
    start_time: startTime,
    end_time: null,
    timezone: "UTC",
    device_type: "phone",
    summary: null,
    short_summary: `conv ${id}`,
    state: "COMPLETED",
    created_at: startTime,
    updated_at: startTime,
    transcriptions: [],
    suggested_links: [],
    primary_location: null,
  };
}

function emptyListResponse(key: string): Response {
  return Response.json({ [key]: [], next_cursor: null });
}

function readManifest(outputDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(outputDir, ".bee-sync.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function writeManifest(outputDir: string, manifest: Record<string, unknown>): void {
  writeFileSync(path.join(outputDir, ".bee-sync.json"), JSON.stringify(manifest), "utf8");
}

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    env: "prod",
    account: "proxy",
    cursors: {},
    pending: { daily: [], conversations: [] },
    lastFullSyncAtMs: 0,
    lastSyncAtMs: 0,
    ...overrides,
  };
}

// A handler that serves list/detail endpoints generically. dailyIds/convIds are
// the ids returned by the FULL list crawl.
function fullCrawlHandler(opts: {
  dailyIds?: number[];
  convIds?: number[];
  changesUntil?: number;
  onRequest?: (request: Request) => void;
}): (request: Request) => Response | Promise<Response> {
  const dailyIds = opts.dailyIds ?? [];
  const convIds = opts.convIds ?? [];
  return async (request) => {
    opts.onRequest?.(request);
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === "/v1/changes") {
      return changesResponse({ until: opts.changesUntil ?? 1_000_000_000_000 });
    }
    if (p === "/v1/facts") {
      return emptyListResponse("facts");
    }
    if (p === "/v1/todos") {
      return emptyListResponse("todos");
    }
    if (p === "/v1/daily") {
      return Response.json({
        daily_summaries: dailyIds.map((id) => ({
          id,
          date: null,
          date_time: 1_700_000_000_000,
          timezone: "UTC",
          short_summary: `daily ${id}`,
          summary: null,
          email_summary: null,
          calendar_summary: null,
          conversations_count: 0,
          locations: null,
          created_at: 1_700_000_000_000,
        })),
        next_cursor: null,
      });
    }
    if (p === "/v1/conversations") {
      return Response.json({
        conversations: convIds.map((id) => ({
          id,
          start_time: 1_700_000_000_000,
          created_at: 1_700_000_000_000,
          timezone: "UTC",
        })),
        next_cursor: null,
      });
    }
    if (p.startsWith("/v1/daily/")) {
      const id = Number(p.slice("/v1/daily/".length));
      return dailyDetail(id);
    }
    if (p === "/v1/conversations/batch") {
      const body = (await request.json()) as { ids: number[] };
      return Response.json({
        conversations: body.ids.map((id) => conversationDetailShape(id)),
      });
    }
    if (p.startsWith("/v1/conversations/")) {
      const id = Number(p.slice("/v1/conversations/".length));
      return Response.json({ conversation: conversationDetailShape(id) });
    }
    return Response.json({});
  };
}

// ===========================================================================
// Unit: manifest, cursor, parsing, fingerprint
// ===========================================================================

describe("sync unit helpers", () => {
  it("readSyncManifest returns null for absent / bad files and mismatches", async () => {
    const dir = await makeTempDir();
    // absent
    expect(__testing.readSyncManifest(dir, "prod", "proxy")).toBeNull();
    // unparseable
    writeFileSync(path.join(dir, ".bee-sync.json"), "{not json", "utf8");
    expect(__testing.readSyncManifest(dir, "prod", "proxy")).toBeNull();
    // wrong schema version
    writeManifest(dir, baseManifest({ schemaVersion: 2 }));
    expect(__testing.readSyncManifest(dir, "prod", "proxy")).toBeNull();
    // env mismatch
    writeManifest(dir, baseManifest({ env: "staging" }));
    expect(__testing.readSyncManifest(dir, "prod", "proxy")).toBeNull();
    // account mismatch
    writeManifest(dir, baseManifest({ account: "other" }));
    expect(__testing.readSyncManifest(dir, "prod", "proxy")).toBeNull();
  });

  it("readSyncManifest drops a non-v1 / non-finite cursor", async () => {
    const dir = await makeTempDir();
    writeManifest(dir, baseManifest({ cursors: { daily: "x-1", conversations: "v1-abc" } }));
    const m = __testing.readSyncManifest(dir, "prod", "proxy");
    expect(m).not.toBeNull();
    expect(m?.cursors.daily).toBeUndefined();
    expect(m?.cursors.conversations).toBeUndefined();
  });

  it("readSyncManifest accepts a valid manifest with usable cursors and pending", async () => {
    const dir = await makeTempDir();
    writeManifest(
      dir,
      baseManifest({
        cursors: { daily: "v1-100", conversations: "v1-200" },
        pending: { daily: [1, 2], conversations: [3] },
      })
    );
    const m = __testing.readSyncManifest(dir, "prod", "proxy");
    expect(m?.cursors.daily).toBe("v1-100");
    expect(m?.cursors.conversations).toBe("v1-200");
    expect(m?.pending.daily).toEqual([1, 2]);
    expect(m?.pending.conversations).toEqual([3]);
  });

  it("writeSyncManifest writes atomically (no leftover temp) and is readable", async () => {
    const dir = await makeTempDir();
    await __testing.writeSyncManifest(dir, {
      schemaVersion: 1,
      env: "prod",
      account: "proxy",
      cursors: { daily: "v1-5" },
      pending: { daily: [], conversations: [] },
      lastFullSyncAtMs: 0,
      lastSyncAtMs: 0,
    });
    expect(existsSync(path.join(dir, ".bee-sync.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".bee-sync.json.tmp"))).toBe(false);
    const m = __testing.readSyncManifest(dir, "prod", "proxy");
    expect(m?.cursors.daily).toBe("v1-5");
  });

  it("cursorEpochMs parses v1-<ms> and rejects malformed cursors", () => {
    expect(__testing.cursorEpochMs("v1-123")).toBe(123);
    expect(__testing.cursorEpochMs("v1-abc")).toBeNull();
    expect(__testing.cursorEpochMs("x-1")).toBeNull();
    expect(__testing.cursorEpochMs("v1-")).toBeNull();
  });

  it("persistCursor subtracts exactly the overlap margin", () => {
    expect(__testing.CHANGES_OVERLAP_MS).toBe(600000);
    expect(__testing.persistCursor(1_000_000)).toBe(`v1-${1_000_000 - 600000}`);
  });

  it("normalizeSinceCursor accepts epoch ms and v1 cursors, rejects junk", () => {
    expect(__testing.normalizeSinceCursor("12345")).toBe("v1-12345");
    expect(__testing.normalizeSinceCursor("v1-77")).toBe("v1-77");
    expect(__testing.normalizeSinceCursor("nope")).toBeNull();
  });

  it("parseSyncArgs accepts --full/--since and preserves --output/--only/--recent-days", () => {
    const opts = __testing.parseSyncArgs([
      "--output",
      "out",
      "--only",
      "daily,facts",
      "--recent-days",
      "7",
      "--full",
      "--since",
      "v1-99",
    ]);
    expect(opts.outputDir).toBe("out");
    expect(opts.full).toBe(true);
    expect(opts.since).toBe("v1-99");
    expect(opts.recentDays).toBe(7);
    expect([...opts.targets].sort()).toEqual(["daily", "facts"]);
  });

  it("parseSyncArgs rejects unknown flags and --since without a value", () => {
    expect(() => __testing.parseSyncArgs(["--nope"])).toThrow("Unknown option: --nope");
    expect(() => __testing.parseSyncArgs(["--since"])).toThrow("--since requires a value");
  });

  it("accountFingerprint returns 'proxy' for a proxy client", async () => {
    const { context } = proxyContext(() => Response.json({}));
    expect(await __testing.accountFingerprint(context)).toBe("proxy");
  });
});

// ===========================================================================
// Integration: completeness
// ===========================================================================

describe("sync incremental — completeness", () => {
  it("first run (no manifest): full crawls and seeds both cursors", async () => {
    const outputDir = await makeTempDir();
    const { context, requests } = proxyContext(
      fullCrawlHandler({ dailyIds: [10], convIds: [20], changesUntil: 5_000_000 })
    );

    await syncCommand.run(["--output", outputDir], context);

    // The seed changefeed call is made with NO cursor.
    const changeReqs = requests.filter((r) => r.pathname === "/v1/changes");
    expect(changeReqs.length).toBeGreaterThanOrEqual(1);
    expect(changeReqs.every((r) => r.search === "")).toBe(true);

    expect(existsSync(path.join(outputDir, "daily", "2023-11-14", "summary.md"))).toBe(true);
    expect(existsSync(path.join(outputDir, "conversations", "2023-11-14", "20.md"))).toBe(true);

    const manifest = readManifest(outputDir);
    const cursors = manifest["cursors"] as { daily?: string; conversations?: string };
    expect(cursors.daily).toBe(`v1-${5_000_000 - 600000}`);
    expect(cursors.conversations).toBe(`v1-${5_000_000 - 600000}`);
  });

  it("edit to an OLD item is caught with NO list `from` issued in incremental mode", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(
      outputDir,
      baseManifest({ cursors: { daily: cursor, conversations: cursor } })
    );

    const { context, requests } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") {
        return changesResponse({ conversations: [999], until: Date.now() });
      }
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/conversations/batch") {
        const body = (await request.json()) as { ids: number[] };
        return Response.json({
          conversations: body.ids.map((id) => conversationDetailShape(id, 1_500_000_000_000)),
        });
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "conversations"], context);

    // The old conversation 999 was re-fetched and rewritten.
    expect(existsSync(path.join(outputDir, "conversations", "2017-07-14", "999.md"))).toBe(true);
    // No list crawl issued in incremental mode.
    expect(requests.some((r) => r.pathname === "/v1/conversations")).toBe(false);
  });

  it("new item caught: changefeed id creates a new daily folder/file", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ dailies: [42], until: Date.now() });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p.startsWith("/v1/daily/")) return dailyDetail(42);
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(existsSync(path.join(outputDir, "daily", "2023-11-14", "summary.md"))).toBe(true);
  });

  it("boundary contiguity: next run requests the persisted cursor (until - margin)", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    const until = Date.now();
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    const manifest = readManifest(outputDir);
    const cursors = manifest["cursors"] as { daily?: string };
    expect(cursors.daily).toBe(`v1-${until - 600000}`);
  });

  it("per-item failure blocks cursor advance, persists pending, then self-heals", async () => {
    const outputDir = await makeTempDir();
    const initialCursor = `v1-${Date.now() - 60_000}`;
    writeManifest(
      outputDir,
      baseManifest({ cursors: { daily: initialCursor, conversations: initialCursor } })
    );

    // Run 1: daily detail 7 fails.
    let failDaily = true;
    const until1 = Date.now();
    const make = () =>
      proxyContext(async (request) => {
        const url = new URL(request.url);
        const p = url.pathname;
        if (p === "/v1/changes") return changesResponse({ dailies: [7], until: until1 });
        if (p === "/v1/facts") return emptyListResponse("facts");
        if (p === "/v1/todos") return emptyListResponse("todos");
        if (p.startsWith("/v1/daily/")) {
          if (failDaily) return Response.json({ error: "boom" }, { status: 500 });
          return dailyDetail(7);
        }
        return Response.json({});
      });

    const run1 = make();
    await syncCommand.run([
      "--output",
      outputDir,
      "--only",
      "daily",
    ], run1.context);

    let manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(initialCursor); // not advanced
    expect((manifest["pending"] as { daily: number[] }).daily).toEqual([7]);
    expect(process.exitCode).toBe(0); // per-item failure is not a hard error

    // Run 2: detail now succeeds; pending id 7 is unioned, file written, cursor advances.
    failDaily = false;
    const run2 = make();
    await syncCommand.run(["--output", outputDir, "--only", "daily"], run2.context);
    expect(
      run2.requests.some((r) => r.pathname === "/v1/daily/7")
    ).toBe(true);
    manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(`v1-${until1 - 600000}`);
    expect((manifest["pending"] as { daily: number[] }).daily).toEqual([]);
  });

  it("batch-omitted id is retried via per-id GET; still-missing blocks advance", async () => {
    const outputDir = await makeTempDir();
    const initialCursor = `v1-${Date.now() - 60_000}`;
    writeManifest(
      outputDir,
      baseManifest({ cursors: { daily: initialCursor, conversations: initialCursor } })
    );

    let perIdHit = false;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ conversations: [55], until: Date.now() });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/conversations/batch") {
        // Omit id 55 from the batch response.
        return Response.json({ conversations: [] });
      }
      if (p === "/v1/conversations/55") {
        perIdHit = true;
        return Response.json({ error: "still missing" }, { status: 404 });
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "conversations"], context);
    expect(perIdHit).toBe(true);
    const manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { conversations?: string }).conversations).toBe(initialCursor);
    expect((manifest["pending"] as { conversations: number[] }).conversations).toEqual([55]);
  });

  it("cursor_too_old falls back to an UNBOUNDED full crawl (no `from`) and reseeds", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    let dailyListSearch: string | null = null;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") {
        if (url.search.includes("cursor=")) {
          return Response.json({ error: "cursor_too_old" }, { status: 400 });
        }
        return changesResponse({ until: 9_000_000 }); // seed
      }
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/daily") {
        dailyListSearch = url.search;
        return Response.json({
          daily_summaries: [
            {
              id: 1,
              date: null,
              date_time: 1_700_000_000_000,
              timezone: "UTC",
              short_summary: "d1",
              summary: null,
              email_summary: null,
              calendar_summary: null,
              conversations_count: 0,
              locations: null,
              created_at: 1_700_000_000_000,
            },
          ],
          next_cursor: null,
        });
      }
      if (p.startsWith("/v1/daily/")) return dailyDetail(1);
      return Response.json({});
    });

    await syncCommand.run(
      ["--output", outputDir, "--only", "daily", "--recent-days", "3"],
      context
    );

    // Full crawl ran (list endpoint hit) and ignored --recent-days (no `from`).
    expect(dailyListSearch).not.toBeNull();
    expect(dailyListSearch as unknown as string).not.toContain("from=");
    const manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(`v1-${9_000_000 - 600000}`);
  });

  it("invalid_cursor falls back to a full crawl", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    let listHit = false;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") {
        if (url.search.includes("cursor=")) {
          return Response.json({ error: "invalid_cursor" }, { status: 400 });
        }
        return changesResponse({ until: 8_000_000 });
      }
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/daily") {
        listHit = true;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(listHit).toBe(true);
    const manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(`v1-${8_000_000 - 600000}`);
  });

  it("proactive staleness: a >6-day-old cursor takes the full path without sending it to the feed", async () => {
    const outputDir = await makeTempDir();
    const staleCursor = `v1-${Date.now() - 7 * 24 * 60 * 60 * 1000}`;
    writeManifest(
      outputDir,
      baseManifest({ cursors: { daily: staleCursor, conversations: staleCursor } })
    );

    const changeSearches: string[] = [];
    let listHit = false;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") {
        changeSearches.push(url.search);
        return changesResponse({ until: 7_000_000 });
      }
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/daily") {
        listHit = true;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(listHit).toBe(true);
    // The stale cursor was never sent to the feed; only the no-cursor seed call.
    expect(changeSearches.every((s) => s === "")).toBe(true);
  });

  it("--only conversations does not advance or clear the daily cursor/pending", async () => {
    const outputDir = await makeTempDir();
    const dailyCursor = `v1-${Date.now() - 60_000}`;
    const convCursor = `v1-${Date.now() - 60_000}`;
    writeManifest(
      outputDir,
      baseManifest({
        cursors: { daily: dailyCursor, conversations: convCursor },
        pending: { daily: [3, 4], conversations: [] },
      })
    );

    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: Date.now() });
      if (p === "/v1/conversations/batch") return Response.json({ conversations: [] });
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "conversations"], context);
    const manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(dailyCursor);
    expect((manifest["pending"] as { daily: number[] }).daily).toEqual([3, 4]);
  });

  it("env mismatch forces a full resync and rewrites env", async () => {
    const outputDir = await makeTempDir();
    // Prod manifest, but we run with staging context.
    writeManifest(
      outputDir,
      baseManifest({ env: "prod", cursors: { daily: `v1-${Date.now()}` } })
    );

    let listHit = false;
    const { context } = proxyContext((request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: 6_000_000 });
      if (p === "/v1/daily") {
        listHit = true;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      return Response.json({});
    }, "staging");

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(listHit).toBe(true);
    const manifest = readManifest(outputDir);
    expect(manifest["env"]).toBe("staging");
  });

  it("account mismatch forces a full resync", async () => {
    const outputDir = await makeTempDir();
    // Manifest claims a different account fingerprint than the proxy "proxy".
    writeManifest(
      outputDir,
      baseManifest({ account: "someotheraccount", cursors: { daily: `v1-${Date.now()}` } })
    );

    let listHit = false;
    const { context } = proxyContext((request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: 6_000_000 });
      if (p === "/v1/daily") {
        listHit = true;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(listHit).toBe(true);
    const manifest = readManifest(outputDir);
    expect(manifest["account"]).toBe("proxy");
  });

  it("crash before manifest write: next run re-scans the same window idempotently", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    const until = Date.now();
    const requestedCursors: string[] = [];
    const make = () =>
      proxyContext(async (request) => {
        const url = new URL(request.url);
        const p = url.pathname;
        if (p === "/v1/changes") {
          if (url.search.includes("cursor=")) {
            requestedCursors.push(url.searchParams.get("cursor") ?? "");
          }
          return changesResponse({ dailies: [88], until });
        }
        if (p === "/v1/facts") return emptyListResponse("facts");
        if (p === "/v1/todos") return emptyListResponse("todos");
        if (p.startsWith("/v1/daily/")) return dailyDetail(88);
        return Response.json({});
      });

    // Simulate a crash before manifest write by NOT advancing: we approximate by
    // running once (which writes a manifest) — to model the crash we instead
    // assert that re-running with the SAME stored cursor re-requests it.
    const r1 = make();
    await syncCommand.run(["--output", outputDir, "--only", "daily"], r1.context);
    // Restore the pre-run cursor to emulate a manifest that never got the advance.
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));
    const r2 = make();
    await syncCommand.run(["--output", outputDir, "--only", "daily"], r2.context);

    // Both incremental runs requested the same stored cursor.
    expect(requestedCursors.filter((c) => c === cursor).length).toBeGreaterThanOrEqual(2);
  });

  it("manifest is written only after detail writes resolve", async () => {
    const outputDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(outputDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));

    let manifestExistedDuringDetail = false;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ dailies: [5], until: Date.now() });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p.startsWith("/v1/daily/")) {
        // At the moment a detail is fetched, the advanced manifest must not yet
        // reflect this run (its cursor must still be the prior value).
        const m = readManifest(outputDir);
        if ((m["cursors"] as { daily?: string }).daily !== cursor) {
          manifestExistedDuringDetail = true;
        }
        return dailyDetail(5);
      }
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "daily"], context);
    expect(manifestExistedDuringDetail).toBe(false);
  });

  it("--full ignores the manifest and forces a full crawl", async () => {
    const outputDir = await makeTempDir();
    writeManifest(
      outputDir,
      baseManifest({ cursors: { daily: `v1-${Date.now()}`, conversations: `v1-${Date.now()}` } })
    );

    let listHit = false;
    const { context, requests } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: 4_000_000 });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/daily") {
        listHit = true;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      if (p === "/v1/conversations") return Response.json({ conversations: [], next_cursor: null });
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--full"], context);
    expect(listHit).toBe(true);
    // No incremental cursor changefeed call was made (only the no-cursor seed).
    expect(requests.filter((r) => r.pathname === "/v1/changes").every((r) => r.search === "")).toBe(
      true
    );
    const manifest = readManifest(outputDir);
    expect((manifest["cursors"] as { daily?: string }).daily).toBe(`v1-${4_000_000 - 600000}`);
  });
});

// ===========================================================================
// Regression: existing behavior preserved
// ===========================================================================

describe("sync regression", () => {
  it("byte-identical daily detail output between full and id (incremental) modes", async () => {
    // FULL mode output.
    const fullDir = await makeTempDir();
    const full = proxyContext(fullCrawlHandler({ dailyIds: [10], changesUntil: 1_000_000 }));
    await syncCommand.run(["--output", fullDir, "--only", "daily"], full.context);
    const fullFile = readFileSync(path.join(fullDir, "daily", "2023-11-14", "summary.md"), "utf8");

    // INCREMENTAL (id) mode output for the same id.
    const incDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(incDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));
    const inc = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ dailies: [10], until: Date.now() });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p.startsWith("/v1/daily/")) return dailyDetail(10);
      return Response.json({});
    });
    await syncCommand.run(["--output", incDir, "--only", "daily"], inc.context);
    const incFile = readFileSync(path.join(incDir, "daily", "2023-11-14", "summary.md"), "utf8");

    expect(incFile).toBe(fullFile);
  });

  it("byte-identical conversation output between full (batch) and id modes", async () => {
    const fullDir = await makeTempDir();
    const full = proxyContext(fullCrawlHandler({ convIds: [20], changesUntil: 1_000_000 }));
    await syncCommand.run(["--output", fullDir, "--only", "conversations"], full.context);
    const fullFile = readFileSync(
      path.join(fullDir, "conversations", "2023-11-14", "20.md"),
      "utf8"
    );

    const incDir = await makeTempDir();
    const cursor = `v1-${Date.now() - 60_000}`;
    writeManifest(incDir, baseManifest({ cursors: { daily: cursor, conversations: cursor } }));
    const inc = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ conversations: [20], until: Date.now() });
      if (p === "/v1/facts") return emptyListResponse("facts");
      if (p === "/v1/todos") return emptyListResponse("todos");
      if (p === "/v1/conversations/batch") {
        const body = (await request.json()) as { ids: number[] };
        return Response.json({
          conversations: body.ids.map((id) => conversationDetailShape(id)),
        });
      }
      return Response.json({});
    });
    await syncCommand.run(["--output", incDir, "--only", "conversations"], inc.context);
    const incFile = readFileSync(
      path.join(incDir, "conversations", "2023-11-14", "20.md"),
      "utf8"
    );

    expect(incFile).toBe(fullFile);
  });

  it("--only facts,todos gates targets (no daily/conversation requests)", async () => {
    const outputDir = await makeTempDir();
    const { context, requests } = proxyContext(fullCrawlHandler({}));
    await syncCommand.run(["--output", outputDir, "--only", "facts,todos"], context);

    expect(requests.some((r) => r.pathname === "/v1/daily")).toBe(false);
    expect(requests.some((r) => r.pathname === "/v1/conversations")).toBe(false);
    expect(existsSync(path.join(outputDir, "facts.md"))).toBe(true);
    expect(existsSync(path.join(outputDir, "todos.md"))).toBe(true);
  });

  it("--recent-days applies `from` on a user-requested full sync", async () => {
    const outputDir = await makeTempDir();
    let dailySearch: string | null = null;
    const { context } = proxyContext(async (request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: 1_000_000 });
      if (p === "/v1/daily") {
        dailySearch = url.search;
        return Response.json({ daily_summaries: [], next_cursor: null });
      }
      return Response.json({});
    });

    // No manifest exists -> first run is full and honors --recent-days.
    await syncCommand.run(
      ["--output", outputDir, "--only", "daily", "--recent-days", "5"],
      context
    );
    expect(dailySearch as unknown as string).toContain("from=");
  });

  it("a hard failure (top-level rejection) sets exitCode = 1", async () => {
    const outputDir = await makeTempDir();
    const { context } = proxyContext((request) => {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/v1/changes") return changesResponse({ until: 1_000_000 });
      if (p === "/v1/facts") return Response.json({ error: "facts blew up" }, { status: 500 });
      return Response.json({});
    });

    await syncCommand.run(["--output", outputDir, "--only", "facts"], context);
    expect(process.exitCode).toBe(1);
  });
});
