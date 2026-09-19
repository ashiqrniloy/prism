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

/** Fold axes (plan 086 T2). `input_ratio` is the legacy `triggerRatio` axis; the rest are new. */
export type AttentionTriggerKind = "input_ratio" | "run_input_ratio" | "token_floor" | "predicate";

/** Per-turn inputs an axis reads. Frozen before a `predicate` sees it; estimates and ids only. */
export interface AttentionTriggerState {
  /** Estimated tokens of the request this turn will send — what the ratio axes compare. */
  readonly estimatedInputTokens: number;
  /** Resolved per-request input cap (`resolveInputCap`). */
  readonly inputCapTokens: number;
  /** Cumulative run input budget when the run limits declare one; absent falls back to `inputCapTokens`. */
  readonly runInputBudgetTokens?: number;
  /** Run input tokens already charged by provider usage this run (0 when unknown). */
  readonly runInputTokens: number;
  /** 1-based provider turn index. */
  readonly turn: number;
}

/** Host predicate axis. Runs host-supplied code under the same trust as `CompactionTrigger.custom`. */
export type AttentionTriggerFunction = (state: AttentionTriggerState) => boolean;

/** One fold gate. An array is any-of; the first axis that fires is the one attributed. */
export type AttentionTrigger =
  /** Legacy axis: fires when the assembled request reaches `ratio` of the per-request input cap. */
  | { readonly kind: "input_ratio"; readonly ratio: number }
  /** Cumulative axis: fires when `runInputTokens + estimatedInputTokens` reaches `ratio` of the run
   *  input budget, so a run capped below the window folds before the cap kills it. Falls back to
   *  the `input_ratio` comparison when the run limits declare no input budget. */
  | { readonly kind: "run_input_ratio"; readonly ratio: number }
  /** Absolute axis: fires when the assembled request reaches `tokens`, whatever the cap. */
  | { readonly kind: "token_floor"; readonly tokens: number }
  /** Host axis: fires when `shouldFold` returns `true`. Called once per turn; must be synchronous. */
  | { readonly kind: "predicate"; readonly shouldFold: AttentionTriggerFunction };

/** Accepted `trigger` value: one axis, one predicate, or an any-of array of either. */
export type AttentionTriggerInput = AttentionTrigger | AttentionTriggerFunction | readonly (AttentionTrigger | AttentionTriggerFunction)[];

/** Result of evaluating the axes once against one turn's state. */
export interface AttentionTriggerDecision {
  readonly shouldFold: boolean;
  /** First axis that fired, in configured order (plan 087 attribution). */
  readonly firedAxis?: AttentionTriggerKind;
  /** Estimated-token target the sticky stages fold to; absent = fold every eligible row. */
  readonly targetTokens?: number;
  /** `true` when folding this request can settle the fired axis, so a still-firing axis after every
   *  eligible row throws `AttentionBudgetError`. Cumulative `run_input_ratio` axes are `false`: the
   *  spend is already booked, folding only slows the counter, and the run limit owns the cap. */
  readonly failsClosed: boolean;
}

export interface AttentionCompilerOptions extends AttentionInputCapOptions {
  /** Fraction of `inputCap` that triggers mutation; in `(0, 1)` (default 0.75). */
  readonly triggerRatio?: number;
  /**
   * Fold axes (plan 086 T2). Omitted keeps the `triggerRatio` axis alone, so requests gate
   * exactly as before. Given, it **replaces** the `triggerRatio` axis: the gate is the any-of of
   * the listed axes, and `triggerRatio` stays the input-ratio reference for `compactRatio` and
   * the report. A run overlay may not set it (the gate is agent-config only).
   *
   * Predicate axes execute host-supplied code, trusted exactly like `CompactionTrigger.custom`:
   * the function runs once per turn with a frozen `AttentionTriggerState` and must return a
   * boolean synchronously (a `Promise` return fails closed with a `TypeError`).
   */
  readonly trigger?: AttentionTriggerInput;
  /** Where compaction should fire relative to `triggerRatio`; must exceed it (default 0.9). */
  readonly compactRatio?: number;
  /** Newest thinking-bearing assistant turns kept intact (default 1). */
  readonly thinkingKeepTurns?: number;
  /** Newest tool results kept full (default 3). */
  readonly keepLast?: number;
  /** Tool names whose results are never stubbed, whatever the ratio. */
  readonly excludeTools?: readonly string[];
  /**
   * Durable folding (plan 086 T3): persist the fold ledger and its sticky frontier into the
   * run's checkpoint at each fold, and restore them before the first turn after a resume.
   * Requires a durable run (`runState` with a checkpoint store); independent of
   * `persistSessionState`, which governs skill/tool session state instead.
   *
   * Off by default: durable folding costs one extra checkpoint write per fold (never per turn)
   * and stores the folded bodies — already redacted, capped by `maxSummaryBytes` — so a resumed
   * request carries the same folded rows a live run would. A run overlay may not set it.
   */
  readonly durable?: boolean;
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
  /** Cumulative run input budget the `run_input_ratio` axis folds against (the resolved
   *  `RunLimits.maxInputTokens`); `null`/omitted means no run budget, so that axis falls back to
   *  the per-request input cap. Distinct from `maxInputTokens`, which caps one request. */
  readonly runInputBudget?: number | null;
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
  /** Normalized, frozen fold axes in evaluation order: the `input_ratio` default when no
   *  `trigger` was configured, otherwise exactly the configured axes. */
  readonly trigger: readonly AttentionTrigger[];
  /** Run input budget resolved at create; absent when the run limits declare none. */
  readonly runInputBudget?: number;
  /** Durable folding resolved at create (plan 086 T3); `true` opts the run's fold state into
   *  checkpoint persistence, so `assembleProviderInput` callers should pass the ledger. */
  readonly durable: boolean;
}

/** One mutated turn. Under-ratio turns emit nothing and produce no report (C14). */
export interface AttentionReport {
  /** Estimated tokens measured before this turn's mutation — the value compared to the ratio. */
  readonly used: number;
  /** Estimated tokens of the same request after this turn's mutation: the cost curve is `used` → `usedAfter`. */
  readonly usedAfter: number;
  readonly inputCap: number;
  readonly triggerRatio: number;
  /** Axis that opened the gate on this turn, when one did (plan 087 attribution). */
  readonly firedAxis?: AttentionTriggerKind;
  /** Thinking turns absent from this request; rows re-applied from the sticky frontier count again. */
  readonly droppedThinkingTurns: number;
  /** Tool results stubbed in this request; rows re-applied from the sticky frontier count again. */
  readonly stubbedToolResults: number;
  /** Payload bytes the stubs took out of this request (never the stub text itself). */
  readonly stubbedBytes: number;
  /** Folded bodies this turn added to the ledger — the summarize calls a cache saved, and the
   *  signal that a durable fold has new state to checkpoint (plan 086 T3). Zero on a turn that
   *  only re-applied bodies the ledger already held. */
  readonly newFoldedBodies: number;
  /** True when the gate stopped with eligible rows left: the sticky frontier is partial. */
  readonly truncated: boolean;
  readonly runId?: string;
  readonly sessionId?: string;
}
