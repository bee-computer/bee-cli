import type { Command } from "@/commands/types";
import { printJson, requestDeveloperJson } from "@/commands/developerApi";

const USAGE = "bee [--staging] today-brief";

export const todayBriefCommand: Command = {
  name: "today-brief",
  description: "Fetch today's brief (calendar events and emails).",
  usage: USAGE,
  run: async (args, context) => {
    if (args.length > 0) {
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }

    const data = await requestDeveloperJson(context, "/v1/todayBrief", {
      method: "GET",
    });
    printJson(data);
  },
};
