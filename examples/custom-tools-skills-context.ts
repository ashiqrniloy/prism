import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createToolRegistry,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type AgentEvent,
  type ContextProvider,
  type Skill,
  type ToolDefinition,
  type ToolResult,
} from "@arnilo/prism";

// Custom tools + skills + context in one host app: register a host-owned
// tool, a skill that activates it, and a context provider that pins
// workspace text — then run a prompt that triggers the tool-call loop.
//
// Distinct from `tools.ts` / `skills.ts` / `context.ts` (which illustrate
// each seam alone) and from `external-app-db-backed.ts` (which adds a
// DB-backed store + ledger): this is the focused "all three capabilities in
// one agent" SDK adoption path. No filesystem/shell/browser coding tools —
// only a host-domain `notes/save` tool. No network, no credentials.

const saveNoteTool: ToolDefinition = {
  name: "notes/save",
  description: "Persist a short note string.",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute(args, ctx): ToolResult {
    return { toolCallId: ctx.toolCallId, name: "notes/save", value: { saved: true, text: args.text } };
  },
};

const summarizeSkill: Skill = {
  name: "summarize-skill",
  description: "Summarize the pinned workspace note and save it.",
  instructions: "Summarize the workspace context, then call notes/save with the summary.",
  toolNames: ["notes/save"],
};

const workspaceContext: ContextProvider = {
  name: "workspace",
  resolve: () => [{ title: "Workspace note", content: "Prism ships an extensible agent SDK." }],
};

export async function demo(): Promise<{
  toolCallNames: readonly string[];
  textDeltas: readonly string[];
  eventTypes: readonly string[];
}> {
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([
      providerToolCall({ type: "tool_call", id: "tc1", name: "notes/save", arguments: { text: "extensible SDK" } }),
      providerTextDelta("Saved the summary."),
      providerUsage({ inputTokens: 10, outputTokens: 6, totalTokens: 16 }),
      providerDone(),
    ]),
    instructions: "You are a concise assistant.",
    tools: createToolRegistry([saveNoteTool]),
    skills: [summarizeSkill],
    context: [workspaceContext],
  });

  const session = createAgentSession({ agent });

  const toolCallNames: string[] = [];
  const textDeltas: string[] = [];
  const eventTypes: string[] = [];
  async function drain(): Promise<void> {
    for await (const event of session.subscribe() as AsyncIterable<AgentEvent>) {
      eventTypes.push(event.type);
      if (event.type === "tool_execution_started") toolCallNames.push(event.call.name);
      if (event.type === "message_delta" && event.content.type === "text") textDeltas.push(event.content.text);
    }
  }
  await Promise.all([drain(), session.run("Summarize and save.", { activeSkills: ["summarize-skill"] })]);

  return { toolCallNames, textDeltas, eventTypes };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
