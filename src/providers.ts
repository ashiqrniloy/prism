import type { AIProvider, ModelConfig, ProviderResolver } from "./contracts.js";

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

function isProviderRegistry(source: ProviderRegistry | readonly AIProvider[]): source is ProviderRegistry {
  return !Array.isArray(source);
}

export function createProviderResolver(source: ProviderRegistry | readonly AIProvider[]): ProviderResolver {
  // ponytail: array source builds the lookup map once at construction; registry
  // source reuses ProviderRegistry.get so there is one lookup implementation.
  if (isProviderRegistry(source)) {
    return (model) => source.get(model.provider) ?? undefined;
  }
  const lookup = new Map(source.map((p) => [p.id, p]));
  return (model) => lookup.get(model.provider) ?? undefined;
}
