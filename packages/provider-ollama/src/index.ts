import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
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

export function createOllamaProviderPackage(options: OllamaProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "ollama";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-ollama",
    description: "Ollama Cloud / local provider package for Prism (OpenAI-compatible).",
    docs: { links: ["docs/providers/ollama.md"] },
    setup(api) {
      api.registerProvider(createOllamaProvider({
        id: providerId,
        apiKey: options.apiKey,
        fetch: options.fetch,
        baseUrl: options.baseUrl,
        preset: options.preset,
      }));
      for (const model of options.models ?? []) {
        api.registerModel({ ...model, provider: providerId });
      }
      // Cloud uses an ollama.com API key; local `ollama serve` is typically unauthenticated.
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  DEFAULT_OLLAMA_BASE_URL,
  defineOllamaModel,
  listOllamaModels,
  mapOllamaModel,
  ollamaBaseUrl,
  type ListOllamaModelsOptions,
  type OllamaBasePreset,
  type OllamaModelConfig,
  type OllamaModelEntry,
} from "./models.js";
export {
  createOllamaProvider,
  ollamaBody,
  ollamaEvents,
  ollamaReasoningEffort,
  type OllamaProviderOptions,
} from "./provider.js";
