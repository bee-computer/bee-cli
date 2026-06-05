import type { Command } from "@/commands/types";
import {
  callBeeTextTool,
  parsePositiveInt,
  printToolData,
} from "@/commands/mcpToolOutput";
import { parseOutputFlag } from "@/utils/markdown";

const USAGE = "bee activity [--limit N] [--json]";

export const activityCommand: Command = {
  name: "activity",
  description: "Show recent Bee activity across conversations, summaries, notes, todos, and insights.",
  usage: USAGE,
  run: async (args, context) => {
    const { format, args: remaining } = parseOutputFlag(args);
    const options = parseActivityArgs(remaining);
    const data = await callBeeTextTool(context, "bee_get_recent_activity", {
      limit: options.limit,
    });
    printToolData("Recent Activity", data, format);
  },
};

type ActivityOptions = {
  limit?: number;
};

function parseActivityArgs(args: readonly string[]): ActivityOptions {
  const options: ActivityOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--limit") {
      options.limit = parsePositiveInt(args[i + 1], "--limit", 20);
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
