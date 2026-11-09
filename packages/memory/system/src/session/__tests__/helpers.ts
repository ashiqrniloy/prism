import type { ModelClient, ModelConfig, ModelProvider } from "@arnilo/prism";

/** The default worker model a scripted provider answers on. */
export const memoryModel: ModelConfig = { provider: "mock", model: "memory", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

/**
 * A scripted `ModelProvider` as the `ModelClient` the workers take. The workers never resolve a
 * provider or a credential; a host (or a test) hands them the client.
 */
export function clientFor(provider: ModelProvider, model: ModelConfig = memoryModel): ModelClient {
  return { model, generate: (request) => provider.generate({ ...request, model }) };
}
