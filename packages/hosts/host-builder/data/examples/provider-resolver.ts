import { type AgentEvent, createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";
import { hyper } from "@arnilo/prism-provider-hyper";

// A loaded provider package resolves `model.provider`. A host-owned provider is one more package
// (`providerPackage`), listed next to the vendor's. No network, no real credentials.
export async function demo(): Promise<{ streamed: string; providers: string[] }> {
  const own = createMockProvider([providerTextDelta("from-own"), providerDone()], { id: "own" });
  const agent = await createAgent({
    model: { provider: "own", model: "demo" },
    packages: [hyper({ apiKey: "env:HYPER_API_KEY" }), providerPackage("host-providers", [own])],
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
