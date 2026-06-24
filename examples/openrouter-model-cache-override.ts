import { createExtensionKernel } from "@arnilo/prism";
import {
  createOpenRouterProviderPackage,
  defineOpenRouterModel,
} from "@arnilo/prism-provider-openrouter";

// OpenRouter: app-controlled catalog with per-model routing/cache overrides.
// No catalog is fetched during setup; the host supplies the models.
export async function demo() {
  const sonnet = defineOpenRouterModel({
    model: "anthropic/claude-sonnet-4",
    compat: { openRouterRouting: { order: ["anthropic"], data_collection: "deny" } },
  });

  const kernel = createExtensionKernel();
  await kernel.load([
    createOpenRouterProviderPackage({ apiKey: () => "fake-openrouter-key", models: [sonnet] }),
  ]);

  return { model: sonnet.model, routing: sonnet.compat?.openRouterRouting };
}
