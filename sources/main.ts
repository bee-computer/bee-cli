import type { Command, CommandContext } from "@/commands/types";
import { createDeveloperClient } from "@/client";
import { conversationsCommand } from "@/commands/conversations";
import { dailyCommand } from "@/commands/daily";
import { factsCommand } from "@/commands/facts";
import { loginCommand } from "@/commands/login";
import { logoutCommand } from "@/commands/logout";
import { meCommand } from "@/commands/me";
import { pingCommand } from "@/commands/ping";
import { proxyCommand } from "@/commands/proxy";
import { searchCommand } from "@/commands/search";
import { statusCommand } from "@/commands/status";
import { streamCommand } from "@/commands/stream";
import { syncCommand } from "@/commands/sync";
import { todosCommand } from "@/commands/todos";
import { todayCommand } from "@/commands/today";
import { versionCommand } from "@/commands/version";
import type { Environment } from "@/environment";

const BIN = "bee";

const commands = [
  loginCommand,
  logoutCommand,
  statusCommand,
  todayCommand,
  conversationsCommand,
  dailyCommand,
  factsCommand,
  meCommand,
  searchCommand,
  streamCommand,
  syncCommand,
  proxyCommand,
  todosCommand,
  pingCommand,
  versionCommand,
] satisfies readonly Command[];

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
  const context = createContext(parsed.env);

  if (!firstArg || isHelpFlag(firstArg)) {
    printHelp();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    await versionCommand.run([], context);
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
    await command.run(commandArgs, context);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unexpected error");
    }
    printCommandHelp(command);
    process.exitCode = 1;
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

function createContext(env: Environment): CommandContext {
  return {
    env,
    client: createDeveloperClient(env),
  };
}
