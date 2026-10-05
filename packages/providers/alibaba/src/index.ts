/**
 * `@arnilo/prism-provider-alibaba` — Alibaba Cloud (Model Studio / DashScope) provider package for Prism: registers the alibaba provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire plus the embedding, image, and video providers.
 *
 * ```ts
 * import alibaba from "@arnilo/prism-provider-alibaba";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "alibaba/qwen-plus",
 *   packages: [alibaba({ apiKey: "env:DASHSCOPE_API_KEY" })],
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

import { createAlibabaProvider } from "./provider.js";
import { type AlibabaBasePreset, listAlibabaModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const ALIBABA_DEFAULT_API_KEY_REF = "env:DASHSCOPE_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface AlibabaProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link ALIBABA_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Named deployment preset; wins over nothing, `baseUrl` wins over it. */
  readonly preset?: AlibabaBasePreset;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface AlibabaProviderPackageOptions {
  /** Provider id; defaults to `alibaba`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(ALIBABA_DEFAULT_API_KEY_REF),
    preset: {
      type: "string",
      enum: ["singapore", "beijing", "us", "coding-plan"],
      description: "Named deployment preset; `baseUrl` wins over it.",
    },
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: AlibabaProviderPackageOptions) {
  return defineProviderPackage<AlibabaProviderConfig>({
    name: "@arnilo/prism-provider-alibaba",
    description: "Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "alibaba";
      const ref = prism.config.apiKey ?? ALIBABA_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `alibaba: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const preset = prism.config.preset;
      const provider = createAlibabaProvider({ id, baseUrl, preset, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listAlibabaModels({ baseUrl, preset, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `alibaba({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function alibaba(options: AlibabaProviderPackageOptions & AlibabaProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  ALIBABA_MAX_CACHE_BREAKPOINTS,
  alibabaCacheEnabled,
  applyAlibabaCacheControl,
  withAlibabaCacheMarker,
} from "./cache.js";
export {
  ALIBABA_EMBEDDING_BATCH_SIZE,
  ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS,
  type AlibabaEmbedder,
  type AlibabaEmbedderOptions,
  type AlibabaEmbeddingsProviderOptions,
  createAlibabaEmbedder,
  createAlibabaEmbeddingsProvider,
} from "./embeddings.js";
export {
  ALIBABA_IMAGE_MAX_BYTES,
  ALIBABA_IMAGE_MAX_COUNT,
  type AlibabaImageGenerationOptions,
  createAlibabaImageGenerationProvider,
} from "./images.js";
export {
  type AlibabaBasePreset,
  type AlibabaModelConfig,
  type AlibabaModelEntry,
  alibabaBaseUrl,
  alibabaIsThinkingOnly,
  alibabaThinkingFamily,
  alibabaThinkingLevels,
  DEFAULT_ALIBABA_BASE_URL,
  defineAlibabaModel,
  type ListAlibabaModelsOptions,
  listAlibabaModels,
  mapAlibabaModel,
} from "./models.js";
export {
  type AlibabaProviderOptions,
  alibabaBody,
  alibabaEnableThinking,
  alibabaEvents,
  createAlibabaProvider,
  serializeAlibabaMessage,
} from "./provider.js";
export {
  ALIBABA_VIDEO_MAX_DURATION_SECONDS,
  ALIBABA_VIDEO_PROMPT_MAX_CHARS,
  type AlibabaVideoGenerationOptions,
  createAlibabaVideoGenerationProvider,
} from "./video.js";
