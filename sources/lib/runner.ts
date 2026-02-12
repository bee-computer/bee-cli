import type { BeeCliOptions, RunOptions, SpawnOptions } from "@/lib/types";

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type BeeCliRunner = {
  run: (args: string[], options?: RunOptions) => Promise<RunResult>;
  runJson: <T = unknown>(args: string[], options?: RunOptions) => Promise<T>;
  spawn: (args: string[], options?: SpawnOptions) => Bun.Subprocess;
};

export function createBeeCliRunner(options: BeeCliOptions = {}): BeeCliRunner {
  const command = options.command ?? "bee";
  const baseArgs = options.baseArgs ?? [];
  const environment = options.environment ?? "prod";
  const cwd = options.cwd;
  const customEnv = options.env;

  function buildArgs(args: string[]): string[] {
    const globalArgs = environment === "staging" ? ["--staging"] : [];
    return [...baseArgs, ...globalArgs, ...args];
  }

  function buildEnv(): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries(Bun.env)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    if (!customEnv) {
      return merged;
    }

    for (const [key, value] of Object.entries(customEnv)) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  function spawn(args: string[], spawnOptions: SpawnOptions = {}): Bun.Subprocess {
    const config: Bun.SpawnOptions.SpawnOptions<
      "pipe" | "inherit" | "ignore",
      "pipe" | "inherit" | "ignore",
      "pipe" | "inherit" | "ignore"
    > = {
      env: buildEnv(),
      stdout: spawnOptions.stdout ?? "pipe",
      stderr: spawnOptions.stderr ?? "pipe",
      stdin: spawnOptions.stdin ?? "inherit",
    };

    if (cwd) {
      config.cwd = cwd;
    }

    if (spawnOptions.signal) {
      config.signal = spawnOptions.signal;
    }

    return Bun.spawn([command, ...buildArgs(args)], config);
  }

  async function run(
    args: string[],
    runOptions: RunOptions = {}
  ): Promise<RunResult> {
    const inheritStdio = runOptions.inheritStdio ?? false;
    const spawnOptions: SpawnOptions = {
      stdout: inheritStdio ? "inherit" : "pipe",
      stderr: inheritStdio ? "inherit" : "pipe",
      stdin: runOptions.stdin !== undefined ? "pipe" : "inherit",
    };
    if (runOptions.signal) {
      spawnOptions.signal = runOptions.signal;
    }

    const proc = spawn(args, spawnOptions);

    if (runOptions.stdin !== undefined) {
      const stdin = proc.stdin;
      if (!stdin || typeof stdin === "number") {
        throw new Error("Failed to open stdin pipe for Bee CLI.");
      }
      stdin.write(runOptions.stdin);
      stdin.end();
    }

    const stdoutPromise = inheritStdio
      ? Promise.resolve("")
      : readStream(proc.stdout);
    const stderrPromise = inheritStdio
      ? Promise.resolve("")
      : readStream(proc.stderr);

    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    return { stdout, stderr, exitCode };
  }

  async function runJson<T>(
    args: string[],
    runOptions?: RunOptions
  ): Promise<T> {
    const jsonArgs = ensureJsonFlag(args);
    const result = await run(jsonArgs, runOptions);

    if (result.exitCode !== 0) {
      const message =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Bee CLI exited with code ${result.exitCode}.`;
      throw new Error(message);
    }

    const trimmed = result.stdout.trim();
    if (!trimmed) {
      return null as T;
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown JSON parse error";
      throw new Error(`Failed to parse Bee CLI JSON output: ${message}`);
    }
  }

  return { run, runJson, spawn };
}

function ensureJsonFlag(args: string[]): string[] {
  return args.includes("--json") ? [...args] : [...args, "--json"];
}

function readStream(
  stream: ReadableStream<Uint8Array> | number | null | undefined
): Promise<string> {
  if (!stream || typeof stream === "number") {
    return Promise.resolve("");
  }
  return new Response(stream).text();
}
