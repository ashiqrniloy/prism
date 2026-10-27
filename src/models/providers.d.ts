import type { ModelProvider, ModelConfig, ProviderResolver } from "../contracts.js";
import { type DuplicateRegistrationOptions } from "../registry-options.js";
export interface ProviderRegistry {
    register(provider: ModelProvider): void;
    /** Remove a provider; returns false when the id was not registered. */
    unregister(id: string): boolean;
    get(id: string): ModelProvider | undefined;
    resolve(model: Pick<ModelConfig, "provider"> | string): ModelProvider;
    list(): readonly ModelProvider[];
}
export interface ProviderRegistryOptions extends DuplicateRegistrationOptions {
}
export declare function createProviderRegistry(providers?: readonly ModelProvider[], options?: ProviderRegistryOptions): ProviderRegistry;
export declare function createProviderResolver(source: ProviderRegistry | readonly ModelProvider[]): ProviderResolver;
