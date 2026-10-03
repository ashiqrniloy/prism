import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createHyperProvider } from "./provider.js";

export interface HyperProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export function hyperPackage(options: HyperProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.hyper", "Charm Hyper provider package for Prism.", () => [createHyperProvider(options)]);
}

export { applyHyperAnthropicCacheControl, hyperAnthropicCacheEnabled } from "./cache.js";
export {
  costFromHyperPricing,
  defineHyperModel,
  HYPER_DEFAULT_BASE_URL,
  type HyperModelConfig,
  type HyperModelEntry,
  type HyperRoute,
  hyperModels,
  listHyperModels,
  mapHyperModel,
  routeForHyperModel,
} from "./models.js";
export { hyperChatBody, hyperChatEvents, serializeHyperChatMessage } from "./openai-chat.js";
export { createHyperProvider, type HyperProviderOptions } from "./provider.js";
export { type GetHyperCreditsOptions, getHyperCredits, type HyperCreditsBalance } from "./quota.js";
export { classifyHyperError, type HyperErrorInput, type HyperRetryDecision, hyperHttpError } from "./retry.js";
export { type HyperUsageCost, parseHyperUsageCost } from "./telemetry.js";
export {
  hyperPreserveThinking,
  hyperReasoningEffort,
  hyperThinking,
  stripHyperOwnedCompat,
} from "./thinking.js";
