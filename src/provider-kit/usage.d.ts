import type { JsonObject, Usage } from "../contracts-core/content.js";
export interface RawUsageInput {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly cost?: number;
    readonly currency?: string;
    readonly estimated?: boolean;
    /**
     * If false, `inputTokens` is treated as exclusive of cache read and cache creation tokens
     * (Anthropic wire convention where `input_tokens` only counts uncached prompt tokens).
     * When false, `normalizeUsage` adds `cacheReadTokens` and `cacheWriteTokens` to `inputTokens`
     * to compute the inclusive total prompt token count.
     * Defaults to true (inclusive inputTokens, OpenAI / Prism convention).
     */
    readonly inputTokensInclusive?: boolean;
    /** Provider-specific metadata or monetization telemetry. */
    readonly metadata?: JsonObject;
}
/**
 * Normalizes provider wire usage into the Prism inclusive `Usage` contract:
 * - `inputTokens`: every prompt token (inclusive of cache reads and cache writes).
 * - `cacheReadTokens` / `cacheWriteTokens`: non-negative subsets of `inputTokens`.
 * - `totalTokens`: `inputTokens + outputTokens` when the vendor omits it.
 *
 * This is the single normalization seam for codecs building `Usage`.
 */
export declare function normalizeUsage(raw: RawUsageInput | undefined): Usage | undefined;
