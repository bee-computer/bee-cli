import type { Command } from "@/commands/types";
import {
  callBeeTextTool,
  parsePositiveInt,
  printToolData,
} from "@/commands/mcpToolOutput";
import { parseOutputFlag } from "@/utils/markdown";

const USAGE = [
  "bee locations recent [--limit N] [--visits] [--json]",
  "bee locations current [--json]",
].join("\n");

export const locationsCommand: Command = {
  name: "locations",
  description: "Show recent or current Bee locations.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use recent or current.");
    }

    const [subcommand, ...rest] = args;
    const { format, args: remaining } = parseOutputFlag(rest);
    if (subcommand === "recent") {
      const options = parseRecentArgs(remaining);
      const data = await callBeeTextTool(context, "bee_get_recent_locations", {
        limit: options.limit,
        includeVisits: options.includeVisits,
      });
      printToolData("Recent Locations", data, format);
      return;
    }
    if (subcommand === "current") {
      if (remaining.length > 0) {
        throw new Error(`Unexpected arguments: ${remaining.join(" ")}`);
      }
      const data = await callBeeTextTool(context, "bee_get_current_location", {});
      printToolData("Current Location", data, format);
      return;
    }

    throw new Error(`Unknown locations subcommand: ${subcommand}`);
  },
};

type RecentOptions = {
  limit?: number;
  includeVisits?: boolean;
};

function parseRecentArgs(args: readonly string[]): RecentOptions {
  const options: RecentOptions = {};
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
    if (arg === "--visits") {
      options.includeVisits = true;
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
