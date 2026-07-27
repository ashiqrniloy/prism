import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { neuralWattModels } from "./models.js";
import { createNeuralWattProvider } from "./provider.js";

export interface NeuralWattProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly models?: readonly ModelConfig[];
}

export function createNeuralWattProviderPackage(options: NeuralWattProviderPackageOptions = {}): ProviderPackage {
  const providerId = options.id ?? "neuralwatt";
  return defineProviderPackage({
    name: "@arnilo/prism-provider-neuralwatt",
    description: "NeuralWatt provider package for Prism.",
    docs: { links: ["docs/providers/neuralwatt.md"] },
    setup(api) {
      api.registerProvider(createNeuralWattProvider(options));
      for (const model of options.models ?? neuralWattModels) api.registerModel({ ...model, provider: providerId });
      api.registerAuthMethod({ kind: "api_key", provider: providerId, credentialName: "apiKey" });
    },
  });
}

export {
  defineNeuralWattModel,
  type ListNeuralWattModelsOptions,
  listNeuralWattModels,
  mapNeuralWattModel,
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
