import type { JsonObject, ToolEffectKey, ToolEffectStore } from "./contracts.js";
export type ToolEffectErrorCode = "ERR_PRISM_TOOL_EFFECT_REQUIRED" | "ERR_PRISM_TOOL_EFFECT_CONFLICT" | "ERR_PRISM_TOOL_EFFECT_UNKNOWN" | "ERR_PRISM_TOOL_EFFECT_COMPLETED" | "ERR_PRISM_TOOL_EFFECT_LIMIT";
export declare class ToolEffectError extends Error {
    readonly code: ToolEffectErrorCode;
    constructor(code: ToolEffectErrorCode, message: string);
}
/** Stable JSON representation for an already-validated tool arguments object. */
export declare function canonicalToolEffectJson(value: unknown): string;
export declare function toolEffectArgumentsHash(argumentsValue: JsonObject): string;
/** Derives the only core-authoritative key. Callers never supply this from model input. */
export declare function deriveToolEffectKey(input: Omit<ToolEffectKey, "key" | "signal">): string;
/** In-process reference. Use a durable adapter for cross-replica claims. */
export declare function createMemoryToolEffectStore(options?: {
    readonly now?: () => number;
}): ToolEffectStore;
