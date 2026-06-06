import { describe, expect, it } from "bun:test";
import { BEE_MCP_TOOLS as DERIVED } from "@/mcp/toolRegistry";
import { TOOL_SNAPSHOT as SNAPSHOT } from "@/mcp/toolSnapshot";

// Guards MCP byte-stability: the tools/list derived from the resource registry
// must remain deep-equal to the released-order snapshot (same count, order,
// schemas). When a domain intentionally ADDS a new bee_list_* tool (conversations
// / journals), update the snapshot accordingly and bump the expected count here.
describe("MCP tool registry derivation", () => {
  it("derives the same 33 tools, in the same order, byte-identically", () => {
    expect(DERIVED.length).toBe(33);
    expect(DERIVED).toEqual(SNAPSHOT);
  });

  it("preserves tool ordering", () => {
    expect(DERIVED.map((tool) => tool.name)).toEqual(SNAPSHOT.map((tool) => tool.name));
  });
});
