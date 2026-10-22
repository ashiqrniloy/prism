/**
 * `@arnilo/prism-provider-opencode-go` — OpenCode Go provider package for Prism: registers the opencode-go provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible and Anthropic Messages wires plus the model catalog.
 *
 * ```ts
 * import opencodeGo from "@arnilo/prism-provider-opencode-go";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "opencode-go/gpt-5.1-go",
 *   packages: [opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })],
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

import { createOpenCodeGoProvider } from "./provider.js";
import { listOpenCodeGoModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const OPENCODE_GO_DEFAULT_API_KEY_REF = "env:OPENCODE_GO_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface OpenCodeGoProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link OPENCODE_GO_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface OpenCodeGoProviderPackageOptions {
  /** Provider id; defaults to `opencode-go`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(OPENCODE_GO_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: OpenCodeGoProviderPackageOptions) {
  return defineProviderPackage<OpenCodeGoProviderConfig>({
    name: "@arnilo/prism-provider-opencode-go",
    description: "OpenCode Go provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "opencode-go";
      const ref = prism.config.apiKey ?? OPENCODE_GO_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `opencode-go: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createOpenCodeGoProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listOpenCodeGoModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `opencodeGo({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function opencodeGo(options: OpenCodeGoProviderPackageOptions & OpenCodeGoProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  createOpenCodeGoProvider,
  type OpenCodeGoProviderOptions,
  OPENCODE_GO_CHAT_ROUTE,
  OPENCODE_GO_MESSAGES_ROUTE,
  opencodeSession,
  OPENCODE_SESSION_ID_MAX_LENGTH,
} from "./provider.js";
export {
  defineOpenCodeGoModel,
  type ListOpenCodeGoModelsOptions,
  listOpenCodeGoModels,
  mapOpenCodeGoModel,
  OPENCODE_GO_DEFAULT_BASE_URL,
  type OpenCodeGoModelConfig,
  type OpenCodeGoModelEntry,
  type OpenCodeGoRoute,
  openCodeGoModels,
  openCodeGoThinkingFamily,
  openCodeGoThinkingLevels,
  routeForOpenCodeGoModel,
} from "./models.js";

