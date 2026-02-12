import { describe, expect, it } from "bun:test";
import { createBeeCliRunner } from "@/lib/runner";
import { createDataApi } from "@/lib/api";
import { createJsonSseStream } from "@/lib/sse";

const TEST_TIMEOUT_MS = 5000;

const NODE_BINARY =
  typeof Bun !== "undefined" ? Bun.which("node") ?? "node" : "node";

function createNodeRunner(script: string) {
  return createBeeCliRunner({
    command: NODE_BINARY,
    baseArgs: ["-e", script],
  });
}

describe("lib integration", () => {
  it(
    "runJson parses JSON output and passes args",
    async () => {
      const runner = createNodeRunner(
        'console.log(JSON.stringify({ ok: true, argv: process.argv.slice(1) }));'
      );

      const result = await runner.runJson<{ ok: boolean; argv: string[] }>([
        "arg1",
      ]);

      expect(result.ok).toBe(true);
      expect(result.argv).toEqual(["arg1", "--json"]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "run supports stdin",
    async () => {
      const runner = createNodeRunner(
        'process.stdin.setEncoding("utf8"); let data=""; process.stdin.on("data", (chunk) => { data += chunk; }); process.stdin.on("end", () => { console.log(data.toUpperCase()); });'
      );

      const result = await runner.run([], { stdin: "hello" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("HELLO");
    },
    TEST_TIMEOUT_MS
  );

  it(
    "data api builds CLI arguments",
    async () => {
      const runner = createNodeRunner(
        'console.log(JSON.stringify({ argv: process.argv.slice(1) }));'
      );
      const api = createDataApi(runner);

      const result = (await api.todos.list({
        limit: 2,
        cursor: "abc",
      })) as { argv: string[] };

      expect(result.argv).toEqual([
        "todos",
        "list",
        "--limit",
        "2",
        "--cursor",
        "abc",
        "--json",
      ]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "sse stream yields json lines",
    async () => {
      const runner = createNodeRunner(
        'const events=[{id:1},{id:2}]; let i=0; const timer=setInterval(() => { if (i >= events.length) { clearInterval(timer); process.exit(0); } else { console.log(JSON.stringify(events[i++])); } }, 10);'
      );

      const stream = createJsonSseStream<{ id: number }>(runner);
      const received: Array<{ id: number }> = [];

      for await (const event of stream.events) {
        received.push(event.data);
      }

      expect(received).toEqual([{ id: 1 }, { id: 2 }]);
    },
    TEST_TIMEOUT_MS
  );
});
