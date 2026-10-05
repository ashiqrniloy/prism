import type { ModelProvider, ModelConfig, ProviderResolver } from "../contracts.js";
import { assertCanRegister, type DuplicateRegistrationOptions } from "../registry-options.js";

export interface ProviderRegistry {
  register(provider: ModelProvider): void;
  /** Remove a provider; returns false when the id was not registered. */
  unregister(id: string): boolean;
  get(id: string): ModelProvider | undefined;
  resolve(model: Pick<ModelConfig, "provider"> | string): ModelProvider;
  list(): readonly ModelProvider[];
}

export interface ProviderRegistryOptions extends DuplicateRegistrationOptions {}

export function createProviderRegistry(providers: readonly ModelProvider[] = [], options: ProviderRegistryOptions = {}): ProviderRegistry {
  const byId = new Map<string, ModelProvider>();

  const registry: ProviderRegistry = {
    register(provider) {
      assertCanRegister(byId, provider.id, "provider", provider.id, options.duplicate);
      byId.set(provider.id, provider);
    },
    unregister(id) {
      return byId.delete(id);
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

function isProviderRegistry(source: ProviderRegistry | readonly ModelProvider[]): source is ProviderRegistry {
  return !Array.isArray(source);
}

export function createProviderResolver(source: ProviderRegistry | readonly ModelProvider[]): ProviderResolver {
  // ponytail: array source builds the lookup map once at construction; registry
  // source reuses ProviderRegistry.get so there is one lookup implementation.
  if (isProviderRegistry(source)) {
    return (model) => source.get(model.provider) ?? undefined;
  }
  const lookup = new Map(source.map((p) => [p.id, p]));
  return (model) => lookup.get(model.provider) ?? undefined;
}
