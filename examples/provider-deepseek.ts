import { createExtensionKernel } from "@arnilo/prism";
import { createDeepSeekProviderPackage } from "@arnilo/prism-provider-deepseek";

export async function demo() {
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([createDeepSeekProviderPackage({ apiKey: () => "fake-deepseek-key" })]);
  const provider = kernel.registries.providers.get("deepseek");
  const models = kernel.registries.models.list().filter((model) => model.provider === "deepseek");
  return { provider: provider?.id, models: models.map((model) => model.model) };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
