import type { CacheRetention, ContentBlock, Message, ModelConfig, PromptCacheBreakpoint, ProviderRequest, ToolDefinition, Usage } from "../contracts.js";
export interface CacheControlValue {
    readonly type: "ephemeral";
    readonly ttl?: "1h";
}
export interface ApplyCacheControlOptions {
    readonly ttl?: "1h";
    readonly maxBreakpoints?: number;
    readonly hasTools?: boolean;
    readonly tools?: readonly ToolDefinition[];
}
export interface PromptCachePlan {
    readonly messageIndices: ReadonlySet<number>;
    readonly markTools: boolean;
    readonly cacheControl: CacheControlValue;
}
export type CacheControlledContentBlock = ContentBlock & {
    readonly cache_control?: CacheControlValue;
};
export type CacheControlledMessage = Omit<Message, "content"> & {
    readonly content: readonly CacheControlledContentBlock[];
};
export interface CacheUsageReport {
    /** Present only when the provider reported cache-read usage; never fabricated as zero. */
    readonly cacheReadTokens?: number;
    /** Present only when the provider reported cache-write usage; never fabricated as zero. */
    readonly cacheWriteTokens?: number;
    readonly hitRate?: number;
    readonly estimatedSavings?: number;
    readonly currency?: string;
}
export declare function sanitizeCacheKey(value: string | undefined, maxLength: number): string | undefined;
export declare function mapCacheRetention(retention: CacheRetention | undefined, model: ModelConfig): "short" | "long" | undefined;
/** Check if caching is enabled for an Anthropic-format request. */
export declare function anthropicCacheEnabled(request: ProviderRequest): boolean;
/**
 * Resolves cache-control breakpoints against messages and tool definitions.
 * De-duplicates targets first, then applies `maxBreakpoints`.
 */
export declare function resolvePromptCachePlan(messages: readonly Message[], breakpoints: readonly PromptCacheBreakpoint[] | undefined, options?: ApplyCacheControlOptions): PromptCachePlan;
export declare function applyCacheControl(messages: readonly Message[], breakpoints: readonly PromptCacheBreakpoint[], options?: ApplyCacheControlOptions): readonly CacheControlledMessage[];
export interface SystemCacheControlTextBlock {
    readonly type: "text";
    readonly text: string;
    readonly cache_control?: CacheControlValue;
}
/**
 * Provider-style `system` field: plain joined string by default; native text
 * blocks only when cache-control markers must survive (system_prompt breakpoints).
 * Markers never land on an empty block.
 */
export declare function systemCacheControlField(messages: readonly CacheControlledMessage[], toText: (message: Message) => string): string | readonly SystemCacheControlTextBlock[] | undefined;
export declare function cacheHitRate(usage: Usage | undefined): number | undefined;
export declare function cacheSavings(usage: Usage | undefined, model: ModelConfig): number | undefined;
export declare function cacheUsageReport(usage: Usage | undefined, model?: ModelConfig): CacheUsageReport | undefined;
export declare function resolveBreakpoint(messages: readonly Message[], breakpoint: PromptCacheBreakpoint): number;
