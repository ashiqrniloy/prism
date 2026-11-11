/**
 * `@arnilo/prism-ai/hyper` — Charm Hyper provider package for Prism: registers the hyper provider,
 * resolves its key from an `env:`/`keyring:` ref per request, and ships the dual-route wire (Anthropic Messages and OpenAI Chat), quota/telemetry helpers, and the model catalog.
 *
 * ```ts
 * import hyper from "@arnilo/prism-ai/hyper";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "hyper/hyper",
 *   packages: [hyper({ apiKey: "env:HYPER_API_KEY" })],
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

import { listHyperModels } from "./models.js";
import { createHyperProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const HYPER_DEFAULT_API_KEY_REF = "env:HYPER_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface HyperProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to `HYPER_DEFAULT_API_KEY_REF`. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface HyperProviderPackageOptions {
  /** Provider id; defaults to `hyper`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(HYPER_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: HyperProviderPackageOptions) {
  return defineProviderPackage<HyperProviderConfig>({
    name: "@arnilo/prism-ai/hyper",
    description: "Charm Hyper provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "hyper";
      const ref = prism.config.apiKey ?? HYPER_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `hyper: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createHyperProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listHyperModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `hyper({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function hyper(options: HyperProviderPackageOptions & HyperProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  costFromHyperPricing,
  defineHyperModel,
  HYPER_DEFAULT_BASE_URL,
  type HyperModelConfig,
  type HyperModelEntry,
  type HyperRoute,
  hyperModels,
  listHyperModels,
  mapHyperModel,
  routeForHyperModel,
} from "./models.js";
export {
  createHyperProvider,
  type HyperProviderOptions,
  HYPER_CHAT_ROUTE,
  HYPER_MESSAGES_ROUTE,
  withHyperCost,
} from "./provider.js";
export { type GetHyperCreditsOptions, getHyperCredits, type HyperCreditsBalance } from "./quota.js";
export { type HyperUsageCost, parseHyperUsageCost } from "./telemetry.js";
