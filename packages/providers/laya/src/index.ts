/**
 * `@arnilo/prism-provider-laya` — Laya provider package for Prism: registers the laya provider,
 * resolves its key from an `env:`/`keyring:` ref per request, and ships the System One wire (shared with the provider-kit decision client), and the model catalog.
 *
 * ```ts
 * import laya from "@arnilo/prism-provider-laya";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "laya/laya",
 *   packages: [laya({ apiKey: "env:LAYA_API_KEY" })],
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

import { layaModels } from "./models.js";
import { createLayaProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const LAYA_DEFAULT_API_KEY_REF = "env:LAYA_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface LayaProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to `LAYA_DEFAULT_API_KEY_REF`. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  /** Static catalog. When absent, `models()` returns the curated catalog. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface LayaProviderPackageOptions {
  /** Provider id; defaults to `laya`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(LAYA_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    maxRetries: {
      type: "number",
      minimum: 0,
      description: "Retries after the first attempt; forwarded to the shared System One client (default 2).",
    },
    models: modelsProperty("Static catalog. When absent, `models()` returns the curated catalog."),
  },
  additionalProperties: false,
};

function definitionFor(options: LayaProviderPackageOptions) {
  return defineProviderPackage<LayaProviderConfig>({
    name: "@arnilo/prism-provider-laya",
    description: "Laya provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "laya";
      const ref = prism.config.apiKey ?? LAYA_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `laya: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createLayaProvider({ id, baseUrl, apiKey, fetch: options.fetch, maxRetries: prism.config.maxRetries });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        // This vendor publishes no `/models` endpoint; the curated catalog is the only source.
        async models() {
          return configured ?? layaModels;
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `laya({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function laya(options: LayaProviderPackageOptions & LayaProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  DEFAULT_LAYA_BASE_URL,
  defineLayaModel,
  LAYA_API_KEY_ENV,
  type LayaModelConfig,
  layaBaseUrl,
  layaModels,
} from "./models.js";
export { createLayaProvider, type LayaProviderOptions } from "./provider.js";
