/** Context-overflow failures (plan 194 Task 3): the provider rejected a request that was too big. */
/** Numbers only: never prompt text (the message carries counts, and the original body stays redacted). */
export interface ContextOverflowCounts {
    readonly estimatedTokens: number;
    readonly windowTokens?: number;
    /** The provider started streaming before it failed, so no retry can replay it safely. */
    readonly started?: boolean;
    /** The request had already been compacted once. */
    readonly afterCompaction?: boolean;
}
/**
 * The run failed because the input does not fit the model's context window — even after the one
 * compaction retry, or after output had already started. `code` is the stable machine handle.
 */
export declare class ContextOverflowError extends Error {
    readonly code = "context_overflow";
    readonly estimatedTokens?: number;
    readonly windowTokens?: number;
    constructor(message: string, counts?: ContextOverflowCounts, cause?: unknown);
}
/** Internal seam: the failed attempt is recoverable (no output started); the session may compact once. */
export declare class ProviderOverflowRecovery extends Error {
    readonly info: import("../contracts.js").ErrorInfo;
    readonly counts: ContextOverflowCounts;
    constructor(info: import("../contracts.js").ErrorInfo, counts: ContextOverflowCounts);
}
/** One message shape for both terminal overflow cases, with the counts and the reason it was final. */
export declare function contextOverflowMessage(counts: ContextOverflowCounts): string;
