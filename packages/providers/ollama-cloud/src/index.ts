/**
 * `@arnilo/prism-ai/ollama-cloud` — Ollama Cloud provider package for Prism: registers the
 * `ollama-cloud` provider, resolves its key from an `env:`/`keyring:` ref per request, and serves the
 * native NDJSON `/api/chat` route (default) plus the OpenAI-compatible `/v1/chat/completions` route
 * used by `pi-ollama-cloud`.
 *
 * ```ts
 * import ollamaCloud from "@arnilo/prism-ai/ollama-cloud";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "ollama-cloud/gemma4:31b",
 *   packages: [ollamaCloud({ apiKey: "env:OLLAMA_API_KEY" })],
 * });
 * ```
 *
 * The key is a ref (`env:`/`keyring:`), never a value: it resolves through the credentials slot on
 * every request. A ref that resolves to nothing records a `warn` status note and registers the
 * provider anyway; a run then fails with `credential_unavailable`.
 */
import type { JsonSchema, ModelConfig, PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { listOllamaCloudModels } from "./models.js";
import { createOllamaCloudProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const OLLAMA_CLOUD_DEFAULT_API_KEY_REF = "env:OLLAMA_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface OllamaCloudProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link OLLAMA_CLOUD_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official host root; defaults to `https://ollama.com`. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks `/api/tags` and `/api/show`. */
  readonly models?: readonly ModelConfig[];
  /** Provider-wide route; a model's `compat.route` wins. Defaults to `native`. */
  readonly route?: "native" | "openai";
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface OllamaCloudProviderPackageOptions {
  /** Provider id; defaults to `ollama-cloud`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(OLLAMA_CLOUD_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official host root; defaults to https://ollama.com."),
    models: modelsProperty("Static catalog. When absent, `models()` asks `/api/tags` plus `/api/show`."),
    route: {
      type: "string",
      enum: ["native", "openai"],
      default: "native",
      description: "Provider-wide wire; a model's `compat.route` wins. `native` is the measured default.",
    },
  },
  additionalProperties: false,
};

function definitionFor(options: OllamaCloudProviderPackageOptions) {
  return defineProviderPackage<OllamaCloudProviderConfig>({
    name: "@arnilo/prism-ai/ollama-cloud",
    description: "Ollama Cloud provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "ollama-cloud";
      const ref = prism.config.apiKey ?? OLLAMA_CLOUD_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `ollama-cloud: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const route = prism.config.route;
      const provider = createOllamaCloudProvider({ id, baseUrl, apiKey, route, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listOllamaCloudModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `ollamaCloud({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, `models`, and `route` are validated config. */
export function ollamaCloud(options: OllamaCloudProviderPackageOptions & OllamaCloudProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  contextLength,
  defineOllamaCloudDecisionModel,
  defineOllamaCloudModel,
  type ListOllamaCloudModelsOptions,
  listOllamaCloudModels,
  mapOllamaCloudModel,
  OLLAMA_CLOUD_DEFAULT_BASE_URL,
  type OllamaCloudBalance,
  type OllamaCloudBalanceOptions,
  type OllamaCloudBalanceWindow,
  type OllamaCloudIncludedBalance,
  type OllamaCloudModelConfig,
  type OllamaCloudModelEntry,
  type OllamaCloudRoute,
  type OllamaCloudShowEntry,
  ollamaCloudBalance,
  ollamaCloudModels,
  ollamaCloudThink,
  ollamaCloudThinkingIsBoolean,
  ollamaCloudThinkingLevels,
  thinkingValues,
} from "./models.js";
export {
  OLLAMA_CLOUD_MAX_LINE_BYTES,
  type OllamaCloudNativePreparedRequest,
  ollamaCloudHttpError,
  ollamaCloudNativeBody,
  ollamaCloudNativeEvents,
  stripJsonFence,
} from "./native.js";
export {
  createOllamaCloudProvider,
  OLLAMA_CLOUD_CHAT_ROUTE,
  OLLAMA_CLOUD_NATIVE_ROUTE,
  OLLAMA_CLOUD_SYSTEMONE_PATH,
  type OllamaCloudProviderOptions,
  routeForOllamaCloudRequest,
} from "./provider.js";
