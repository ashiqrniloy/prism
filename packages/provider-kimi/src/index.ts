import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "prism";
import { kimiCodingModels, moonshotKimiModels } from "./models.js";
import { createKimiCodingProvider, type KimiCodingProviderOptions } from "./provider.js";

export interface KimiProviderPackageOptions {
  readonly kimiApiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly userAgent?: string;
  readonly models?: readonly ModelConfig[];
  readonly includeMoonshotModels?: boolean;
  readonly moonshotModels?: readonly ModelConfig[];
}

export function createKimiProviderPackage(options: KimiProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "kimi-coding";
  return defineProviderPackage({
    name: "@prism/provider-kimi",
    description: "Kimi provider package for Prism.",
    docs: { links: ["docs/providers/kimi.md"] },
    setup(api) {
      api.registerProvider(createKimiCodingProvider({ ...options, id: providerId, apiKey: options.kimiApiKey }));
      for (const model of options.models ?? kimiCodingModels) api.registerModel({ ...model, provider: providerId });
      if (options.includeMoonshotModels) for (const model of options.moonshotModels ?? moonshotKimiModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export { defineKimiModel, kimiCodingModels, moonshotKimiModels, type KimiModelConfig } from "./models.js";
export { createKimiCodingProvider, kimiAnthropicBody, kimiAnthropicEvents, type KimiCodingProviderOptions } from "./provider.js";
