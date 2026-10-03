import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
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

export function anthropicPackage(options: AnthropicProviderPackageOptions = {}): PackageInstance {
  const providerId = options.id ?? "anthropic";
  return vendorPackage("@arnilo/prism-providers.anthropic", "Anthropic Messages provider package for Prism.", () => [
    createAnthropicMessagesProvider({
      id: providerId,
      apiKey: options.apiKey,
      fetch: options.fetch,
      baseUrl: options.baseUrl,
      userAgent: options.userAgent,
    }),
  ]);
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
