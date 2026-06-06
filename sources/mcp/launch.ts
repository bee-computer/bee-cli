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

// The config dir is only set via BEE_CONFIG_DIR; when it resolves to the default
// (~/.bee) there is nothing to propagate to a spawned MCP client.
export function customBeeConfigDir(): string | null {
  const explicit = process.env["BEE_CONFIG_DIR"] ?? Bun.env["BEE_CONFIG_DIR"];
  return explicit && explicit.trim().length > 0 ? explicit : null;
}

// On Windows the connector CLIs are spawned via the shell (so npm `.cmd` shims
// resolve), which joins the argv into a cmd.exe string without per-arg quoting.
// Reject values that could break out of an argument into shell syntax.
export function assertShellSafe(value: string, label: string): void {
  if (/[&|;<>^`"'()\r\n%!*?]/.test(value)) {
    throw new Error(`${label} contains characters that cannot be passed safely to the connector CLI.`);
  }
}

// Double-quote arguments containing whitespace so a shell-spawned command line
// does not word-split paths like "C:\Program Files\bee". assertShellSafe has
// already rejected quotes and shell metacharacters, so wrapping in quotes here
// is safe. No-op for arguments without whitespace.
export function quoteShellArg(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
