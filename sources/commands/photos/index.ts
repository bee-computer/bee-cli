// The photos CLI command is now DERIVED from the photos resource module
// (sources/resources/photos). This file is kept as the stable import path used by
// main.ts; it shrinks to a one-line re-export.
import { resourceCommand } from "@/commands/registry";

export const photosCommand = resourceCommand("photos");
