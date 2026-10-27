import type { ModelConfig } from "../contracts.js";
import { type DuplicateRegistrationOptions } from "../registry-options.js";
export interface ModelRegistry {
    register(model: ModelConfig): void;
    /** Remove a model; returns false when it was not registered. */
    unregister(provider: string, model: string): boolean;
    get(provider: string, model: string): ModelConfig | undefined;
    resolve(provider: string, model: string): ModelConfig;
    list(): readonly ModelConfig[];
}
export interface ModelRegistryOptions extends DuplicateRegistrationOptions {
}
export declare function createModelRegistry(models?: readonly ModelConfig[], options?: ModelRegistryOptions): ModelRegistry;
