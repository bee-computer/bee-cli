// The todos CLI command is now DERIVED from the todos resource module
// (sources/resources/todos). This file is kept as the stable import path used by
// main.ts; it shrinks to a one-line re-export.
import { resourceCommand } from "@/commands/registry";

export const todosCommand = resourceCommand("todos");
