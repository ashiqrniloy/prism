/** Attention Compiler contracts (plan 074 Tasks 2–5). Opt-in per-turn gate that measures the
 *  assembled input and mutates a history clone only after a host ratio of the model input
 *  cap. `resolveRunAttentionCompiler` turns the agent setting plus an optional run overlay
 *  into the frozen handle the session hands to assembly; nothing declared here runs on its
 *  own, and omitting the option keeps today's request bytes. */
import type { CompactionTrigger } from "./compaction.js";
import type { ModelConfig } from "./content.js";

/** Input-cap resolution inputs shared by the compiler and `input_ratio` compaction triggers. */
export interface AttentionInputCapOptions {
  /** Host cap; when set it wins over `model.limits.contextWindow` (C2). */
  readonly maxInputTokens?: number;
  /** Output + next-turn headroom subtracted from the window (default 1024). */
  readonly reserveTokens?: number;
}

export interface AttentionCompilerOptions extends AttentionInputCapOptions {
  /** Fraction of `inputCap` that triggers mutation; in `(0, 1)` (default 0.75). */
  readonly triggerRatio?: number;
  /** Where compaction should fire relative to `triggerRatio`; must exceed it (default 0.9). */
  readonly compactRatio?: number;
  /** Newest thinking-bearing assistant turns kept intact (default 1). */
  readonly thinkingKeepTurns?: number;
  /** Newest tool results kept full (default 3). */
  readonly keepLast?: number;
  /** Tool names whose results are never stubbed, whatever the ratio. */
  readonly excludeTools?: readonly string[];
}

/** Where the compiler is switched on: `true` uses the defaults, an object tunes them, `false`
 *  (or omitted) leaves requests byte-for-byte as they are without the compiler. On
 *  `RunOptions` the same shape is an overlay: `false` disables, `true` is a no-op, and an
 *  object may only *relax* the agent setting (see `resolveRunAttentionCompiler`). */
export type AttentionCompilerSetting = boolean | AttentionCompilerOptions;

export interface AttentionCompilerContext {
  /** Model limits used to resolve the input cap; ignored when `maxInputTokens` is set. */
  readonly model?: Pick<ModelConfig, "limits">;
  /** Validated at create so an unknown trigger type fails at config time, not on turn one. */
  readonly compactionTrigger?: CompactionTrigger;
}

/** Validated, frozen configuration returned by `createAttentionCompiler`. */
export interface AttentionCompiler {
  readonly inputCap: number;
  readonly reserveTokens: number;
  readonly triggerRatio: number;
  readonly compactRatio: number;
  readonly thinkingKeepTurns: number;
  readonly keepLast: number;
  readonly excludeTools: readonly string[];
}

/** One mutated turn. Under-ratio turns emit nothing and produce no report (C14). */
export interface AttentionReport {
  /** Estimated tokens measured before this turn's mutation — the value compared to the ratio. */
  readonly used: number;
  /** Estimated tokens of the same request after this turn's mutation: the cost curve is `used` → `usedAfter`. */
  readonly usedAfter: number;
  readonly inputCap: number;
  readonly triggerRatio: number;
  /** Thinking turns absent from this request; rows re-applied from the sticky frontier count again. */
  readonly droppedThinkingTurns: number;
  /** Tool results stubbed in this request; rows re-applied from the sticky frontier count again. */
  readonly stubbedToolResults: number;
  /** Payload bytes the stubs took out of this request (never the stub text itself). */
  readonly stubbedBytes: number;
  /** True when the gate stopped with eligible rows left: the sticky frontier is partial. */
  readonly truncated: boolean;
  readonly runId?: string;
  readonly sessionId?: string;
}
