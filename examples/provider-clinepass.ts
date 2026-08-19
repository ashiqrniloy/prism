import { createExtensionKernel } from "@arnilo/prism";
import { createClinePassProviderPackage } from "@arnilo/prism-provider-clinepass";

export async function demo() {
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([createClinePassProviderPackage({ apiKey: () => "fake-cline-key" })]);
  const provider = kernel.registries.providers.get("clinepass");
  const slugs = kernel.registries.models
    .list()
    .filter((model) => model.provider === "clinepass")
    .map((model) => model.model);
  return { provider: provider?.id, slugs };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
