import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { CommandContext } from "@/commands/types";
import {
  StreamHttpError,
  isTransientStreamError,
  reconnectDelayMs,
  streamWithReconnect,
} from "./index";

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

function contextWith(fetch: Fetch): CommandContext {
  // isProxy skips the stored-token lookup.
  return { env: "prod", client: { isProxy: true, fetch } } as unknown as CommandContext;
}

function sequence(responses: Array<() => Response>): { fetch: Fetch; calls: () => number } {
  let calls = 0;
  const fetch: Fetch = async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    return next();
  };
  return { fetch, calls: () => calls };
}

const streamThatEnds = () =>
  new Response(new ReadableStream({ start: (controller) => controller.close() }), { status: 200 });
const status = (code: number) => () => new Response("nope", { status: code });

describe("stream reconnect", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  it("backs off 1s, 2s, 4s ... and caps at 30s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("retries dropped connections, server errors, 408 and 429, but not other client errors", () => {
    for (const code of [500, 502, 503, 408, 429]) {
      expect(isTransientStreamError(new StreamHttpError(code, ""))).toBe(true);
    }
    for (const code of [400, 401, 403, 404]) {
      expect(isTransientStreamError(new StreamHttpError(code, ""))).toBe(false);
    }
    expect(isTransientStreamError(new Error("The operation timed out."))).toBe(true);
  });

  it("reconnects after the stream ends and after a 503, then stops on a 401", async () => {
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    const stdout = spyOn(console, "log").mockImplementation(() => {});
    spies.push(stderr, stdout);
    const { fetch, calls } = sequence([streamThatEnds, status(503), status(401)]);
    const waits: number[] = [];

    const run = streamWithReconnect({ format: "json" }, contextWith(fetch), new AbortController().signal, async (ms) => {
      waits.push(ms);
    });

    await expect(run).rejects.toBeInstanceOf(StreamHttpError);
    expect(calls()).toBe(3);
    expect(waits).toEqual([1000, 2000]);
    expect(stderr.mock.calls.map((call) => call[0])).toEqual([
      "Stream ended. Reconnecting in 1s (attempt 1).",
      "Stream error: Stream failed: 503 nope. Reconnecting in 2s (attempt 2).",
    ]);
    // JSON output stays parseable: reconnect notices never touch stdout.
    expect(stdout).not.toHaveBeenCalled();
  });

  it("stops when interrupted while connected", async () => {
    const stop = new AbortController();
    let calls = 0;
    const fetch: Fetch = async () => {
      calls += 1;
      stop.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    };

    await streamWithReconnect({ format: "json" }, contextWith(fetch), stop.signal, async () => {
      throw new Error("should not wait after an interrupt");
    });

    expect(calls).toBe(1);
  });

  it("stops when interrupted while waiting to reconnect", async () => {
    spies.push(spyOn(console, "error").mockImplementation(() => {}));
    const stop = new AbortController();
    const { fetch, calls } = sequence([streamThatEnds]);

    await streamWithReconnect({ format: "json" }, contextWith(fetch), stop.signal, async () => {
      stop.abort();
    });

    expect(calls()).toBe(1);
  });
});
