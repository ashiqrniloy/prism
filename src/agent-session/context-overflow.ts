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
export class ContextOverflowError extends Error {
  readonly code = "context_overflow";
  readonly estimatedTokens?: number;
  readonly windowTokens?: number;

  constructor(message: string, counts: ContextOverflowCounts = { estimatedTokens: 0 }, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ContextOverflowError";
    this.estimatedTokens = counts.estimatedTokens;
    this.windowTokens = counts.windowTokens;
  }
}

/** Internal seam: the failed attempt is recoverable (no output started); the session may compact once. */
export class ProviderOverflowRecovery extends Error {
  constructor(
    readonly info: import("../contracts.js").ErrorInfo,
    readonly counts: ContextOverflowCounts,
  ) {
    super(info.message);
    this.name = "ProviderOverflowRecovery";
  }
}

function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** One message shape for both terminal overflow cases, with the counts and the reason it was final. */
export function contextOverflowMessage(counts: ContextOverflowCounts): string {
  const window = counts.windowTokens === undefined ? "the model window" : `window ${count(counts.windowTokens)}`;
  const tail = counts.started
    ? "the model had already started a response"
    : counts.afterCompaction
      ? "the retry was rejected after compaction"
      : "the request was rejected";
  return `input ~${count(counts.estimatedTokens)} tokens exceeds ${window}: ${tail}`;
}
