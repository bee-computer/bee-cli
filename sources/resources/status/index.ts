// The CLI `status` command and the MCP `bee_status` tool deliberately do NOT
// share run/render logic; they live in this resource file for co-location only.
//
//  - CLI `status` (NO mcp block here): fetchClientMe + /v1/me + masked token +
//    proxy connection details + a "status does not accept arguments." rejection.
//    It is kept hand-written in sources/commands/status/index.ts because it must
//    NOT flow through the generic registry dispatcher: status rejects ANY
//    argument (including --json), whereas makeCliCommand strips --json via
//    parseOutputFlag before the command sees it. Routing it through the shared
//    dispatcher would let an invalid --json slip through. statusCommand stays
//    hand-written.
//
//  - bee_status (NO cli block here): reports LOCAL token/proxy/mode state as JSON
//    and makes no HTTP call. Defined below as the only ActionDefinition in this
//    resource (MCP-only).
import { loadToken } from "@/secureStore";
import type { CommandContext } from "@/commands/types";
import type { ActionDefinition, ResourceModule } from "@/resources/types";

// bee_status takes no arguments.
type BeeStatusInput = Record<string, never>;

// ---- bee_status (MCP-only; local state, no HTTP) ----------------------------
// Returns kind:"json"; toolRegistry wraps it into MCP text via jsonString.
const beeStatus: ActionDefinition<BeeStatusInput> = {
  mcp: {
    name: "bee_status",
    description: "Check whether Bee CLI is signed in and ready.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  // No cli surface (see header comment).
  coerceInput: () => ({}),
  run: async (ctx) => {
    const token = ctx.client.isProxy ? null : await loadTokenForStatus(ctx);
    return {
      kind: "json",
      data: {
        connected: ctx.client.isProxy || !!token,
        mode: "stdio-mcp",
        access: "read-write",
        environment: ctx.env,
      },
    };
  },
};

async function loadTokenForStatus(context: CommandContext): Promise<string | null> {
  try {
    return await loadToken(context.env);
  } catch (error) {
    process.stderr.write(
      `Bee MCP error: ${error instanceof Error ? error.message : "unexpected error"}\n`
    );
    return null;
  }
}

export const statusResource: ResourceModule = {
  // CLI command metadata. NOT used by makeCliCommand (statusCommand stays
  // hand-written); recorded here to keep the resource self-describing.
  cliCommand: {
    name: "status",
    description: "Show current authentication status.",
    usage: "bee status",
  },
  actions: [beeStatus],
};
