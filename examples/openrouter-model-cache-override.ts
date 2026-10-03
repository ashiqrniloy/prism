import { createAgent } from "@arnilo/prism";
import { defineOpenRouterModel, openrouterPackage } from "@arnilo/prism-providers/openrouter";

// OpenRouter catalogs stay host-owned. The package registers the provider only.
export async function demo() {
  const sonnet = defineOpenRouterModel({
    model: "anthropic/claude-sonnet-4",
    compat: { openRouterRouting: { order: ["anthropic"], data_collection: "deny" } },
  });
  const agent = await createAgent({
    model: sonnet,
    packages: [openrouterPackage({ apiKey: () => "fake-openrouter-key" })],
  });
  await agent.dispose();
  return { model: sonnet.model, routing: sonnet.compat?.openRouterRouting };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
