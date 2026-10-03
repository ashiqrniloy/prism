import { createAgent, createMockProvider, createModelRegistry, createProviderRegistry, providerDone } from "@arnilo/prism";
import { openaiPackage } from "@arnilo/prism-providers/openai";

// Load a provider package, then resolve a host-owned mock from host registries.
// No network, no real credentials.
export async function demo() {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerDone()], { id: "mock" }),
    packages: [openaiPackage({ apiKey: () => "fake-openai-key" })],
  });
  await agent.dispose();

  const mock = createMockProvider([providerDone()]);
  const providerRegistry = createProviderRegistry([mock]);
  const modelRegistry = createModelRegistry([{ provider: "mock", model: "demo" }]);
  return {
    provider: providerRegistry.resolve("mock").id,
    model: modelRegistry.resolve("mock", "demo").model,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
