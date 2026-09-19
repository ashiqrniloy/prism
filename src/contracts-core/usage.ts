/** Contracts-core usage family (plan 091 Task 1): labeled token-estimation types.
 *
 * Estimation exists for the "missing usage is never zero usage" accounting rule:
 * when a provider reports no usage, a host may show a labeled approximation. An
 * estimate is never provider truth — reported usage always wins and is never
 * overwritten by one of these. */

/** Model families with a chars/token table (`MODEL_FAMILY_TOKENS`). `unknown`
 *  is the conservative fallback used when a model id/name matches no family. */
export type ModelFamily = "anthropic" | "openai" | "google" | "deepseek" | "openrouter-generic" | "mistral" | "unknown";

/** Confidence label on an estimated token count. `high` is reserved for a real
 *  tokenizer (Prism ships none); the calibrated family tables are `medium`, and
 *  the unknown-family fallback is `low`. */
export type TokenEstimateConfidence = "high" | "medium" | "low";

/** Labeled token estimate. Never conflate with `Usage`: estimates are
 *  approximations for context metering and labeling, reported usage is provider
 *  truth for billing. */
export interface TokenEstimate {
  readonly tokens: number;
  readonly confidence: TokenEstimateConfidence;
  /** Coarse `confidence === "low"` flag for UI badges and host-side labeling. */
  readonly lowConfidence: boolean;
}

/**
 * Context-fill read for hosts (plan 091 Task 2): the latest provider turn's input
 * tokens with their provenance, plus the cap/budget resolved the same way the
 * turn-budget snapshot resolves them. `source: "reported"` means the provider
 * reported those tokens; `"estimated"` means they are a labeled approximation
 * (never billing, never conflated with reported usage). Cap/budget/ratio are
 * absent when the model or run cannot derive them.
 */
export interface ContextMeter {
  readonly inputTokens: number;
  readonly source: "reported" | "estimated";
  /** Per-request input cap from the model window and `attentionCompiler` reserve. */
  readonly inputCap?: number;
  /** Cumulative run input budget (`RunLimits.maxInputTokens`); absent without run limits. */
  readonly runInputBudget?: number;
  /** `inputTokens / inputCap`; absent when no cap is derivable. */
  readonly usedRatio?: number;
}
