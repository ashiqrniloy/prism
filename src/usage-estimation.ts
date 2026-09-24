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

/** CJK ideographs/kana/hangul tokenize near 1.5 chars/token in modern family tokenizers. */
const CJK_CHARS_PER_TOKEN = 1.5;
/** Fenced code tokenizes worse than prose: code ratio = prose ratio * this factor. */
const CODE_RATIO_FACTOR = 0.88;

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
export const MODEL_FAMILY_TOKENS: Readonly<Record<ModelFamily, ModelFamilyTokens>> = Object.freeze({
  anthropic: Object.freeze({ charsPerToken: 3.7, perMessageOverhead: 4, confidence: "medium" }),
  openai: Object.freeze({ charsPerToken: 5.0, perMessageOverhead: 3, confidence: "medium" }),
  google: Object.freeze({ charsPerToken: 3.9, perMessageOverhead: 4, confidence: "medium" }),
  deepseek: Object.freeze({ charsPerToken: 3.8, perMessageOverhead: 4, confidence: "medium" }),
  "openrouter-generic": Object.freeze({ charsPerToken: 4.4, perMessageOverhead: 4, confidence: "medium" }),
  mistral: Object.freeze({ charsPerToken: 3.9, perMessageOverhead: 3, confidence: "medium" }),
  unknown: Object.freeze({ charsPerToken: 3.5, perMessageOverhead: 6, confidence: "low" }),
});

/** Model-id patterns per family. Family names themselves also resolve (see `resolveModelFamily`). */
const FAMILY_PATTERNS: readonly (readonly [ModelFamily, RegExp])[] = [
  ["anthropic", /claude|anthropic/i],
  ["openai", /gpt-|openai|chatgpt|codex|^o[1-9]/i],
  ["google", /gemini|gemma|palm|google/i],
  ["deepseek", /deepseek/i],
  ["mistral", /mistral|mixtral|codestral|magistral|devstral|pixtral|ministral/i],
  ["openrouter-generic", /openrouter/i],
];

/** Resolve a model id (e.g. `"claude-sonnet-4.5"`), provider id, or family name
 *  to a table key. Unmatched input is `"unknown"` — never a throw. */
export function resolveModelFamily(model?: string): ModelFamily {
  if (typeof model !== "string") return "unknown";
  const id = model.trim();
  if (id in MODEL_FAMILY_TOKENS) return id as ModelFamily;
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(id)) return family;
  }
  return "unknown";
}

/** Estimate tokens for one flattened text under a family's ratios. The message
 *  level (`estimateMessageTokens`) owns per-message overhead; this is text-only. */
export function estimateTextTokensForFamily(text: string, modelFamily?: string): number {
  const { charsPerToken } = MODEL_FAMILY_TOKENS[resolveModelFamily(modelFamily)];
  let cjk = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index) ?? 0; // unreachable 0: index < length; avoids a non-null assertion
    if (isCjkCodePoint(codePoint)) cjk += 1;
    index += codePoint > 0xffff ? 2 : 1;
  }
  const code = fencedChars(text);
  const other = Math.max(0, text.length - cjk - code);
  return Math.ceil(cjk / CJK_CHARS_PER_TOKEN + code / (charsPerToken * CODE_RATIO_FACTOR) + other / charsPerToken);
}

/** Length of the characters enclosed by ``` fence pairs (unclosed fence runs to the end). */
function fencedChars(text: string): number {
  let total = 0;
  let index = text.indexOf("```");
  while (index !== -1) {
    const end = text.indexOf("```", index + 3);
    if (end === -1) {
      total += text.length - index;
      break;
    }
    total += end + 3 - index;
    index = text.indexOf("```", end + 3);
  }
  return total;
}

/** Han, kana, hangul, CJK punctuation/fullwidth, and ext-B+ ideograph ranges. */
function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  );
}
