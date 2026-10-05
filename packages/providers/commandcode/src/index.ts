/**
 * `@arnilo/prism-provider-commandcode` — Command Code provider package for Prism: registers the commandcode provider,
 * resolves its key from an `env:`/`keyring:` ref per request, and ships the dual-route wire (Anthropic Messages and OpenAI Chat), retry classification, cache/thinking helpers, and the model catalog.
 *
 * ```ts
 * import commandcode from "@arnilo/prism-provider-commandcode";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "commandcode/commandcode",
 *   packages: [commandcode({ apiKey: "env:COMMANDCODE_API_KEY" })],
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

import { listCommandCodeModels } from "./models.js";
import { createCommandCodeProvider } from "./provider.js";

/** The `apiKey` ref used when config names none. */
export const COMMANDCODE_DEFAULT_API_KEY_REF = "env:COMMANDCODE_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface CommandCodeProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to `COMMANDCODE_DEFAULT_API_KEY_REF`. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /**
   * Enforce zero data retention (`x-cmd-zdr: 1`). Requests then route only through
   * ZDR-capable upstreams; a model without one fails with `422 cmd_zdr_no_providers`.
   */
  readonly zdr?: boolean;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface CommandCodeProviderPackageOptions {
  /** Provider id; defaults to `commandcode`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(COMMANDCODE_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    zdr: {
      type: "boolean",
      description: "Add the provider-owned `x-cmd-zdr: 1` header so requests route only through ZDR-capable upstreams.",
    },
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: CommandCodeProviderPackageOptions) {
  return defineProviderPackage<CommandCodeProviderConfig>({
    name: "@arnilo/prism-provider-commandcode",
    description: "Command Code provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "commandcode";
      const ref = prism.config.apiKey ?? COMMANDCODE_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `commandcode: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createCommandCodeProvider({ id, baseUrl, apiKey, fetch: options.fetch, zdr: prism.config.zdr });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listCommandCodeModels({ provider: id, baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `commandcode({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function commandcode(options: CommandCodeProviderPackageOptions & CommandCodeProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export { applyCommandCodeCacheControl, commandCodeCacheEnabled } from "./cache.js";
export {
  type CommandCodeErrorInput,
  type CommandCodeRetryDecision,
  classifyCommandCodeError,
  commandCodeHttpError,
} from "./errors.js";
export {
  COMMAND_CODE_DEFAULT_BASE_URL,
  type CommandCodeModelConfig,
  type CommandCodeModelEntry,
  type CommandCodeRoute,
  commandCodeModels,
  commandCodeThinkingFamily,
  commandCodeThinkingLevels,
  defineCommandCodeModel,
  listCommandCodeModels,
  mapCommandCodeModel,
  routeForCommandCodeModel,
} from "./models.js";
export { commandCodeChatBody, commandCodeChatEvents, serializeCommandCodeChatMessage } from "./openai-chat.js";
export {
  COMMAND_CODE_ANTHROPIC_HOOKS,
  type CommandCodeProviderOptions,
  createCommandCodeProvider,
} from "./provider.js";
export {
  commandCodeEffort,
  commandCodePreserveThinking,
  commandCodeReasoning,
  commandCodeThinking,
  stripCommandCodeOwnedCompat,
} from "./thinking.js";
