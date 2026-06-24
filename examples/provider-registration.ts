import {
  createExtensionKernel,
  createProviderRegistry,
  createModelRegistry,
  createMockProvider,
  providerDone,
} from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

// Register a provider package through the extension kernel and resolve
// providers/models from host-owned registries. Uses a fake API key.
// `createOpenAIProviderPackage` is structurally an Extension (name + setup),
// so the kernel can load it directly.
export async function demo() {
  const kernel = createExtensionKernel();
  await kernel.load([createOpenAIProviderPackage({ apiKey: () => "fake-openai-key" })]);

  const mock = createMockProvider([providerDone()]);
  const providerRegistry = createProviderRegistry([mock]);
  const modelRegistry = createModelRegistry([{ provider: "mock", model: "demo" }]);

  providerRegistry.register(mock);
  modelRegistry.register({ provider: "mock", model: "demo" });

  return {
    provider: providerRegistry.resolve("mock").id,
    model: modelRegistry.resolve("mock", "demo").model,
  };
}

// Runnable end-to-end demo: `node examples/provider-registration.ts` (Node 24
// strips types natively). No network, no real credentials.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
