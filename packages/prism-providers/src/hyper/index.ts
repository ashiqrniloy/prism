import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { hyperModels } from "./models.js";
import { createHyperProvider } from "./provider.js";

export interface HyperProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export function createHyperProviderPackage(options: HyperProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-providers/hyper",
    description: "Charm Hyper provider package for Prism.",
    docs: { links: ["docs/providers/hyper.md"] },
    setup(api) {
      api.registerProvider(createHyperProvider(options));
      for (const model of options.models ?? hyperModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "hyper", credentialName: "apiKey" });
    },
  });
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
