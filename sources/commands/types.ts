import type { DeveloperClient } from "@/client";
import type { Environment } from "@/environment";

export type CommandContext = {
  env: Environment;
  client: DeveloperClient;
};

export type Command = {
  name: string;
  description: string;
  usage: string;
  aliases?: readonly string[];
  run: (args: readonly string[], context: CommandContext) => Promise<void>;
};
