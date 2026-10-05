/**
 * `@arnilo/prism-provider-ollama` — Ollama Cloud / local provider package for Prism: registers the ollama provider, resolves its optional key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire and model catalog.
 *
 * ```ts
 * import ollama from "@arnilo/prism-provider-ollama";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "ollama/gpt-oss:20b",
 *   packages: [ollama({})],
 * });
 * ```
 *
 * The key is a ref (`env:`/`keyring:`), never a value: it resolves through the credentials slot on
 * every request, so a rotated or host-captured secret is picked up without rebuilding the provider.
 * A ref that resolves to nothing records a `warn` status note and registers the provider anyway, so
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

import { createOllamaProvider } from "./provider.js";
import { type OllamaBasePreset, listOllamaModels } from "./models.js";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface OllamaProviderConfig {
  /** Optional `env:`/`keyring:` ref (Ollama Cloud). Omit for an unauthenticated local server. */
  readonly apiKey?: string;
  /** Named deployment preset; wins over nothing, `baseUrl` wins over it. */
  readonly preset?: OllamaBasePreset;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface OllamaProviderPackageOptions {
  /** Provider id; defaults to `ollama`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(undefined, "Optional `env:` or `keyring:` ref (Ollama Cloud). Omit for an unauthenticated local server."),
    preset: {
      type: "string",
      enum: ["cloud", "local"],
      description: "Named deployment preset; `baseUrl` wins over it.",
    },
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: OllamaProviderPackageOptions) {
  return defineProviderPackage<OllamaProviderConfig>({
    name: "@arnilo/prism-provider-ollama",
    description: "Ollama Cloud / local provider package for Prism (OpenAI-compatible).",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "ollama";
      const ref = prism.config.apiKey;
      const resolve = (target: string) => prism.credentials.resolve(target);
      // Ollama Cloud needs a key; a local `ollama serve` does not, so an absent ref is not a warning.
      const apiKey = ref === undefined ? undefined : refSource(resolve, ref);
      const baseUrl = prism.config.baseUrl;
      const preset = prism.config.preset;
      const provider = createOllamaProvider({ id, baseUrl, preset, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listOllamaModels({ baseUrl, preset, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `ollama({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function ollama(options: OllamaProviderPackageOptions & OllamaProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
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
