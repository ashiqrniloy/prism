import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createZaiProvider } from "./provider.js";

export interface ZaiProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function zaiPackage(options: ZaiProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.zai", "Z.AI provider package for Prism.", () => [createZaiProvider(options)]);
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
