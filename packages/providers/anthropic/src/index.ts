/**
 * `@arnilo/prism-provider-anthropic` — the Anthropic Messages provider package.
 *
 * ```ts
 * import anthropic from "@arnilo/prism-provider-anthropic";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "anthropic/claude-sonnet-4-5",
 *   packages: [anthropic({ apiKey: "env:ANTHROPIC_API_KEY" })],
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

import { ANTHROPIC_DEFAULT_BASE_URL, listAnthropicModels } from "./models.js";
import { createAnthropicMessagesProvider } from "./provider.js";

export {
  anthropicCacheEnabled,
  applyAnthropicCacheControl,
} from "./cache.js";
export {
  anthropicMessagesBody,
  anthropicMessagesEvents,
} from "./messages.js";
export {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_BASE_URL,
  type AnthropicModelConfig,
  type AnthropicModelEntry,
  anthropicModels,
  defineAnthropicModel,
  type ListAnthropicModelsOptions,
  listAnthropicModels,
  mapAnthropicModel,
} from "./models.js";
export {
  type AnthropicMessagesProviderOptions,
  anthropicOwnedHeaders,
  createAnthropicMessagesProvider,
} from "./provider.js";
export {
  anthropicEffort,
  anthropicPreserveThinking,
  anthropicThinking,
  stripAnthropicOwnedCompat,
} from "./thinking.js";

/** The `apiKey` ref used when config names none. */
export const ANTHROPIC_DEFAULT_API_KEY_REF = "env:ANTHROPIC_API_KEY";

export interface AnthropicProviderPackageOptions {
  /** Provider id; defaults to `anthropic`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
}

/** The config a host (or a code instance) may set; `apiKey` is a ref, never a value. */
export interface AnthropicProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link ANTHROPIC_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official Messages base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(ANTHROPIC_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty(`Official Messages base; defaults to ${ANTHROPIC_DEFAULT_BASE_URL}.`),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: AnthropicFactoryOptions) {
  return defineProviderPackage<AnthropicProviderConfig>({
    name: "@arnilo/prism-provider-anthropic",
    description: "Anthropic Messages provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "anthropic";
      const ref = prism.config.apiKey ?? ANTHROPIC_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `anthropic: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createAnthropicMessagesProvider({
        id,
        baseUrl,
        apiKey,
        fetch: options.fetch,
        userAgent: options.userAgent,
      });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listAnthropicModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `anthropic({ ... })`. */
export default definition;

/** Factory-only options: `id`, `fetch`, `userAgent`. Credential config stays JSON. */
export type AnthropicFactoryOptions = Pick<AnthropicProviderPackageOptions, "id" | "fetch" | "userAgent">;

/** Instance with factory-only options; `apiKey`/`baseUrl`/`models` are validated config. */
export function anthropic(options: AnthropicProviderPackageOptions & AnthropicProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch", "userAgent"], options);
}
