import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelsProperty,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";
import { assertLiteLLMBaseUrl } from "./base-url.js";
import { createLiteLLMProvider } from "./provider.js";
import { LITELLM_DEFAULT_BASE_URL, listLiteLLMModels } from "./models.js";

export const LITELLM_DEFAULT_API_KEY_REF = "env:LITELLM_API_KEY";

export interface LiteLLMProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link LITELLM_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Proxy base; `http:` only for a loopback host. Defaults to `http://127.0.0.1:4000`. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks `GET /model/info` (fallback `/v1/models`). */
  readonly models?: readonly ModelConfig[];
}

export interface LiteLLMProviderPackageOptions {
  readonly id?: string;
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    apiKey: secretRefProperty(LITELLM_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("LiteLLM Proxy base; defaults to http://127.0.0.1:4000. Plain http is accepted only for loopback."),
    models: modelsProperty("Static catalog; otherwise each models() call fetches /model/info."),
  },
};

function definitionFor(options: LiteLLMProviderPackageOptions) {
  return defineProviderPackage<LiteLLMProviderConfig>({
    name: "@arnilo/prism-ai/litellm",
    description: "LiteLLM Proxy provider package for Prism: one Chat route with per-call proxy telemetry.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "litellm";
      const baseUrl = prism.config.baseUrl ?? LITELLM_DEFAULT_BASE_URL;
      assertLiteLLMBaseUrl(baseUrl);
      const ref = prism.config.apiKey ?? LITELLM_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // A proxy started without a master key accepts anonymous requests, so no key is not an error.
      if ((await resolve(ref)) === undefined)
        prism.status.note("info", `litellm: no key at ${ref}; requests are sent without Authorization`);
      const provider = createLiteLLMProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      prism.providers.register({
        ...provider,
        auth: [{ kind: "api-key", ref }],
        async models() {
          return prism.config.models ?? listLiteLLMModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});
export default definition;

export function litellm(options: LiteLLMProviderPackageOptions & LiteLLMProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export { assertLiteLLMBaseUrl, isLoopbackHost } from "./base-url.js";
export {
  LITELLM_CALL_ID_HEADER,
  LITELLM_HEADER_VALUE_LIMIT,
  LITELLM_HEADERS,
  type LiteLLMTelemetry,
  liteLLMUsageMetadata,
  readLiteLLMApiBase,
  readLiteLLMCost,
  readLiteLLMHeaders,
} from "./headers.js";
export {
  groupLiteLLMModelInfo,
  LITELLM_DEFAULT_BASE_URL,
  type ListLiteLLMModelsOptions,
  type LiteLLMModelInfoEntry,
  listLiteLLMModels,
} from "./models.js";
export {
  type LiteLLMSpendLogsOptions,
  type LiteLLMSpendLogsResult,
  type LiteLLMSpendRow,
  LITELLM_SPEND_WAIT_CAP_MS,
  LITELLM_SPEND_WAIT_MS,
  litellmSpendLogs,
  normalizeSpendRow,
} from "./spend-logs.js";
export {
  createLiteLLMProvider,
  LITELLM_CALL_ID_METADATA,
  type LiteLLMProviderOptions,
  litellmHttpError,
  mapLiteLLMUsage,
} from "./provider.js";
