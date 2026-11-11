import type { ModelClient, ModelConfig, ModelProvider, ProviderRequest } from "@arnilo/prism";
import type { SummaryClientFor } from "../strategy.js";

/**
 * A `SummaryClientFor` over a scripted provider: the client's model carries the per-call output budget
 * the compactor computed, exactly as the package's `prism.models.client` wiring does.
 */
export function summaryClient(provider: ModelProvider, model: ModelConfig): SummaryClientFor {
  return (maxTokens) => withBudget(provider, model, maxTokens);
}

export function withBudget(provider: ModelProvider, model: ModelConfig, maxTokens: number): ModelClient {
  const budgeted: ModelConfig = { ...model, parameters: { ...model.parameters, maxTokens } };
  return {
    model: budgeted,
    generate: (request: Omit<ProviderRequest, "model">) => provider.generate({ ...request, model: budgeted }),
  };
}
