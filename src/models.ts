import type { ModelConfig } from "./contracts.js";

export interface ModelRegistry {
  register(model: ModelConfig): void;
  get(provider: string, model: string): ModelConfig | undefined;
  resolve(provider: string, model: string): ModelConfig;
  list(): readonly ModelConfig[];
}

export function createModelRegistry(models: readonly ModelConfig[] = []): ModelRegistry {
  const byId = new Map<string, ModelConfig>();
  const key = (provider: string, model: string) => `${provider}\0${model}`;

  const registry: ModelRegistry = {
    register(model) {
      byId.set(key(model.provider, model.model), model);
    },
    get(provider, model) {
      return byId.get(key(provider, model));
    },
    resolve(provider, model) {
      const config = byId.get(key(provider, model));
      if (!config) throw new Error(`Unknown model: ${provider}/${model}`);
      return config;
    },
    list() {
      return [...byId.values()];
    },
  };

  for (const model of models) registry.register(model);
  return registry;
}
