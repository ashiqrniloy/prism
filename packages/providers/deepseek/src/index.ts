/**
 * `@arnilo/prism-provider-deepseek` — DeepSeek provider package for Prism: registers the deepseek provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire and model catalog.
 *
 * ```ts
 * import deepseek from "@arnilo/prism-provider-deepseek";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "deepseek/deepseek-chat",
 *   packages: [deepseek({ apiKey: "env:DEEPSEEK_API_KEY" })],
 * });
 * ```
 *
 * The key is a ref (`env:`/`keyring:`), never a value: it resolves through the credentials slot on
 * every request, so a rotated or host-captured secret is picked up without rebuilding the provider.
 * A ref that resolves to nothing records a `warn` status note and registers the provider anyway, so
 * `agent.models` still lists the catalog; a run then fails with `credential_unavailable`.
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

import { createDeepSeekProvider } from "./provider.js";
import { listDeepSeekModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const DEEPSEEK_DEFAULT_API_KEY_REF = "env:DEEPSEEK_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface DeepSeekProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link DEEPSEEK_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface DeepSeekProviderPackageOptions {
  /** Provider id; defaults to `deepseek`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(DEEPSEEK_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: DeepSeekProviderPackageOptions) {
  return defineProviderPackage<DeepSeekProviderConfig>({
    name: "@arnilo/prism-provider-deepseek",
    description: "DeepSeek provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "deepseek";
      const ref = prism.config.apiKey ?? DEEPSEEK_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `deepseek: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createDeepSeekProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listDeepSeekModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `deepseek({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function deepseek(options: DeepSeekProviderPackageOptions & DeepSeekProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export { canonicalizeDeepSeekTools, canonicalizeJsonSchema } from "./cache.js";
export {
  DEEPSEEK_THINKING_LEVELS,
  type DeepSeekModelConfig,
  type DeepSeekModelEntry,
  deepseekModels,
  defineDeepSeekModel,
  type ListDeepSeekModelsOptions,
  listDeepSeekModels,
  mapDeepSeekModel,
} from "./models.js";
export {
  createDeepSeekProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  type DeepSeekProviderOptions,
  deepseekBody,
  deepseekEvents,
  toDeepSeekMessage,
} from "./provider.js";
export {
  deepseekReasoningEffort,
  deepseekReplayThinking,
  deepseekThinking,
  mapDeepseekEffort,
} from "./thinking.js";
