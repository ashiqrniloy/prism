import {
  type AgentEvent,
  createAgent,
  createAgentSession,
  providerDone,
  providerTextDelta,
  type ToolDefinition,
} from "@arnilo/prism";

type Plane = "knowledge" | "metric" | "scenario" | "objects";

function tool(name: string): ToolDefinition {
  return {
    name,
    parameters: { type: "object", properties: {} },
    execute(_args, context) {
      return { toolCallId: context.toolCallId, name };
    },
  };
}

function classify(last?: string): Plane {
  if (!last) return "objects";
  if (/wiki/i.test(last)) return "knowledge";
  if (/metric/i.test(last)) return "metric";
  if (/scenario/i.test(last)) return "scenario";
  return "objects";
}

function prefix(plane: Plane): string {
  return plane === "knowledge" ? "wiki." : plane === "metric" ? "metrics." : `${plane}.`;
}

// Plane-switched tool narrowing on one continuing session. Fake provider —
// network-free, no credentials.
export async function demo() {
  let generate = 0;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate() {
        generate += 1;
        if (generate === 1) {
          yield providerTextDelta("I'll search the wiki.");
          yield {
            type: "tool_call",
            call: { type: "tool_call", id: "c1", name: "objects.list", arguments: {} },
          };
        } else {
          yield providerTextDelta("I'll query metrics.");
        }
        yield providerDone();
      },
    },
    tools: [tool("wiki.search"), tool("wiki.read"), tool("metrics.query"), tool("scenario.run"), tool("objects.list")],
    toolNarrowing: async ({ lastAssistantText, toolIds }) => {
      const plane = classify(lastAssistantText);
      return toolIds.filter((id) => id.startsWith(prefix(plane)));
    },
  });
  const session = createAgentSession({ agent });
  const menus: Array<{ count: number; idsHash: string }> = [];
  for await (const event of session.stream("list objects", { limits: { maxToolRounds: 1 } }) as AsyncIterable<AgentEvent>) {
    if (event.type === "provider_turn_started" && event.metadata.tools) menus.push(event.metadata.tools);
  }
  return { menus };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
