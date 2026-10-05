/**
 * `@arnilo/prism-provider-clinepass` — ClinePass provider package for Prism: registers the clinepass provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire plus the featured model catalog.
 *
 * ```ts
 * import clinepass from "@arnilo/prism-provider-clinepass";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "clinepass/cline-pass/glm-5.2",
 *   packages: [clinepass({ apiKey: "env:CLINEPASS_API_KEY" })],
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

import { createClinePassProvider } from "./provider.js";
import { clinePassModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const CLINEPASS_DEFAULT_API_KEY_REF = "env:CLINEPASS_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface ClinePassProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link CLINEPASS_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog override. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface ClinePassProviderPackageOptions {
  /** Provider id; defaults to `clinepass`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(CLINEPASS_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog override."),
  },
  additionalProperties: false,
};

function definitionFor(options: ClinePassProviderPackageOptions) {
  return defineProviderPackage<ClinePassProviderConfig>({
    name: "@arnilo/prism-provider-clinepass",
    description: "ClinePass provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "clinepass";
      const ref = prism.config.apiKey ?? CLINEPASS_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // featured catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `clinepass: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createClinePassProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        // ClinePass publishes no `/models` endpoint; the featured catalog is the only source.
        async models() {
          return configured ?? clinePassModels;
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `clinepass({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function clinepass(options: ClinePassProviderPackageOptions & ClinePassProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  CLINEPASS_DEFAULT_BASE_URL,
  CLINEPASS_FEATURED_SLUGS,
  type ClinePassModelConfig,
  clinePassModels,
  defineClinePassModel,
} from "./models.js";
export {
  type ClinePassProviderOptions,
  clinePassBody,
  clinePassEvents,
  createClinePassProvider,
} from "./provider.js";
export {
  CLINEPASS_THINKING_MAPS,
  type ClinePassThinkingLevelMap,
  type ClinePassThinkingSlot,
  clinePassDeclaredLevels,
  clinePassReasoningEffort,
  clinePassThinkingLevelMap,
  clinePassThinkingSlot,
} from "./thinking.js";
