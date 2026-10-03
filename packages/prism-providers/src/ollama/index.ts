import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createOllamaProvider, type OllamaProviderOptions } from "./provider.js";

export interface OllamaProviderPackageOptions extends OllamaProviderOptions {
  readonly apiKey?: CredentialValueSource;
  /**
   * Models to register. Ollama catalogs vary by cloud account or local pull, so nothing
   * is hard-coded here — hosts discover models via `listOllamaModels()` and pass them
   * (or register models themselves). Omit to register the provider with no models.
   */
  readonly models?: readonly ModelConfig[];
}

export function ollamaPackage(options: OllamaProviderPackageOptions = {}): PackageInstance {
  const providerId = options.id ?? "ollama";
  return vendorPackage("@arnilo/prism-providers.ollama", "Ollama Cloud / local provider package for Prism (OpenAI-compatible).", () => [
    createOllamaProvider({
      id: providerId,
      apiKey: options.apiKey,
      fetch: options.fetch,
      baseUrl: options.baseUrl,
      preset: options.preset,
    }),
  ]);
}

export {
  DEFAULT_OLLAMA_BASE_URL,
  defineOllamaModel,
  type ListOllamaModelsOptions,
  listOllamaModels,
  mapOllamaModel,
  type OllamaBasePreset,
  type OllamaModelConfig,
  type OllamaModelEntry,
  ollamaBaseUrl,
  ollamaThinkingLevels,
} from "./models.js";
export {
  createOllamaProvider,
  type OllamaProviderOptions,
  ollamaBody,
  ollamaEvents,
  ollamaReasoningEffort,
} from "./provider.js";
