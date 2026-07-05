import {
  createAgent,
  createExtensionKernel,
  createProviderResolver,
  createMockProvider,
  providerDone,
  providerTextDelta,
  type AgentEvent,
} from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

// Build a provider resolver from a mix of first-party provider package
// contributions (loaded through the extension kernel) and a third-party own
// provider, then run an agent with `providerSource` and no direct `provider`.
// No network, no real credentials — the model routes to the own mock provider.
export async function demo(): Promise<{ streamed: string; providers: string[] }> {
  // First-party provider package, inert until loaded; fake key only.
  const kernel = createExtensionKernel();
  await kernel.load([createOpenAIProviderPackage({ apiKey: () => "fake-openai-key" })]);

  // Third-party own provider.
  const own = createMockProvider([providerTextDelta("from-own"), providerDone()], { id: "own" });

  // Resolver from an explicit list mixing first-party (from the kernel registry)
  // and own. Hosts can also pass the registry directly:
  //   createProviderResolver(kernel.registries.providers)
  // or implement ProviderResolver as a one-line function over their own map.
  const providerSource = createProviderResolver([...kernel.registries.providers.list(), own]);

  const agent = createAgent({
    model: { provider: "own", model: "demo" },
    providerSource,
  });

  const session = agent.createSession({ id: "s1" });
  const reader = collect(session.subscribe());
  await session.run("Hi");
  const events = await reader;

  const delta = events.find((event) => event.type === "message_delta");
  const streamed = delta?.content.type === "text" ? delta.content.text : "";
  return { streamed, providers: [...kernel.registries.providers.list(), own].map((p) => p.id) };
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
