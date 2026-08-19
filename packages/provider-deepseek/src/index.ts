import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { deepseekModels } from "./models.js";
import { createDeepSeekProvider } from "./provider.js";

export interface DeepSeekProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createDeepSeekProviderPackage(options: DeepSeekProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "deepseek";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-deepseek",
    description: "DeepSeek provider package for Prism.",
    docs: { links: ["docs/providers/deepseek.md"] },
    setup(api) {
      api.registerProvider(createDeepSeekProvider(options));
      for (const model of options.models ?? deepseekModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export { canonicalizeDeepSeekTools, canonicalizeJsonSchema } from "./cache.js";
export {
  defineDeepSeekModel,
  type DeepSeekModelConfig,
  type DeepSeekModelEntry,
  type ListDeepSeekModelsOptions,
  deepseekModels,
  listDeepSeekModels,
  mapDeepSeekModel,
} from "./models.js";
export {
  createDeepSeekProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  type DeepSeekProviderOptions,
  deepseekBody,
  deepseekEvents,
  toDeepSeekMessage,
} from "./provider.js";
export {
  deepseekReasoningEffort,
  deepseekReplayThinking,
  deepseekThinking,
  mapDeepseekEffort,
} from "./thinking.js";
