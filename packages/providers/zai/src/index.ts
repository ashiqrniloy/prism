/**
 * `@arnilo/prism-provider-zai` — Z.AI provider package for Prism: registers the zai provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire, thinking controls, and model catalog.
 *
 * ```ts
 * import zai from "@arnilo/prism-provider-zai";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "zai/glm-4.7",
 *   packages: [zai({ apiKey: "env:ZAI_API_KEY" })],
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

import { createZaiProvider } from "./provider.js";
import { listZaiModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const ZAI_DEFAULT_API_KEY_REF = "env:ZAI_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface ZaiProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link ZAI_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface ZaiProviderPackageOptions {
  /** Provider id; defaults to `zai`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(ZAI_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: ZaiProviderPackageOptions) {
  return defineProviderPackage<ZaiProviderConfig>({
    name: "@arnilo/prism-provider-zai",
    description: "Z.AI provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "zai";
      const ref = prism.config.apiKey ?? ZAI_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `zai: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createZaiProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listZaiModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `zai({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function zai(options: ZaiProviderPackageOptions & ZaiProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  defineZaiModel,
  isGlm52Model,
  isGlm53Model,
  type ListZaiModelsOptions,
  listZaiModels,
  mapZaiModel,
  ZAI_GLM_5_2_THINKING_LEVELS,
  ZAI_GLM_5_3_THINKING_LEVELS,
  type ZaiModelConfig,
  type ZaiModelEntry,
  zaiModels,
  zaiThinkingFamily,
  zaiThinkingLevels,
} from "./models.js";
export {
  createZaiProvider,
  toZaiMessage,
  ZAI_DEFAULT_BASE_URL,
  type ZaiProviderOptions,
  zaiBody,
  zaiEvents,
} from "./provider.js";
export {
  zaiClearThinking,
  zaiPreserveThinking,
  zaiReasoningEffort,
  zaiThinking,
  zaiToolStream,
} from "./thinking.js";
