import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createZaiProvider, type ZaiProviderOptions } from "./provider.js";
import { zaiModels } from "./models.js";

export interface ZaiProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createZaiProviderPackage(options: ZaiProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "zai";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-zai",
    description: "Z.AI provider package for Prism.",
    docs: { links: ["docs/providers/zai.md"] },
    setup(api) {
      api.registerProvider(createZaiProvider(options));
      for (const model of options.models ?? zaiModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  defineZaiModel,
  listZaiModels,
  mapZaiModel,
  zaiModels,
  type ListZaiModelsOptions,
  type ZaiModelConfig,
  type ZaiModelEntry,
} from "./models.js";
export {
  createZaiProvider,
  toZaiMessage,
  zaiBody,
  zaiEvents,
  ZAI_DEFAULT_BASE_URL,
  type ZaiProviderOptions,
} from "./provider.js";
export {
  zaiClearThinking,
  zaiPreserveThinking,
  zaiReasoningEffort,
  zaiThinking,
  zaiToolStream,
} from "./thinking.js";
