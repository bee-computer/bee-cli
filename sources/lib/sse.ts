import type { BeeCliRunner, BeeSubprocess } from "@/lib/runner";

type JsonSseOptions = {
  types?: string[];
  signal?: AbortSignal;
};

export type JsonSseEvent<T = unknown> = {
  data: T;
  raw: string;
};

export type JsonSseStream<T = unknown> = {
  events: AsyncIterable<JsonSseEvent<T>>;
  close: () => void;
  process: BeeSubprocess;
};

export type SseApi = {
  streamJson: <T = unknown>(options?: JsonSseOptions) => JsonSseStream<T>;
};

export function createSseApi(runner: BeeCliRunner): SseApi {
  return {
    streamJson: <T = unknown>(options?: JsonSseOptions) =>
      createJsonSseStream<T>(runner, options),
  };
}

export function createJsonSseStream<T = unknown>(
  runner: BeeCliRunner,
  options: JsonSseOptions = {}
): JsonSseStream<T> {
  const args = ["stream", "--json"];
  if (options.types && options.types.length > 0) {
    args.push("--types", options.types.join(","));
  }

  const spawnOptions: {
    stdout: "pipe";
    stderr: "pipe";
    stdin: "ignore";
    signal?: AbortSignal;
  } = {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  };
  if (options.signal) {
    spawnOptions.signal = options.signal;
  }

  const process = runner.spawn(args, spawnOptions);

  const stderrPromise = readStream(process.stderr);

  const events = (async function* (): AsyncIterable<JsonSseEvent<T>> {
    if (!process.stdout) {
      throw new Error("Bee CLI stream has no stdout.");
    }

    try {
      const iterator = getStreamIterator(process.stdout);
      let buffer = "";

      for await (const chunk of iterator) {
        buffer += chunkToString(chunk);

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          yield parseJsonLine<T>(trimmed);
        }
      }

      const remaining = buffer.trim();
      if (remaining) {
        yield parseJsonLine<T>(remaining);
      }

      const exitCode = await process.exited;
      if (exitCode !== 0) {
        const stderr = (await stderrPromise).trim();
        throw new Error(
          stderr || `Bee CLI stream exited with code ${exitCode}.`
        );
      }
    } finally {
      try {
        process.kill();
      } catch {
        // Ignore already-exited processes.
      }
    }
  })();

  const close = () => {
    try {
      process.kill();
    } catch {
      // Ignore already-exited processes.
    }
  };

  return { events, close, process };
}

function parseJsonLine<T>(line: string): JsonSseEvent<T> {
  try {
    const data = JSON.parse(line) as T;
    return { data, raw: line };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid JSON from bee stream: ${message}`);
  }
}

function readStream(
  stream: { on: (event: string, listener: (...args: unknown[]) => void) => void; setEncoding?: (encoding: BufferEncoding) => unknown } | null | undefined
): Promise<string> {
  if (!stream) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    let data = "";
    if (stream.setEncoding) {
      stream.setEncoding("utf8");
    }
    stream.on("data", (chunk) => {
      data += chunkToString(chunk);
    });
    stream.on("error", (error) => {
      reject(error);
    });
    stream.on("end", () => {
      resolve(data);
    });
  });
}

function getStreamIterator(
  stream: {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  }
): AsyncIterable<unknown> {
  if (stream[Symbol.asyncIterator]) {
    return stream as AsyncIterable<unknown>;
  }

  return {
    async *[Symbol.asyncIterator]() {
      const queue: unknown[] = [];
      let done = false;
      let error: unknown | null = null;
      let notify: (() => void) | null = null;

      stream.on?.("data", (chunk) => {
        queue.push(chunk);
        if (notify) {
          notify();
          notify = null;
        }
      });

      stream.on?.("end", () => {
        done = true;
        if (notify) {
          notify();
          notify = null;
        }
      });

      stream.on?.("error", (err) => {
        error = err;
        if (notify) {
          notify();
          notify = null;
        }
      });

      while (!done || queue.length > 0) {
        if (error) {
          throw error;
        }
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          continue;
        }
        yield queue.shift();
      }
    },
  };
}

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }
  if (chunk instanceof Uint8Array) {
    return new TextDecoder().decode(chunk);
  }
  return String(chunk);
}
