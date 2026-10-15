import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the CLI as a user would. Every case fails or prints help before any network call or login.
const configDir = mkdtempSync(join(tmpdir(), "bee-cli-main-"));
const repoRoot = join(import.meta.dir, "..");

function bee(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, "./sources/main.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, BEE_CONFIG_DIR: configDir, BEE_FORCE_FILE_STORE: "1" },
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), code: result.exitCode };
}

describe("where usage text goes", () => {
  afterAll(() => rmSync(configDir, { recursive: true, force: true }));

  it("prints requested help to stdout", () => {
    const top = bee("--help");
    expect(top.stdout).toContain("<command> [options]");
    expect(top.stderr).toBe("");
    expect(top.code).toBe(0);

    const stream = bee("stream", "--help");
    expect(stream.stdout).toContain("bee stream --json");
    expect(stream.code).toBe(0);
  });

  it("prints usage to stderr, not stdout, when the command is unknown", () => {
    const result = bee("no-such-command");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: no-such-command");
    expect(result.stderr).toContain("<command> [options]");
    expect(result.code).toBe(1);
  });

  it("prints usage to stderr, not stdout, when a command fails", () => {
    const result = bee("stream", "--no-such-option");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option: --no-such-option");
    expect(result.stderr).toContain("bee stream --json");
    expect(result.code).toBe(1);
  });
});
