import type { Command } from "@/commands/types";
import { printJson } from "@/client/clientApi";
import {
  callBeeImageTool,
  callBeeTextTool,
  firstText,
  parsePositiveInt,
  printToolData,
} from "@/commands/mcpToolOutput";
import { parseOutputFlag } from "@/utils/markdown";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const USAGE = [
  "bee photos list [--daily-id N] [--date YYYY-MM-DD] [--limit N] [--json]",
  "bee photos get <id> [--output PATH] [--json]",
].join("\n");

export const photosCommand: Command = {
  name: "photos",
  description: "List or download Bee photos.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length === 0) {
      throw new Error("Missing subcommand. Use list or get.");
    }

    const [subcommand, ...rest] = args;
    const { format, args: remaining } = parseOutputFlag(rest);
    if (subcommand === "list") {
      const options = parseListArgs(remaining);
      const data = await callBeeTextTool(context, "bee_get_photos", {
        dailyId: options.dailyId,
        date: options.date,
        limit: options.limit,
      });
      printToolData("Photos", data, format);
      return;
    }
    if (subcommand === "get") {
      const options = parseGetArgs(remaining);
      const result = await callBeeImageTool(context, "bee_get_photo", {
        id: options.id,
      });
      const image = result.content.find((item) => item.type === "image");
      if (!image || image.type !== "image") {
        throw new Error("Bee did not return image content for this photo.");
      }

      const bytes = Buffer.from(image.data, "base64");
      if (options.output) {
        const outputPath = resolve(options.output);
        writeFileSync(outputPath, bytes);
        if (format === "json") {
          printJson({
            id: options.id,
            output: outputPath,
            mimeType: image.mimeType,
            bytes: bytes.length,
          });
          return;
        }
        console.log(`Photo ${options.id} written to ${outputPath}`);
        console.log(`- mime_type: ${image.mimeType}`);
        console.log(`- bytes: ${bytes.length}`);
        return;
      }

      if (format === "json") {
        printJson({
          id: options.id,
          mimeType: image.mimeType,
          data: image.data,
        });
        return;
      }

      const text = firstText(result);
      console.log(text.trim() || `Photo ${options.id}`);
      console.log(`- mime_type: ${image.mimeType}`);
      console.log(`- bytes: ${bytes.length}`);
      console.log("- data: omitted; use --output PATH to write the image, or --json for base64");
      return;
    }

    throw new Error(`Unknown photos subcommand: ${subcommand}`);
  },
};

type ListOptions = {
  dailyId?: number;
  date?: string;
  limit?: number;
};

type GetOptions = {
  id: string;
  output?: string;
};

function parseListArgs(args: readonly string[]): ListOptions {
  const options: ListOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--daily-id") {
      options.dailyId = parsePositiveInt(args[i + 1], "--daily-id");
      i += 1;
      continue;
    }
    if (arg === "--date") {
      const value = args[i + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("--date requires a value");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--date must be YYYY-MM-DD");
      }
      options.date = value;
      i += 1;
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

function parseGetArgs(args: readonly string[]): GetOptions {
  let id: string | undefined;
  let output: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--output") {
      const value = args[i + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("--output requires a value");
      }
      output = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length !== 1) {
    throw new Error("Provide exactly one photo id.");
  }
  id = positionals[0];
  if (id === undefined || id.trim().length === 0) {
    throw new Error("Photo id must be non-empty.");
  }

  const options: GetOptions = { id };
  if (output !== undefined) {
    options.output = output;
  }
  return options;
}
