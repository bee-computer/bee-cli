import type { CommandContext } from "@/commands/types";
import { beeConfigDir, beeLaunch } from "@/mcp/launch";
import { spawnSync } from "node:child_process";

const SERVER_NAME = "bee";

export function connectCodex(context: CommandContext): void {
  ensureCodex();
  const launch = beeLaunch(context);
  spawnCodex(["mcp", "remove", SERVER_NAME], false);
  const result = spawnCodex([
    "mcp",
    "add",
    "--env",
    "BEE_MCP_CLIENT=codex",
    "--env",
    `BEE_CONFIG_DIR=${beeConfigDir()}`,
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
  const result = spawnCodex(["mcp", "get", "--json", SERVER_NAME], false);
  console.log(result.status === 0 ? "Codex: connected" : "Codex: not connected");
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
