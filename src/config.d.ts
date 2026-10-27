import type { JsonObject } from "./contracts.js";
export interface ConfigLoadContext {
    readonly signal?: AbortSignal;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface ConfigProvider {
    readonly name: string;
    load(context?: ConfigLoadContext): Promise<JsonObject | undefined> | JsonObject | undefined;
}
export interface ConfigLayer {
    readonly name: string;
    readonly config: JsonObject;
}
export declare function isJsonObject(value: unknown): value is JsonObject;
export declare function assertJsonObject(value: unknown, label?: string): asserts value is JsonObject;
export declare function loadConfigLayers(providers: readonly ConfigProvider[], context?: ConfigLoadContext): Promise<ConfigLayer[]>;
export declare function mergeConfigLayers(layers: readonly ConfigLayer[]): JsonObject;
