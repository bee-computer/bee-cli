import type { CommandContext } from "@/commands/types";
import { assertShellSafe, beeConfigDir, beeLaunch } from "@/mcp/launch";
import { spawnSync } from "node:child_process";

const SERVER_NAME = "bee";

export function connectCodex(context: CommandContext): void {
  ensureCodex();
  const launch = beeLaunch(context);
  const configDir = beeConfigDir();
  if (process.platform === "win32") {
    assertShellSafe(configDir, "BEE_CONFIG_DIR");
    assertShellSafe(launch.command, "Bee CLI path");
    launch.args.forEach((arg) => assertShellSafe(arg, "Bee CLI argument"));
  }
  spawnCodex(["mcp", "remove", SERVER_NAME], false);
  const result = spawnCodex([
    "mcp",
    "add",
    "--env",
    "BEE_MCP_CLIENT=codex",
    "--env",
    `BEE_CONFIG_DIR=${configDir}`,
    SERVER_NAME,
    "--",
    launch.command,
    ...launch.args,
  ], false);
  if (result.status !== 0) {
    throw new Error(outputText(result.stderr).trim() || result.error?.message || "Unable to connect Bee to Codex.");
  }
  echo(outputText(result.stdout));
  console.log("Bee MCP is connected to Codex.");
  console.log("Codex will use your existing Bee CLI login automatically.");
}

export function disconnectCodex(): void {
  ensureCodex();
  const result = spawnCodex(["mcp", "remove", SERVER_NAME], false);
  if (result.status !== 0) {
    throw new Error(outputText(result.stderr).trim() || result.error?.message || "Unable to remove Bee from Codex.");
  }
  echo(outputText(result.stdout));
  console.log("Bee MCP was removed from Codex.");
}

export function printCodexStatus(): void {
  const version = spawnCodex(["--version"], false);
  if (version.error || version.status === null || version.status !== 0) {
    console.log("  Codex: not installed");
    return;
  }
  const result = spawnCodex(["mcp", "get", "--json", SERVER_NAME], false);
  if (result.status !== 0) {
    console.log("  Codex: not connected");
    console.log("    Run: bee mcp connect codex");
    return;
  }
  console.log("  Codex: connected");
  const command = parseCodexCommand(outputText(result.stdout));
  if (command !== null) {
    console.log(`    Command: ${command}`);
  }
}

function parseCodexCommand(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const entry = SERVER_NAME in parsed
    ? (parsed as Record<string, unknown>)[SERVER_NAME]
    : parsed;
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const command = typeof record["command"] === "string" ? record["command"] : null;
  if (command === null) {
    return null;
  }
  const args = Array.isArray(record["args"])
    ? record["args"].filter((arg): arg is string => typeof arg === "string")
    : [];
  return `${command} ${args.join(" ")}`.trimEnd();
}

function ensureCodex(): void {
  const result = spawnCodex(["--version"], false);
  if (result.status !== 0) {
    throw new Error("Codex CLI was not found. Install Codex, then try again.");
  }
}

function spawnCodex(args: string[], inherit: boolean): ReturnType<typeof spawnSync> {
  return spawnSync("codex", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    shell: process.platform === "win32",
  });
}

function outputText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function echo(value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    console.log(trimmed);
  }
}
