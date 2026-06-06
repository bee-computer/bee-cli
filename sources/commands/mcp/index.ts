import type { Command } from "@/commands/types";
import { serveMcpHttp, type McpHttpOptions } from "@/mcp/httpServer";
import { serveMcp } from "@/mcp/server";
import {
  connectClaudeCode,
  connectClaudeDesktop,
  disconnectClaudeCode,
  disconnectClaudeDesktop,
  printMcpStatus,
} from "@/mcp/claude";
import { connectCodex, disconnectCodex, printCodexStatus } from "@/mcp/codex";

const USAGE = [
  "bee mcp serve",
  "bee mcp serve-http --token VALUE [--port N]",
  "  (token may also be set via BEE_MCP_HTTP_TOKEN; required, at least 32 chars)",
  "bee mcp connect claude",
  "bee mcp connect claude-code",
  "bee mcp connect codex",
  "bee mcp disconnect claude",
  "bee mcp disconnect claude-code",
  "bee mcp disconnect codex",
  "bee mcp status",
].join("\n");

export const mcpCommand: Command = {
  name: "mcp",
  description: "Run or connect Bee MCP.",
  usage: USAGE,
  run: async (args, context) => {
    const [subcommand, ...remaining] = args;
    if (!subcommand) {
      throw new Error("Missing MCP subcommand.");
    }

    if (subcommand === "serve") {
      if (remaining.length > 0) {
        throw new Error("mcp serve does not accept arguments.");
      }
      await serveMcp(context);
      return;
    }

    if (subcommand === "serve-http") {
      await serveMcpHttp(context, parseServeHttpArgs(remaining));
      return;
    }

    if (subcommand === "connect") {
      const [target, ...rest] = remaining;
      if (rest.length > 0) {
        throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      }
      if (target === "claude") {
        await connectClaudeDesktop(context);
        return;
      }
      if (target === "claude-code") {
        connectClaudeCode(context);
        return;
      }
      if (target === "codex") {
        connectCodex(context);
        return;
      }
      throw new Error("Use claude, claude-code, or codex as the MCP connection target.");
    }

    if (subcommand === "disconnect") {
      const [target, ...rest] = remaining;
      if (rest.length > 0) {
        throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      }
      if (target === "claude-code") {
        disconnectClaudeCode();
        return;
      }
      if (target === "claude") {
        await disconnectClaudeDesktop();
        return;
      }
      if (target === "codex") {
        disconnectCodex();
        return;
      }
      throw new Error("Use claude, claude-code, or codex as the MCP disconnection target.");
    }

    if (subcommand === "status") {
      if (remaining.length > 0) {
        throw new Error("mcp status does not accept arguments.");
      }
      printMcpStatus(context);
      printCodexStatus();
      return;
    }

    throw new Error(`Unknown MCP subcommand: ${subcommand}`);
  },
};

function parseServeHttpArgs(args: readonly string[]): McpHttpOptions {
  let port: number | undefined;
  let token: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--port") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--port requires a value");
      }
      const parsed = /^\d+$/.test(value) ? Number.parseInt(value, 10) : NaN;
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
      port = parsed;
      i += 1;
      continue;
    }

    if (arg === "--token") {
      const value = args[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("--token requires a value");
      }
      token = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }

  const options: McpHttpOptions = {};
  if (port !== undefined) {
    options.port = port;
  }
  if (token !== undefined) {
    options.token = token;
  }
  return options;
}
