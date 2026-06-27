import type { Command } from "@/commands/types";
import { BeeError } from "@/errors";
import { resolveOutputFormat } from "@/utils/format";
import { loadToken } from "@/secureStore";
import { validateCommand, setCommandRegistry } from "@/commands/validate";
import { activityCommand } from "@/commands/activity";
import { conversationsCommand } from "@/commands/conversations";
import { dailyCommand } from "@/commands/daily";
import { changedCommand } from "@/commands/changed";
import { factsCommand } from "@/commands/facts";
import { insightsCommand } from "@/commands/insights";
import { journalsCommand } from "@/commands/journals";
import { locationsCommand } from "@/commands/locations";
import { loginCommand } from "@/commands/login";
import { logoutCommand } from "@/commands/logout";
import { meCommand } from "@/commands/me";
import { mcpCommand } from "@/commands/mcp";
import { nowCommand } from "@/commands/now";
import { pingCommand } from "@/commands/ping";
import { photosCommand } from "@/commands/photos";
import { proxyCommand } from "@/commands/proxy";
import { searchCommand } from "@/commands/search";
import { statusCommand } from "@/commands/status";
import { streamCommand } from "@/commands/stream";
import { syncCommand } from "@/commands/sync";
import { todosCommand } from "@/commands/todos";
import { todayCommand } from "@/commands/today";
import { versionCommand } from "@/commands/version";
import type { Environment } from "@/environment";
import { createCommandContext } from "@/context";
import { startDashboard } from "@/tui/dashboard";

const BIN = "bee";

const commands = [
  loginCommand,
  logoutCommand,
  mcpCommand,
  statusCommand,
  activityCommand,
  todayCommand,
  nowCommand,
  changedCommand,
  conversationsCommand,
  dailyCommand,
  factsCommand,
  insightsCommand,
  journalsCommand,
  locationsCommand,
  meCommand,
  photosCommand,
  searchCommand,
  streamCommand,
  syncCommand,
  proxyCommand,
  todosCommand,
  validateCommand,
  pingCommand,
  versionCommand,
] satisfies readonly Command[];

setCommandRegistry(commands);

const commandIndex = new Map<string, Command>();
for (const command of commands) {
  commandIndex.set(command.name, command);
  if (command.aliases) {
    for (const alias of command.aliases) {
      commandIndex.set(alias, command);
    }
  }
}

function isHelpFlag(value: string): boolean {
  return value === "-h" || value === "--help";
}

function printHelp(): void {
  console.log(`${BIN} <command> [options]`);
  console.log("");
  console.log("Commands:");

  for (const command of commands) {
    const aliasText = command.aliases && command.aliases.length > 0
      ? ` (aliases: ${command.aliases.join(", ")})`
      : "";
    console.log(`  ${command.name}  ${command.description}${aliasText}`);
  }

  console.log(`  dashboard  Interactive TUI dashboard (alias: ui)`);
  console.log("");
  console.log(`Run \"${BIN} <command> --help\" for command-specific help.`);
}

function printCommandHelp(command: Command): void {
  console.log(command.usage);
  console.log("");
  console.log(command.description);
}

async function runCli(): Promise<void> {
  const parsed = parseGlobalArgs(process.argv.slice(2));
  const args = parsed.args;
  const firstArg = args[0];

  if (!firstArg || isHelpFlag(firstArg)) {
    printHelp();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    const context = await createCommandContext(parsed.env);
    await versionCommand.run([], context);
    return;
  }

  if (firstArg === "dashboard" || firstArg === "ui") {
    await startDashboard();
    return;
  }

  if (firstArg === "--describe") {
    const { RESOURCES } = await import("@/resources");
    const token = await loadToken(parsed.env);
    const blob = {
      version: "0.7.1",
      auth_status: token ? "valid" : "unauthenticated",
      commands: buildDescribeBlob(RESOURCES),
    };
    console.log(JSON.stringify(blob, null, 2));
    return;
  }

  const commandName = firstArg;
  const command = commandIndex.get(commandName);

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const commandArgs = args.slice(1);
  if (commandArgs.some(isHelpFlag)) {
    printCommandHelp(command);
    return;
  }

  try {
    const context = await createCommandContext(parsed.env);
    await command.run(commandArgs, context);
  } catch (error) {
    const { format } = resolveOutputFormat(commandArgs);
    if (error instanceof BeeError) {
      if (format === "text") {
        console.error(error.message);
        printCommandHelp(command);
      } else {
        console.error(JSON.stringify({
          error: error.message,
          code: error.exitCode,
          recoverable: error.recoverable,
          suggestion: error.suggestion,
        }));
      }
      process.exitCode = error.exitCode;
    } else {
      const msg = error instanceof Error ? error.message : "Unexpected error";
      if (format === "text") {
        console.error(msg);
        printCommandHelp(command);
      } else {
        console.error(JSON.stringify({ error: msg, code: 1, recoverable: false }));
      }
      process.exitCode = 1;
    }
  }
}

void runCli();

function parseGlobalArgs(args: readonly string[]): { env: Environment; args: string[] } {
  let env: Environment = "prod";
  const remaining: string[] = [];

  for (const arg of args) {
    if (arg === "--staging") {
      env = "staging";
      continue;
    }
    remaining.push(arg);
  }

  return { env, args: remaining };
}

function buildDescribeBlob(resources: readonly import("@/resources/types").ResourceModule[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const resource of resources) {
    const cliActions = resource.actions.filter(a => a.cli !== undefined);
    if (cliActions.length === 0) continue;

    for (const action of cliActions) {
      const cli = action.cli!;
      const key = cli.subcommand
        ? `${resource.cliCommand.name} ${cli.subcommand}`
        : resource.cliCommand.name;

      const args: Array<{ name: string; type: string; required?: boolean }> = [];

      if (cli.positionals) {
        for (const pos of cli.positionals) {
          args.push({ name: pos.name, type: "positional", required: pos.required });
        }
      }

      for (const flag of cli.flags) {
        args.push({ name: flag.name, type: flag.kind });
      }

      const hasSideEffects = action.mcp?.name?.includes("create") ||
        action.mcp?.name?.includes("update") ||
        action.mcp?.name?.includes("delete");

      result[key] = {
        description: action.mcp?.description ?? resource.cliCommand.description,
        args,
        side_effects: hasSideEffects ?? false,
        requires_auth: true,
      };
    }
  }

  // Add non-resource commands
  result["validate"] = { description: "Pre-validate a command without executing", args: [{ name: "command", type: "positional", required: true }], side_effects: false, requires_auth: false };
  result["dashboard"] = { description: "Interactive TUI dashboard", args: [], side_effects: false, requires_auth: true };
  result["stream"] = { description: "Stream real-time events (SSE)", args: [{ name: "--types", type: "string" }, { name: "--json", type: "bool" }, { name: "--agent", type: "bool" }], side_effects: false, requires_auth: true };
  result["sync"] = { description: "Export data to markdown files", args: [{ name: "--output", type: "string" }, { name: "--only", type: "string" }], side_effects: false, requires_auth: true };
  result["mcp"] = { description: "Start MCP server for AI agents", args: [], side_effects: false, requires_auth: true };

  return result;
}
