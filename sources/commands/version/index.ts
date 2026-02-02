import type { Command } from "@/commands/types";
import { PACKAGE_NAME, VERSION } from "@/version";

const USAGE = "bee version [--json]";

function parseJsonFlag(args: readonly string[]): boolean {
  const positionals: string[] = [];
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
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

  return json;
}

export const versionCommand: Command = {
  name: "version",
  description: "Print the CLI version.",
  usage: USAGE,
  run: async (args, context) => {
    void context;
    const json = parseJsonFlag(args);

    if (json) {
      console.log(JSON.stringify({ name: PACKAGE_NAME, version: VERSION }));
      return;
    }

    console.log(`${PACKAGE_NAME} ${VERSION}`);
  }
};
