/**
 * `@arnilo/prism-provider-kimi` — Kimi (For Coding and Moonshot Open Platform) provider package.
 *
 * ```ts
 * import kimi from "@arnilo/prism-provider-kimi";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "kimi-coding/k3",
 *   packages: [kimi({ kimiApiKey: "env:KIMI_API_KEY" })],
 * });
 * ```
 *
 * `kimi-coding` (Anthropic Messages at `https://api.kimi.com/coding`) is always registered; the
 * Moonshot Open Platform provider joins it when `includeMoonshotModels` is set. Both keys are refs
 * (`env:`/`keyring:`), never values: they resolve through the credentials slot on every request. A
 * ref that resolves to nothing records a `warn` status note and registers the provider anyway, so
 * `agent.models` still lists the catalog; a run then fails with `credential_unavailable`.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";

import { kimiCodingModels, listKimiModels } from "./models.js";
import { createMoonshotProvider } from "./moonshot.js";
import { createKimiCodingProvider } from "./provider.js";

/** The `kimiApiKey` ref used when config names none. */
export const KIMI_DEFAULT_API_KEY_REF = "env:KIMI_API_KEY";

/** The `moonshotApiKey` ref used when config names none. */
export const MOONSHOT_DEFAULT_API_KEY_REF = "env:MOONSHOT_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface KimiProviderConfig {
  /** Kimi For Coding key; an `env:`/`keyring:` ref, defaults to {@link KIMI_DEFAULT_API_KEY_REF}. */
  readonly kimiApiKey?: string;
  /** Moonshot Open Platform key (not interchangeable); defaults to {@link MOONSHOT_DEFAULT_API_KEY_REF}. */
  readonly moonshotApiKey?: string;
  /** Kimi For Coding base; defaults to `https://api.kimi.com/coding`. */
  readonly baseUrl?: string;
  /** Moonshot Open Platform base; defaults to `https://api.moonshot.ai/v1`. */
  readonly moonshotBaseUrl?: string;
  /** Kimi For Coding catalog override; defaults to the featured `kimiCodingModels`. */
  readonly models?: readonly ModelConfig[];
  /** Moonshot catalog override. When absent, `models()` asks the Open Platform `/models` endpoint. */
  readonly moonshotModels?: readonly ModelConfig[];
  /** Register the Moonshot Open Platform provider too. */
  readonly includeMoonshotModels?: boolean;
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface KimiProviderPackageOptions {
  /** Provider id; defaults to `kimi-coding`. */
  readonly id?: string;
  /** Moonshot provider id; defaults to `moonshot`. */
  readonly moonshotId?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    kimiApiKey: secretRefProperty(KIMI_DEFAULT_API_KEY_REF),
    moonshotApiKey: secretRefProperty(
      MOONSHOT_DEFAULT_API_KEY_REF,
      "Moonshot Open Platform key (not interchangeable with a Kimi For Coding key).",
    ),
    baseUrl: baseUrlProperty("Kimi For Coding base; defaults to https://api.kimi.com/coding."),
    moonshotBaseUrl: { type: "string", description: "Moonshot Open Platform base; defaults to https://api.moonshot.ai/v1." },
    models: modelsProperty("Kimi For Coding catalog override; defaults to the featured catalog."),
    moonshotModels: modelsProperty("Moonshot catalog override. When absent, `models()` asks the Open Platform `/models` endpoint."),
    includeMoonshotModels: { type: "boolean", description: "Register the Moonshot Open Platform provider too." },
  },
  additionalProperties: false,
};

function definitionFor(options: KimiProviderPackageOptions) {
  return defineProviderPackage<KimiProviderConfig>({
    name: "@arnilo/prism-provider-kimi",
    description: "Kimi (For Coding and Moonshot Open Platform) provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "kimi-coding";
      const moonshotId = options.moonshotId ?? "moonshot";
      const resolve = (target: string) => prism.credentials.resolve(target);
      const kimiRef = prism.config.kimiApiKey ?? KIMI_DEFAULT_API_KEY_REF;
      const moonshotRef = prism.config.moonshotApiKey ?? MOONSHOT_DEFAULT_API_KEY_REF;
      const kimiApiKey = refSource(resolve, kimiRef);
      const moonshotApiKey = refSource(resolve, moonshotRef);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalogs should still list. The notes are what a host shows the user.
      for (const [vendor, ref] of [
        ["kimi-coding", kimiRef],
        ...(prism.config.includeMoonshotModels ? ([["moonshot", moonshotRef]] as const) : []),
      ] as const) {
        if ((await resolve(ref)) === undefined) prism.status.note("warn", `${vendor}: no API key at ${ref}`);
      }

      const baseUrl = prism.config.baseUrl;
      const coding = createKimiCodingProvider({ id, baseUrl, apiKey: kimiApiKey, fetch: options.fetch, userAgent: options.userAgent });
      const codingModels = prism.config.models;
      prism.providers.register({
        ...coding,
        // Kimi For Coding publishes no `/models` endpoint; the featured catalog is the only source.
        async models() {
          return codingModels ?? kimiCodingModels;
        },
      });

      if (prism.config.includeMoonshotModels) {
        const moonshotBaseUrl = prism.config.moonshotBaseUrl;
        const moonshot = createMoonshotProvider({ id: moonshotId, baseUrl: moonshotBaseUrl, apiKey: moonshotApiKey, fetch: options.fetch });
        const configured = prism.config.moonshotModels;
        prism.providers.register({
          ...moonshot,
          async models() {
            if (configured !== undefined) return configured;
            return listKimiModels({ provider: moonshotId, baseUrl: moonshotBaseUrl, apiKey: moonshotApiKey, fetch: options.fetch });
          },
        });
      }
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `kimi({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`s, and catalogs are validated config. */
export function kimi(options: KimiProviderPackageOptions & KimiProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "moonshotId", "userAgent", "fetch"], options);
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
