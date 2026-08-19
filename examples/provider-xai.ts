import { createExtensionKernel } from "@arnilo/prism";
import { createXaiProviderPackage } from "@arnilo/prism-provider-xai";

export async function demo() {
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([createXaiProviderPackage({ apiKey: () => "fake-xai-key" })]);
  const provider = kernel.registries.providers.get("xai");
  const auth = kernel.registries.authMethods.list().filter((method) => method.provider === "xai");
  return {
    provider: provider?.id,
    auth: auth.map((method) => method.kind),
    models: kernel.registries.models.list().filter((model) => model.provider === "xai").map((model) => model.model),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
