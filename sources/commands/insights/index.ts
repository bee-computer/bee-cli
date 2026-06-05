import type { Command } from "@/commands/types";
import {
  callBeeTextTool,
  parsePositiveInt,
  parseRequiredId,
  printToolData,
} from "@/commands/mcpToolOutput";
import { parseOutputFlag } from "@/utils/markdown";

const USAGE = [
  "bee insights list [--limit N] [--json]",
  "bee insights get <id> [--json]",
].join("\n");

export const insightsCommand: Command = {
  name: "insights",
  description: "List Bee insights.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use list.");
    }

    const [subcommand, ...rest] = args;
    const { format, args: remaining } = parseOutputFlag(rest);
    if (subcommand === "list") {
      const options = parseListArgs(remaining);
      const data = await callBeeTextTool(context, "bee_get_insights", {
        limit: options.limit,
      });
      printToolData("Insights", data, format);
      return;
    }
    if (subcommand === "get") {
      const id = parseSingleId(remaining, "insight id");
      const data = await callBeeTextTool(context, "bee_get_insight", { id });
      printToolData("Insight", data, format);
      return;
    }

    throw new Error(`Unknown insights subcommand: ${subcommand}`);
  },
};

type ListOptions = {
  limit?: number;
};

function parseListArgs(args: readonly string[]): ListOptions {
  const options: ListOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--limit") {
      options.limit = parsePositiveInt(args[i + 1], "--limit", 50);
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

  return options;
}

function parseSingleId(args: readonly string[], label: string): number {
  if (args.length > 1) {
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  }
  return parseRequiredId(args[0], label);
}
