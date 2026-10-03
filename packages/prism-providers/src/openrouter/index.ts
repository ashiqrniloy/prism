import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createOpenRouterProvider } from "./provider.js";

export interface OpenRouterProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly appUrl?: string;
  readonly appTitle?: string;
  /** App-controlled catalog. Prefer `listOpenRouterModels()` then filter — setup never fetches. */
  readonly models?: readonly ModelConfig[];
}

export function openrouterPackage(options: OpenRouterProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.openrouter", "OpenRouter provider package for Prism.", () => [
    createOpenRouterProvider(options),
  ]);
}

export {
  applyOpenRouterCacheControl,
  OPENROUTER_SESSION_ID_MAX_LENGTH,
  openRouterCacheEnabled,
  openRouterSessionId,
  openRouterTopLevelCacheControl,
  openRouterUsage,
} from "./cache.js";
export { defineOpenRouterModel, type OpenRouterModelConfig } from "./model.js";
export {
  type ListOpenRouterModelsOptions,
  listOpenRouterModels,
  mapOpenRouterModel,
  type OpenRouterModelEntry,
} from "./models.js";
export { createOpenRouterProvider, type OpenRouterProviderOptions, openRouterBody, openRouterEvents } from "./provider.js";
export {
  openRouterPreserveThinking,
  resolveOpenRouterReasoning,
  stripOpenRouterOwnedCompat,
} from "./thinking.js";
