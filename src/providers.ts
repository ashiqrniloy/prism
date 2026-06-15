import type { AIProvider, ModelConfig } from "./contracts.js";

export interface ProviderRegistry {
  register(provider: AIProvider): void;
  get(id: string): AIProvider | undefined;
  resolve(model: Pick<ModelConfig, "provider"> | string): AIProvider;
  list(): readonly AIProvider[];
}

export function createProviderRegistry(providers: readonly AIProvider[] = []): ProviderRegistry {
  const byId = new Map<string, AIProvider>();

  const registry: ProviderRegistry = {
    register(provider) {
      byId.set(provider.id, provider);
    },
    get(id) {
      return byId.get(id);
    },
    resolve(model) {
      const id = typeof model === "string" ? model : model.provider;
      const provider = byId.get(id);
      if (!provider) throw new Error(`Unknown provider: ${id}`);
      return provider;
    },
    list() {
      return [...byId.values()];
    },
  };

  for (const provider of providers) registry.register(provider);
  return registry;
}
