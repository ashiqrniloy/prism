import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createOpenRouterProvider, type OpenRouterProviderOptions } from "./provider.js";

export interface OpenRouterProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly appUrl?: string;
  readonly appTitle?: string;
  /** App-controlled catalog. Prefer `listOpenRouterModels()` then filter — setup never fetches. */
  readonly models?: readonly ModelConfig[];
}

export function createOpenRouterProviderPackage(options: OpenRouterProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-provider-openrouter",
    description: "OpenRouter provider package for Prism.",
    docs: { links: ["docs/providers/openrouter.md"] },
    setup(api) {
      api.registerProvider(createOpenRouterProvider(options));
      for (const model of options.models ?? []) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "openrouter", credentialName: "apiKey" });
    },
  });
}

export { defineOpenRouterModel, type OpenRouterModelConfig } from "./model.js";
export {
  listOpenRouterModels,
  mapOpenRouterModel,
  type ListOpenRouterModelsOptions,
  type OpenRouterModelEntry,
} from "./models.js";
export {
  openRouterPreserveThinking,
  resolveOpenRouterReasoning,
  stripOpenRouterOwnedCompat,
} from "./thinking.js";
export {
  OPENROUTER_SESSION_ID_MAX_LENGTH,
  applyOpenRouterCacheControl,
  openRouterCacheEnabled,
  openRouterSessionId,
  openRouterTopLevelCacheControl,
  openRouterUsage,
} from "./cache.js";
export { createOpenRouterProvider, openRouterBody, openRouterEvents, type OpenRouterProviderOptions } from "./provider.js";
