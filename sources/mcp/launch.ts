import type { CommandContext } from "@/commands/types";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type BeeLaunch = {
  command: string;
  args: string[];
};

export function beeLaunch(context: CommandContext): BeeLaunch {
  const command = resolve(process.execPath);
  const args: string[] = [];
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  if (basename(entry) === "main.ts" && basename(dirname(entry)) === "sources") {
    args.push(entry);
  }
  if (context.env === "staging") {
    args.push("--staging");
  }
  args.push("mcp", "serve");
  return { command, args };
}

export function beeConfigDir(): string {
  return process.env["BEE_CONFIG_DIR"] ?? Bun.env["BEE_CONFIG_DIR"] ?? join(homedir(), ".bee");
}
