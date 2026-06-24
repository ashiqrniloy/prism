import { createToolRegistry, dispatchToolCall, filterTools } from "@arnilo/prism";
import type { ToolCallContent, ToolDefinition, ToolResult } from "@arnilo/prism";

// Host-owned tool registry: allow/deny filtering and dispatch. Unregistered
// tool calls fail closed and never execute.
export async function demo() {
  const echo: ToolDefinition = {
    name: "echo",
    description: "Echo back the argument",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async execute(args: { text: string }, context): Promise<ToolResult> {
      return { toolCallId: context.toolCallId, name: "echo", value: args.text };
    },
  };

  const registry = createToolRegistry([echo]);

  const active = filterTools(registry.list(), { allow: ["echo"], deny: [] });
  const call: ToolCallContent = { type: "tool_call", id: "tc_1", name: "echo", arguments: { text: "hi" } };

  const result = await dispatchToolCall({
    call,
    registry,
    context: { sessionId: "s1", runId: "r1", toolCallId: call.id },
    filter: { allow: active.map((t) => t.name) },
  });

  return { value: result.value, activeCount: active.length };
}
