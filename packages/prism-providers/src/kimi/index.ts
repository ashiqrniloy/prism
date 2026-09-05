import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { kimiCodingModels, moonshotKimiModels } from "./models.js";
import { createMoonshotProvider } from "./moonshot.js";
import { createKimiCodingProvider } from "./provider.js";

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
    name: "@arnilo/prism-providers/kimi",
    description: "Kimi provider package for Prism.",
    docs: { links: ["docs/providers/kimi.md"] },
    setup(api) {
      api.registerProvider(
        createKimiCodingProvider({
          id: providerId,
          apiKey: options.kimiApiKey,
          fetch: options.fetch,
          baseUrl: options.baseUrl,
          userAgent: options.userAgent,
        }),
      );
      for (const model of options.models ?? kimiCodingModels) {
        api.registerModel({ ...model, provider: providerId });
      }
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });

      if (options.includeMoonshotModels) {
        api.registerProvider(
          createMoonshotProvider({
            id: moonshotId,
            apiKey: options.moonshotApiKey ?? options.kimiApiKey,
            fetch: options.fetch,
            baseUrl: options.moonshotBaseUrl,
          }),
        );
        for (const model of options.moonshotModels ?? moonshotKimiModels) {
          api.registerModel({ ...model, provider: moonshotId });
        }
        api.registerAuthMethod({ kind: "api_key", provider: moonshotId, credentialName: "apiKey" });
      }
    },
  });
}

export {
  applyKimiAnthropicCacheControl,
  kimiAnthropicCacheEnabled,
} from "./cache.js";
export {
  defineKimiModel,
  KIMI_K3_THINKING_LEVELS,
  type KimiModelConfig,
  type KimiModelEntry,
  kimiCodingModels,
  kimiIsK3Model,
  kimiThinkingFamily,
  kimiThinkingLevels,
  type ListKimiModelsOptions,
  listKimiModels,
  mapKimiModel,
  moonshotKimiModels,
} from "./models.js";
export {
  createMoonshotProvider,
  type MoonshotProviderOptions,
  moonshotBody,
  moonshotEvents,
  serializeMoonshotMessage,
} from "./moonshot.js";
export {
  createKimiCodingProvider,
  type KimiCodingProviderOptions,
  kimiAnthropicBody,
  kimiAnthropicEvents,
} from "./provider.js";
export {
  kimiPreserveThinking,
  kimiReasoningEffort,
  kimiThinking,
  stripKimiThinkingCompat,
} from "./thinking.js";
