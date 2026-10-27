/** Model-family chars/token tables and the family text estimator (plan 091 Task 1).
 *
 * Pure and O(text length): no network, no I/O, no content retention. These are
 * heuristics, not tokenizers — harnesses universally approximate. Reported usage
 * always wins; estimates exist so missing usage is never shown as zero.
 *
 * Ratio provenance: `openai` is calibrated against `o200k_base` counts on the
 * in-repo fixtures (`src/__tests__/usage-estimation.test.ts`); the other families
 * use their published tokenizer guidance ranges and are intentionally rounded
 * toward over-counting, because an overestimated context meter is safe while an
 * underestimated one under-compacts. `unknown` is the most conservative table so
 * an unidentified model can never look smaller than a known one.
 */
import type { ModelFamily, TokenEstimateConfidence } from "./contracts-core/usage.js";
/** Row of {@link MODEL_FAMILY_TOKENS}: prose chars per token, chat-template
 *  tokens added once per message, and the confidence label for the table. */
export interface ModelFamilyTokens {
    readonly charsPerToken: number;
    readonly perMessageOverhead: number;
    readonly confidence: TokenEstimateConfidence;
}
/** Per-family chars/token tables (plan 091 Task 1). Estimates only, never billing.
 *
 * Deep-frozen — each row, then the table. `Readonly<Record<…>>` is compile-time only, and a
 * runtime write to a nested row silently changes token accounting: an under-counted input
 * estimate is what `maxInputTokens`/`maxCost` are checked against, and a replaced row makes the
 * estimate `NaN`, which compares false. Recalibration is a source change plus the live calibration
 * leg (`scripts/usage-calibration-live.test.mjs`), never a runtime override. */
export declare const MODEL_FAMILY_TOKENS: Readonly<Record<ModelFamily, ModelFamilyTokens>>;
/** Resolve a model id (e.g. `"claude-sonnet-4.5"`), provider id, or family name
 *  to a table key. Unmatched input is `"unknown"` — never a throw. */
export declare function resolveModelFamily(model?: string): ModelFamily;
/** Estimate tokens for one flattened text under a family's ratios. The message
 *  level (`estimateMessageTokens`) owns per-message overhead; this is text-only. */
export declare function estimateTextTokensForFamily(text: string, modelFamily?: string): number;
