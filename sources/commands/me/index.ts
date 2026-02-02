import type { Command } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE = "bee [--staging] me";

export const meCommand: Command = {
  name: "me",
  description: "Fetch the developer profile.",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length > 0) {
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }

    const data = await requestDeveloperJson(context, "/v1/me", {
      method: "GET",
    });
    printJson(data);
  },
};
