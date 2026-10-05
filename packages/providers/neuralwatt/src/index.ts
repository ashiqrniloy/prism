/**
 * `@arnilo/prism-provider-neuralwatt` — NeuralWatt provider package for Prism: registers the neuralwatt provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the OpenAI-compatible wire, quota/telemetry helpers, and model catalog.
 *
 * ```ts
 * import neuralwatt from "@arnilo/prism-provider-neuralwatt";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "neuralwatt/glm-5.2",
 *   packages: [neuralwatt({ apiKey: "env:NEURALWATT_API_KEY" })],
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

import { createNeuralWattProvider } from "./provider.js";
import { listNeuralWattModels } from "./models.js";

/** The `apiKey` ref used when config names none. */
export const NEURALWATT_DEFAULT_API_KEY_REF = "env:NEURALWATT_API_KEY";

/** The config a host (or a code instance) may set; every secret field is a ref, never a value. */
export interface NeuralWattProviderConfig {
  /** An `env:`/`keyring:` ref; defaults to {@link NEURALWATT_DEFAULT_API_KEY_REF}. */
  readonly apiKey?: string;
  /** Official base; defaults to the vendor default. */
  readonly baseUrl?: string;
  /** Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. */
  readonly models?: readonly ModelConfig[];
}

/** Factory-only options: not JSON, so they cannot come from a manifest. */
export interface NeuralWattProviderPackageOptions {
  /** Provider id; defaults to `neuralwatt`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    apiKey: secretRefProperty(NEURALWATT_DEFAULT_API_KEY_REF),
    baseUrl: baseUrlProperty("Official base; defaults to the vendor default."),
    models: modelsProperty("Static catalog. When absent, `models()` asks the vendor's `/models` endpoint."),
  },
  additionalProperties: false,
};

function definitionFor(options: NeuralWattProviderPackageOptions) {
  return defineProviderPackage<NeuralWattProviderConfig>({
    name: "@arnilo/prism-provider-neuralwatt",
    description: "NeuralWatt provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "neuralwatt";
      const ref = prism.config.apiKey ?? NEURALWATT_DEFAULT_API_KEY_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const apiKey = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`, and the
      // catalog should still list. The note is what a host shows the user.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `neuralwatt: no API key at ${ref}`);
      const baseUrl = prism.config.baseUrl;
      const provider = createNeuralWattProvider({ id, baseUrl, apiKey, fetch: options.fetch });
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          if (configured !== undefined) return configured;
          return listNeuralWattModels({ baseUrl, apiKey, fetch: options.fetch });
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `neuralwatt({ ... })`. */
export default definition;

/** Instance with factory-only options; the secret refs, `baseUrl`, and `models` are validated config. */
export function neuralwatt(options: NeuralWattProviderPackageOptions & NeuralWattProviderConfig = {}): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}

export {
  defineNeuralWattModel,
  type ListNeuralWattModelsOptions,
  listNeuralWattModels,
  mapNeuralWattModel,
  NEURALWATT_THINKING_LEVELS,
  type NeuralWattModelConfig,
  type NeuralWattModelEntry,
  neuralWattModels,
} from "./models.js";
export {
  createNeuralWattProvider,
  type NeuralWattProviderOptions,
  type NeuralWattUsage,
  neuralWattBody,
  neuralWattEvents,
  neuralWattEventsWithTelemetry,
  toUsage,
} from "./provider.js";
export {
  type GetNeuralWattQuotaOptions,
  getNeuralWattQuota,
  type NeuralWattQuota,
  type NeuralWattQuotaBalance,
  type NeuralWattQuotaKey,
  type NeuralWattQuotaLimits,
  type NeuralWattQuotaSubscription,
  type NeuralWattQuotaUsage,
} from "./quota.js";
export {
  classifyNeuralWattError,
  type NeuralWattErrorInput,
  type NeuralWattRetryDecision,
  type NeuralWattRetryStrategy,
  neuralWattHttpError,
} from "./retry.js";
export {
  mapNeuralWattTelemetry,
  type NeuralWattCostTelemetry,
  type NeuralWattEnergyTelemetry,
  type NeuralWattEvent,
  type NeuralWattTelemetryEvent,
  parseNeuralWattComment,
  parseNeuralWattCost,
  parseNeuralWattEnergy,
} from "./telemetry.js";
export {
  neuralWattChatTemplateKwargs,
  neuralWattClearThinking,
  neuralWattPreserveThinking,
  neuralWattReasoningEffort,
  neuralWattThinkingTokenBudget,
  neuralWattToolChoice,
  stripNeuralWattOwnedCompat,
} from "./thinking.js";
