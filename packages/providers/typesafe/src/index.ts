/**
 * `@arnilo/prism-provider-typesafe` — TypeSafe Jev provider package for Prism: registers the typesafe provider,
 * resolves its key from an `env:`/`keyring:` ref per request, and ships the System One wire (shared with the provider-kit decision client), and the model catalog.
 *
 * ```ts
 * import typesafe from "@arnilo/prism-provider-typesafe";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "typesafe/typesafe",
 *   packages: [typesafe({ apiKey: "env:TYPESAFE_API_KEY" })],
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

import { typeSafeModels } from "./models.js";
import { createTypeSafeProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const TYPESAFE_DEFAULT_API_KEY_REF = "env:TYPESAFE_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface TypeSafeProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to `TYPESAFE_DEFAULT_API_KEY_REF`. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Retries after the first attempt; forwarded to the shared System One client (default 2). */
  readonly maxRetries?: number;
  /** Static catalog. When absent, `models()` returns the curated catalog. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface TypeSafeProviderPackageOptions {
  /** Provider id; defaults to `typesafe`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(TYPESAFE_DEFAULT_API_KEY_REF),
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

function definitionFor(options: TypeSafeProviderPackageOptions) {
  return defineProviderPackage<TypeSafeProviderConfig>({
    name: "@arnilo/prism-provider-typesafe",
    description: "TypeSafe Jev provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "typesafe";
      const ref = prism.config.apiKey ?? TYPESAFE_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `typesafe: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createTypeSafeProvider({ id, baseUrl, apiKey, fetch: options.fetch, maxRetries: prism.config.maxRetries });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        // This vendor publishes no `/models` endpoint; the curated catalog is the only source.
        async models() {
          return configured ?? typeSafeModels;
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `typesafe({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function typesafe(options: TypeSafeProviderPackageOptions & TypeSafeProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_BASE_URL,
  type TypeSafeModelConfig,
  typeSafeModels,
} from "./models.js";
export { createTypeSafeProvider, type TypeSafeProviderOptions } from "./provider.js";
