import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createOpenRouterProvider } from "./provider.js";

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

export {
  applyOpenRouterCacheControl,
  OPENROUTER_SESSION_ID_MAX_LENGTH,
  openRouterCacheEnabled,
  openRouterSessionId,
  openRouterTopLevelCacheControl,
  openRouterUsage,
} from "./cache.js";
export { defineOpenRouterModel, type OpenRouterModelConfig } from "./model.js";
export {
  type ListOpenRouterModelsOptions,
  listOpenRouterModels,
  mapOpenRouterModel,
  type OpenRouterModelEntry,
} from "./models.js";
export { createOpenRouterProvider, type OpenRouterProviderOptions, openRouterBody, openRouterEvents } from "./provider.js";
export {
  openRouterPreserveThinking,
  resolveOpenRouterReasoning,
  stripOpenRouterOwnedCompat,
} from "./thinking.js";
