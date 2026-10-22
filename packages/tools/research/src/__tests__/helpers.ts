import type { Agent, AgentEvent, LoopStrategy, Session, SessionStore, ToolDefinition } from "@arnilo/prism";
import { createAgent, createMemorySessionStore } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import type { ProviderEvent } from "@arnilo/prism";
import type { ToolsResearchConfig } from "../config.js";
import toolsResearch from "../index.js";

export const MODEL = { provider: "mock", model: "m" };

export function fetchTool(name = "web_fetch"): ToolDefinition {
  return {
    name,
    description: "Fixture fetch.",
    effects: ["network"],
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    async execute(args, context) {
      const url = typeof args.url === "string" ? args.url : "";
      return {
        toolCallId: context.toolCallId,
        name,
        value: { url, title: "T", markdown: "body" },
        content: [{ type: "text", text: "fetched" }],
      };
    },
  };
}

export function writeTool(): ToolDefinition {
  return {
    name: "write",
    description: "Fixture write.",
    effects: ["write"],
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute(_args, context) {
      return {
        toolCallId: context.toolCallId,
        name: "write",
        value: { url: "https://should-not-record.test" },
        content: [{ type: "text", text: "wrote" }],
      };
    },
  };
}

export interface ResearchRun {
  readonly agent: Agent;
  readonly store: SessionStore;
  readonly session: Session;
  readonly events: AgentEvent[];
  turns(): number;
  dispose(): Promise<void>;
}

export async function researchAgent(options: {
  readonly config?: ToolsResearchConfig;
  readonly script: readonly (readonly ProviderEvent[])[];
  readonly tools?: readonly ToolDefinition[];
  readonly loop?: LoopStrategy;
}): Promise<ResearchRun> {
  const store = createMemorySessionStore();
  let turns = 0;
  const agent = await createAgent({
    model: MODEL,
    slots: { store, ...(options.loop === undefined ? {} : { loop: options.loop }) },
    tools: { add: [...(options.tools ?? [])] },
    packages: [
      mockProvider(options.script, { onRequest: () => { turns += 1; } }),
      toolsResearch(options.config ?? { sourceTools: ["web_fetch"] }),
    ],
  });
  const events: AgentEvent[] = [];
  const pump = (async () => {
    for await (const event of agent.subscribe()) events.push(event);
  })();
  const session = await agent.session({ id: "s", create: true });
  return {
    agent,
    store,
    session,
    events,
    turns: () => turns,
    dispose: async () => {
      await agent.dispose();
      await pump;
    },
  };
}

export function fetchCall(id: string, url: string) {
  return providerToolCall(toolCallContent(id, "web_fetch", { url }));
}

export function textTurn(text: string): readonly ProviderEvent[] {
  return [providerTextDelta(text), providerDone()];
}

export async function verify(run: ResearchRun): Promise<{ verdict: string; unresolved: string[]; ledgerSize: number }> {
  return (await run.agent.commands.run("research.verify", {}, { session: run.session })) as {
    verdict: string;
    unresolved: string[];
    ledgerSize: number;
  };
}
