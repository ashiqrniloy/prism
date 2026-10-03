import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createDeepSeekProvider } from "./provider.js";

export interface DeepSeekProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function deepseekPackage(options: DeepSeekProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.deepseek", "DeepSeek provider package for Prism.", () => [createDeepSeekProvider(options)]);
}

export { canonicalizeDeepSeekTools, canonicalizeJsonSchema } from "./cache.js";
export {
  DEEPSEEK_THINKING_LEVELS,
  type DeepSeekModelConfig,
  type DeepSeekModelEntry,
  deepseekModels,
  defineDeepSeekModel,
  type ListDeepSeekModelsOptions,
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
