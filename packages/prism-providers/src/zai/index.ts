import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { zaiModels } from "./models.js";
import { createZaiProvider } from "./provider.js";

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
    name: "@arnilo/prism-providers/zai",
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
  isGlm52Model,
  isGlm53Model,
  type ListZaiModelsOptions,
  listZaiModels,
  mapZaiModel,
  ZAI_GLM_5_2_THINKING_LEVELS,
  ZAI_GLM_5_3_THINKING_LEVELS,
  type ZaiModelConfig,
  type ZaiModelEntry,
  zaiModels,
  zaiThinkingFamily,
  zaiThinkingLevels,
} from "./models.js";
export {
  createZaiProvider,
  toZaiMessage,
  ZAI_DEFAULT_BASE_URL,
  type ZaiProviderOptions,
  zaiBody,
  zaiEvents,
} from "./provider.js";
export {
  zaiClearThinking,
  zaiPreserveThinking,
  zaiReasoningEffort,
  zaiThinking,
  zaiToolStream,
} from "./thinking.js";
