// Registry-derived. The search capability now lives once in
// sources/resources/search/index.ts (CLI surface + bee_search tool). main.ts
// imports searchCommand from here unchanged.
import { resourceCommand } from "@/commands/registry";

export const searchCommand = resourceCommand("search");
