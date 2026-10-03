import { type AgentEvent, createAgent, createMockProvider, createProviderResolver, providerDone, providerTextDelta } from "@arnilo/prism";
import { openaiPackage } from "@arnilo/prism-providers/openai";

// A loaded provider package resolves `model.provider` with no `AgentConfig.provider`.
// `providerSource` still wins for a host-owned provider. No network, no real credentials.
export async function demo(): Promise<{ streamed: string; providers: string[] }> {
  const own = createMockProvider([providerTextDelta("from-own"), providerDone()], { id: "own" });
  const agent = await createAgent({
    model: { provider: "own", model: "demo" },
    packages: [openaiPackage({ apiKey: () => "fake-openai-key" })],
    providerSource: createProviderResolver([own]),
  });

  const session = await agent.session({ id: "s1", create: true });
  const reader = collect(session.subscribe());
  await session.run("Hi");
  const events = await reader;
  const delta = events.find((event) => event.type === "message.delta");
  const streamed = delta?.content.type === "text" ? delta.content.text : "";
  return { streamed, providers: [own.id, ...agent.inspect().packages.map((item) => item.name)] };
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

// Runnable end-to-end demo: `node examples/provider-resolver.ts` (Node 24
// strips types natively). No network, no real credentials.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
