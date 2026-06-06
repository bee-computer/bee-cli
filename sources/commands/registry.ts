// Derives one Command per ResourceModule. The shared argv parser is configured by
// each action's declared cli.flags + cli.positionals. No central switch: new
// resources appear here automatically via RESOURCES.
import type { Command, CommandContext } from "@/commands/types";
import { parseRequiredId } from "@/commands/mcpToolOutput";
import { parseOutputFlag } from "@/utils/markdown";
import { RESOURCES } from "@/resources";
import type {
  CliFlag,
  CliSurface,
  RawArgs,
  ResourceModule,
  StoredAction,
} from "@/resources/types";

type CliAction = StoredAction & { cli: CliSurface };

export function makeCliCommand(resource: ResourceModule): Command {
  const cliActions = resource.actions.filter(
    (action): action is CliAction => action.cli !== undefined
  );
  const usesSubcommands = cliActions.some((action) => action.cli.subcommand !== undefined);

  return {
    name: resource.cliCommand.name,
    description: resource.cliCommand.description,
    usage: resource.cliCommand.usage,
    ...(resource.cliCommand.aliases ? { aliases: resource.cliCommand.aliases } : {}),
    run: async (args, context) => {
      const action = selectAction(resource, cliActions, usesSubcommands, args);
      const rest = usesSubcommands ? args.slice(1) : args;
      const { format, args: remaining } = parseOutputFlag(rest);
      const raw = parseArgv(remaining, action.cli, resource.cliCommand.name);
      const input = action.coerceInput(raw, "cli");
      const result = await action.run(context, input);
      action.cli.render(result, format, context, raw);
    },
  };
}

function selectAction(
  resource: ResourceModule,
  cliActions: readonly CliAction[],
  usesSubcommands: boolean,
  args: readonly string[]
): CliAction {
  if (!usesSubcommands) {
    const only = cliActions[0];
    if (!only) {
      throw new Error(`No CLI action for ${resource.cliCommand.name}.`);
    }
    return only;
  }
  const sub = args[0];
  if (sub === undefined) {
    throw new Error(resource.cliCommand.missingSubcommandMessage ?? "Missing subcommand.");
  }
  const match = cliActions.find((action) => action.cli.subcommand === sub);
  if (!match) {
    const prefix = resource.cliCommand.unknownSubcommandPrefix ?? `Unknown ${resource.cliCommand.name} subcommand: `;
    throw new Error(`${prefix}${sub}`);
  }
  return match;
}

// Walks the remaining tokens against the declared flag/positional spec, producing
// a RawArgs bag with the SAME keys the MCP `arguments` object uses.
function parseArgv(args: readonly string[], cli: CliSurface, _resourceName: string): RawArgs {
  const bag: { [key: string]: unknown } = {};
  const positionals: string[] = [];
  const flagByName = new Map<string, CliFlag>(cli.flags.map((flag) => [flag.name, flag]));

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    const flag = flagByName.get(arg);
    if (flag) {
      const key = flagKey(flag.name);
      if (flag.kind === "bool") {
        bag[key] = true;
        continue;
      }
      const value = args[i + 1];
      if (flag.kind === "int") {
        // Lenient Number.parseInt (so "5abc" -> 5) with the message "<flag> must be
        // a positive integer". The MCP layer clamps the max (numberArg), so the CLI
        // does not enforce flag.max here.
        bag[key] = parseLenientInt(value, flag.name);
      } else if (flag.kind === "boolString") {
        if (value === undefined) {
          throw new Error(`${flag.name} requires a value`);
        }
        bag[key] = parseBoolString(value, flag.name);
      } else {
        // string: reject undefined OR empty/whitespace value.
        if (value === undefined || value.trim().length === 0) {
          throw new Error(`${flag.name} requires a value`);
        }
        bag[key] = value;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  applyPositionals(bag, positionals, cli);
  return bag;
}

function applyPositionals(
  bag: { [key: string]: unknown },
  positionals: readonly string[],
  cli: CliSurface
): void {
  const declared = cli.positionals ?? [];
  if (declared.length === 0) {
    if (positionals.length > 0) {
      throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
    }
    return;
  }
  const requiredCount = declared.filter((positional) => positional.required).length;
  if (positionals.length < requiredCount || positionals.length > declared.length) {
    // Prefer a resource-declared arity message (e.g. "Provide exactly one photo
    // id."); otherwise fall back to the generic messages.
    const withArity = declared.find((positional) => positional.arityMessage !== undefined);
    if (withArity?.arityMessage !== undefined) {
      throw new Error(withArity.arityMessage);
    }
    throw new Error(
      positionals.length < requiredCount
        ? `Missing ${declared[positionals.length]?.name ?? "argument"}.`
        : `Unexpected arguments: ${positionals.join(" ")}`
    );
  }
  declared.forEach((positional, index) => {
    const value = positionals[index];
    if (value === undefined) {
      return;
    }
    // Required positionals are ids; coerce with parseRequiredId so the
    // "<label> must be a positive integer." message is produced.
    bag[positional.name] = positional.required
      ? parseRequiredId(value, positional.label ?? positionalLabel(positional.name))
      : value;
  });
}

// --limit/--daily-id parsing: lenient parseInt with the "<flag> must be a
// positive integer" message; no upper bound at the CLI layer.
function parseLenientInt(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseBoolString(value: string, flag: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${flag} must be true or false`);
}

// "--daily-id" -> "dailyId"; "--cursor" -> "cursor". Mirrors the MCP argument key.
function flagKey(flagName: string): string {
  return flagName.replace(/^--/, "").replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

// "id" -> "Id"-style human label for the parse error. Photos declares "Photo id";
// otherwise the name is capitalized.
function positionalLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const RESOURCE_COMMANDS: Record<string, Command> = Object.fromEntries(
  RESOURCES.map((resource) => [resource.cliCommand.name, makeCliCommand(resource)])
);

// Re-export so callers needing a single Command by name stay decoupled from
// RESOURCES ordering.
export function resourceCommand(name: string): Command {
  const command = RESOURCE_COMMANDS[name];
  if (!command) {
    throw new Error(`No resource command registered for "${name}".`);
  }
  return command;
}

export type { CommandContext };
