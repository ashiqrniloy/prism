/**
 * `@arnilo/prism-provider-google` — the Google Gemini generateContent provider package.
 *
 * ```ts
 * import google from "@arnilo/prism-provider-google";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "google/gemini-2.5-flash",
 *   packages: [google({ apiKey: "env:GEMINI_API_KEY" })],
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

import { GOOGLE_DEFAULT_BASE_URL, listGoogleModels } from "./models.js";
import { createGoogleGenerateContentProvider } from "./provider.js";

export {
  googleGenerateContentBody,
  googleGenerateContentEvents,
} from "./generate-content.js";
export {
  type CreateGoogleModelDiscoveryOptions,
  createGoogleModelDiscovery,
} from "./model-discovery.js";
export {
  defineGoogleModel,
  GOOGLE_DEFAULT_BASE_URL,
  type GoogleModelConfig,
  type GoogleModelEntry,
  googleModels,
  type ListGoogleModelsOptions,
  listGoogleModels,
  mapGoogleModel,
  stripModelsPrefix,
} from "./models.js";
export {
  createGoogleGenerateContentProvider,
  type GoogleGenerateContentProviderOptions,
  googleOwnedHeaders,
} from "./provider.js";
export {
  googlePreserveThinking,
  googleThinkingConfig,
  stripGoogleOwnedCompat,
} from "./thinking.js";

/** The `apiKey` ref used when config names none. */
export const GOOGLE_DEFAULT_API_KEY_REF = "env:GEMINI_API_KEY";

export interface GoogleProviderPackageOptions {
  /** Provider id; defaults to `google`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  /** Sent as `user-agent` on every request (provider-owned). */
  readonly userAgent?: string;
}

/** The config a host (or a code instance) may set; `apiKey` is a ref, never a value. */
export interface GoogleProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link GOOGLE_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Gemini API base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(GOOGLE_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty(`Gemini API base; defaults to ${GOOGLE_DEFAULT_BASE_URL}.`),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: GoogleFactoryOptions) {
  return defineProviderPackage<GoogleProviderConfig>({
    name: "@arnilo/prism-provider-google",
    description: "Google Gemini generateContent provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "google";
      const ref = prism.config.apiKey ?? GOOGLE_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `google: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createGoogleGenerateContentProvider({
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
          return listGoogleModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `google({ ... })`. */
export default definition;

/** Factory-only options: `id`, `fetch`, `userAgent`. Credential config stays JSON. */
export type GoogleFactoryOptions = Pick<GoogleProviderPackageOptions, "id" | "fetch" | "userAgent">;

/** Instance with factory-only options; `apiKey`/`baseUrl`/`models` are validated config. */
export function google(options: GoogleProviderPackageOptions & GoogleProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch", "userAgent"], options);
}
