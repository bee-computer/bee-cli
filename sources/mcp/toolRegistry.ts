// Derives the MCP tools/list array + dispatch map + callBeeTool from RESOURCES.
// Every tool is defined by a resource ActionDefinition; toolSnapshot.ts supplies
// the canonical tool ordering.
import type { CommandContext } from "@/commands/types";
import { TOOL_SNAPSHOT } from "@/mcp/toolSnapshot";
import type { ToolDefinition, ToolResult } from "@/mcp/types";
import { RESOURCES } from "@/resources";
import { jsonString } from "@/resources/json";
import type { StoredAction } from "@/resources/types";

// All MCP-exposed actions across resources, in RESOURCES order then per-resource
// action order.
const MCP_ACTIONS: StoredAction[] = RESOURCES
  .flatMap((resource) => resource.actions)
  .filter((action): action is StoredAction => action.mcp !== undefined);

// Tool definitions derived from each resource action's mcp block.
const DERIVED_TOOLS: ToolDefinition[] = MCP_ACTIONS.map((action) => ({
  name: action.mcp!.name,
  description: action.mcp!.description,
  inputSchema: action.mcp!.inputSchema,
}));

// tools/list array: the snapshot order, with each tool's definition resolved from
// its derived resource action by name. Any resource action not present in the
// snapshot (none today) is appended.
export const BEE_MCP_TOOLS: ToolDefinition[] = buildToolList();

function buildToolList(): ToolDefinition[] {
  const derivedByName = new Map(DERIVED_TOOLS.map((tool) => [tool.name, tool]));
  const used = new Set<string>();
  const tools: ToolDefinition[] = TOOL_SNAPSHOT.map((snapshot) => {
    const derived = derivedByName.get(snapshot.name);
    if (derived) {
      used.add(snapshot.name);
      return derived;
    }
    return snapshot;
  });
  for (const tool of DERIVED_TOOLS) {
    if (!used.has(tool.name)) {
      tools.push(tool);
    }
  }
  return tools;
}

const DISPATCH = new Map<string, StoredAction>(
  MCP_ACTIONS.map((action) => [action.mcp!.name, action])
);

export async function callBeeTool(
  context: CommandContext,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const action = DISPATCH.get(name);
  if (!action) {
    // No resource owns this name (genuinely unknown tool).
    return { content: [{ type: "text", text: `Unknown Bee tool: ${name}` }], isError: true };
  }
  const input = action.coerceInput(args, "mcp"); // lenient coercion + semantic checks
  const result = await action.run(context, input);
  return result.kind === "parts"
    ? { content: result.content }
    : { content: [{ type: "text", text: jsonString(result.data) }] };
}
