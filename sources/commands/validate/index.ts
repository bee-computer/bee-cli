import type { Command, CommandContext } from "@/commands/types";
import { loadToken } from "@/secureStore";

const USAGE = "bee validate <command> [subcommand] [--flags...]";

export const validateCommand: Command = {
  name: "validate",
  description: "Pre-validate a command without executing it.",
  usage: USAGE,
  run: async (args, context) => {
    await handleValidate(args, context);
  },
};

let registeredCommands: readonly Command[] = [];

export function setCommandRegistry(cmds: readonly Command[]): void {
  registeredCommands = cmds;
}

async function handleValidate(
  args: readonly string[],
  context: CommandContext
): Promise<void> {
  if (args.length === 0) {
    console.log(JSON.stringify({ valid: false, reason: "No command specified", code: 3 }));
    process.exitCode = 3;
    return;
  }

  const [commandName] = args;

  const command = registeredCommands.find(c => c.name === commandName);
  if (!command) {
    console.log(JSON.stringify({ valid: false, reason: `Unknown command: ${commandName}`, code: 3 }));
    process.exitCode = 3;
    return;
  }

  if (!context.client.isProxy) {
    const token = await loadToken(context.env);
    if (!token) {
      console.log(JSON.stringify({ valid: false, reason: "Not authenticated", code: 2 }));
      process.exitCode = 2;
      return;
    }
  }

  console.log(JSON.stringify({ valid: true }));
}
