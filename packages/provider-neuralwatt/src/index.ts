import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createNeuralWattProvider, type NeuralWattProviderOptions } from "./provider.js";
import { neuralWattModels, defineNeuralWattModel } from "./models.js";

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
  listNeuralWattModels,
  mapNeuralWattModel,
  neuralWattModels,
  type ListNeuralWattModelsOptions,
  type NeuralWattModelConfig,
  type NeuralWattModelEntry,
} from "./models.js";
export { createNeuralWattProvider, neuralWattBody, neuralWattEvents, neuralWattEventsWithTelemetry, toUsage, type NeuralWattProviderOptions, type NeuralWattUsage } from "./provider.js";
export {
  getNeuralWattQuota,
  type GetNeuralWattQuotaOptions,
  type NeuralWattQuota,
  type NeuralWattQuotaBalance,
  type NeuralWattQuotaKey,
  type NeuralWattQuotaLimits,
  type NeuralWattQuotaSubscription,
  type NeuralWattQuotaUsage,
} from "./quota.js";
export {
  neuralWattChatTemplateKwargs,
  neuralWattClearThinking,
  neuralWattPreserveThinking,
  neuralWattReasoningEffort,
  neuralWattThinkingTokenBudget,
  neuralWattToolChoice,
  stripNeuralWattOwnedCompat,
} from "./thinking.js";
export {
  classifyNeuralWattError,
  neuralWattHttpError,
  type NeuralWattErrorInput,
  type NeuralWattRetryDecision,
  type NeuralWattRetryStrategy,
} from "./retry.js";
export {
  mapNeuralWattTelemetry,
  parseNeuralWattComment,
  parseNeuralWattCost,
  parseNeuralWattEnergy,
  type NeuralWattCostTelemetry,
  type NeuralWattEnergyTelemetry,
  type NeuralWattEvent,
  type NeuralWattTelemetryEvent,
} from "./telemetry.js";
