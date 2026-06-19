import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "prism";
import { createOpenRouterProvider, type OpenRouterProviderOptions } from "./provider.js";

export interface OpenRouterProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly appUrl?: string;
  readonly appTitle?: string;
  readonly models?: readonly ModelConfig[];
}

export function createOpenRouterProviderPackage(options: OpenRouterProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@prism/provider-openrouter",
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
export { createOpenRouterProvider, openRouterBody, openRouterEvents, type OpenRouterProviderOptions } from "./provider.js";
