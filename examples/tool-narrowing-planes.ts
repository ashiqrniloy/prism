import { type AgentEvent, createAgent, providerDone, providerTextDelta, type ContextDraft, type ToolDefinition } from "@arnilo/prism";

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

// Plane-switched tool narrowing on one continuing session, as a `context.build`
// handler over the draft's tool list (roadmap §2.4). Narrowing is restrictive-only:
// the handler may drop tools but never introduce one the agent does not have, and a
// call the model should not make is refused with a `tool.call` deny, not by hiding
// the schema. Fake provider — network-free, no credentials.
export async function demo() {
  let generate = 0;
  const agent = await createAgent({
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
    tools: { add: [tool("wiki.search"), tool("wiki.read"), tool("metrics.query"), tool("scenario.run"), tool("objects.list")] },
    hooks: (hooks) => {
      let plane: Plane = "objects";
      hooks.on(
        "context.build",
        (draft: ContextDraft) => {
          // The latest assistant text is the classification signal, read from the transcript.
          const last = [...draft.messages].reverse().find((message) => message.role === "assistant");
          plane = classify(
            last?.content
              .map((block) => (block.type === "text" ? block.text : ""))
              .join(" ")
              .trim() || undefined,
          );
          const keep = prefix(plane);
          const tools = (draft.tools ?? []).filter((entry) => entry.name.startsWith(keep));
          return tools.length === (draft.tools ?? []).length ? undefined : { ...draft, tools };
        },
        { id: "plane-narrowing" },
      );
      // Anything outside the current plane is refused outright.
      hooks.on(
        "tool.call",
        (payload) => (payload.name.startsWith(prefix(plane)) ? undefined : { deny: `tool ${payload.name} is outside the ${plane} plane` }),
        { id: "plane-gate" },
      );
    },
  });
  const session = await agent.session();
  const menus: Array<{ count: number; idsHash: string }> = [];
  for await (const event of session.stream("list objects", { limits: { maxToolRounds: 1 } }) as AsyncIterable<AgentEvent>) {
    if (event.type === "turn.started" && event.metadata.tools) menus.push(event.metadata.tools);
  }
  return { menus };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
