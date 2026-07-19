import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { kimiCodingModels, moonshotKimiModels } from "./models.js";
import { createMoonshotProvider } from "./moonshot.js";
import { createKimiCodingProvider, type KimiCodingProviderOptions } from "./provider.js";

export interface KimiProviderPackageOptions {
  readonly kimiApiKey?: CredentialValueSource;
  /** Moonshot Open Platform API key (not interchangeable with Kimi Coding keys). */
  readonly moonshotApiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  /** Moonshot Open Platform base URL (default `https://api.moonshot.ai/v1`). */
  readonly moonshotBaseUrl?: string;
  readonly id?: string;
  readonly moonshotId?: string;
  readonly userAgent?: string;
  /** Overrides featured `kimiCodingModels` registered on the coding provider. */
  readonly models?: readonly ModelConfig[];
  /**
   * When true, registers a callable Moonshot Open Platform Chat Completions provider
   * plus featured/override Moonshot models (`compat.route: "openai"`).
   */
  readonly includeMoonshotModels?: boolean;
  readonly moonshotModels?: readonly ModelConfig[];
}

export function createKimiProviderPackage(options: KimiProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "kimi-coding";
  const moonshotId = options.moonshotId ?? "moonshot";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-kimi",
    description: "Kimi provider package for Prism.",
    docs: { links: ["docs/providers/kimi.md"] },
    setup(api) {
      api.registerProvider(createKimiCodingProvider({
        id: providerId,
        apiKey: options.kimiApiKey,
        fetch: options.fetch,
        baseUrl: options.baseUrl,
        userAgent: options.userAgent,
      }));
      for (const model of options.models ?? kimiCodingModels) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });

      if (options.includeMoonshotModels) {
        api.registerProvider(createMoonshotProvider({
          id: moonshotId,
          apiKey: options.moonshotApiKey ?? options.kimiApiKey,
          fetch: options.fetch,
          baseUrl: options.moonshotBaseUrl,
        }));
        for (const model of options.moonshotModels ?? moonshotKimiModels) {
          api.registerModel({ ...model, provider: moonshotId });
        }
        api.registerAuthMethod({ kind: "api_key", provider: moonshotId, credentialName: "apiKey" });
      }
    },
  });
}

export {
  defineKimiModel,
  kimiCodingModels,
  listKimiModels,
  mapKimiModel,
  moonshotKimiModels,
  type KimiModelConfig,
  type KimiModelEntry,
  type ListKimiModelsOptions,
} from "./models.js";
export {
  createKimiCodingProvider,
  kimiAnthropicBody,
  kimiAnthropicEvents,
  type KimiCodingProviderOptions,
} from "./provider.js";
export {
  createMoonshotProvider,
  moonshotBody,
  moonshotEvents,
  serializeMoonshotMessage,
  type MoonshotProviderOptions,
} from "./moonshot.js";
export {
  kimiPreserveThinking,
  kimiReasoningEffort,
  kimiThinking,
  stripKimiThinkingCompat,
} from "./thinking.js";
export {
  applyKimiAnthropicCacheControl,
  kimiAnthropicCacheEnabled,
} from "./cache.js";
