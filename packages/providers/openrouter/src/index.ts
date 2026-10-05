/**
 * `@arnilo/prism-provider-openrouter` — OpenRouter provider package for Prism: registers the openrouter provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire and model catalog.
 *
 * ```ts
 * import openrouter from "@arnilo/prism-provider-openrouter";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openrouter/anthropic/claude-sonnet-4",
 *   packages: [openrouter({ apiKey: "env:OPENROUTER_API_KEY" })],
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

import { createOpenRouterProvider } from "./provider.js";
import { listOpenRouterModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const OPENROUTER_DEFAULT_API_KEY_REF = "env:OPENROUTER_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface OpenRouterProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link OPENROUTER_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** OpenRouter app URL, sent as the `HTTP-Referer` attribution header. */
  readonly appUrl?: string;
  /** OpenRouter app title, sent as the `X-Title` attribution header. */
  readonly appTitle?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface OpenRouterProviderPackageOptions {
  /** Provider id; defaults to `openrouter`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(OPENROUTER_DEFAULT_API_KEY_REF),
    appUrl: { type: "string", description: "OpenRouter app URL (attribution header)." },
    appTitle: { type: "string", description: "OpenRouter app title (attribution header)." },
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: OpenRouterProviderPackageOptions) {
  return defineProviderPackage<OpenRouterProviderConfig>({
    name: "@arnilo/prism-provider-openrouter",
    description: "OpenRouter provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "openrouter";
      const ref = prism.config.apiKey ?? OPENROUTER_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `openrouter: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const appUrl = prism.config.appUrl;
      const appTitle = prism.config.appTitle;
      const provider = createOpenRouterProvider({ id, baseUrl, appUrl, appTitle, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listOpenRouterModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `openrouter({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function openrouter(options: OpenRouterProviderPackageOptions & OpenRouterProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  applyOpenRouterCacheControl,
  OPENROUTER_SESSION_ID_MAX_LENGTH,
  openRouterCacheEnabled,
  openRouterSessionId,
  openRouterTopLevelCacheControl,
  openRouterUsage,
} from "./cache.js";
export { defineOpenRouterModel, type OpenRouterModelConfig } from "./model.js";
export {
  type ListOpenRouterModelsOptions,
  listOpenRouterModels,
  mapOpenRouterModel,
  type OpenRouterModelEntry,
} from "./models.js";
export { createOpenRouterProvider, type OpenRouterProviderOptions, openRouterBody, openRouterEvents } from "./provider.js";
export {
  openRouterPreserveThinking,
  resolveOpenRouterReasoning,
  stripOpenRouterOwnedCompat,
} from "./thinking.js";
