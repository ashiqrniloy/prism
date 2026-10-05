import { createAgent } from "@arnilo/prism";
import openrouter, { defineOpenRouterModel } from "@arnilo/prism-provider-openrouter";

// OpenRouter catalogs stay host-owned. The package registers the provider only.
export async function demo() {
  const sonnet = defineOpenRouterModel({
    model: "anthropic/claude-sonnet-4",
    compat: { openRouterRouting: { order: ["anthropic"], data_collection: "deny" } },
  });
  const agent = await createAgent({
    model: sonnet,
    packages: [openrouter({ apiKey: "env:PRISM_TEST_OPENROUTER_KEY" })],
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
