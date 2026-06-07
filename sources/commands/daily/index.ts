// The daily CLI command is now DERIVED from the daily resource module
// (sources/resources/daily). This file is kept as the stable import path used by
// main.ts; it shrinks to a one-line re-export.
import { resourceCommand } from "@/commands/registry";

export const dailyCommand = resourceCommand("daily");
