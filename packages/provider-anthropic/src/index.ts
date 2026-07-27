import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { anthropicModels } from "./models.js";
import { createAnthropicMessagesProvider } from "./provider.js";

export interface AnthropicProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly userAgent?: string;
  /** Overrides featured `anthropicModels` registered on setup. */
  readonly models?: readonly ModelConfig[];
}

export function createAnthropicProviderPackage(options: AnthropicProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "anthropic";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-anthropic",
    description: "Anthropic Messages provider package for Prism.",
    docs: { links: ["docs/providers/anthropic.md"] },
    setup(api) {
      api.registerProvider(
        createAnthropicMessagesProvider({
          id: providerId,
          apiKey: options.apiKey,
          fetch: options.fetch,
          baseUrl: options.baseUrl,
          userAgent: options.userAgent,
        }),
      );
      for (const model of options.models ?? anthropicModels) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  anthropicCacheEnabled,
  applyAnthropicCacheControl,
} from "./cache.js";
export {
  anthropicMessagesBody,
  anthropicMessagesEvents,
} from "./messages.js";
export {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_BASE_URL,
  type AnthropicModelConfig,
  type AnthropicModelEntry,
  anthropicModels,
  defineAnthropicModel,
  type ListAnthropicModelsOptions,
  listAnthropicModels,
  mapAnthropicModel,
} from "./models.js";
export {
  type AnthropicMessagesProviderOptions,
  anthropicOwnedHeaders,
  createAnthropicMessagesProvider,
} from "./provider.js";
export {
  anthropicEffort,
  anthropicPreserveThinking,
  anthropicThinking,
  stripAnthropicOwnedCompat,
} from "./thinking.js";
