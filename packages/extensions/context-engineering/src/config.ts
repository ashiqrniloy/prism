/**
 * Validated `packageConfig` for `@arnilo/prism-extensions/context-engineering` (plan 158 Task 7).
 *
 * Every stage is off unless configured, and one handler composes the configured stages in a fixed
 * order (fold → tool search → attention or budget). `budget` and `attention` are mutually exclusive:
 * both evict from the same request for the same reason, and configuring both would leave the order
 * of two competing evictions to chance. `blocks` caps the injected context-block share in a
 * `model.request` pass, so it is mutually exclusive with `budget` too; `accounting` emits the
 * measurement event and any configured stage emits it as well.
 *
 * The JSON schema carries no function: `fold.summarize` is `"truncate"` or `{ model }`, and an
 * attention axis is one of the three object kinds. A host that needs a custom summarizer or a
 * predicate axis uses the package's library exports, or registers its own `context.build` handler.
 */
import type { JsonSchema, ModelRef } from "@arnilo/prism";
import type { ContextBudget } from "./budget.js";
import type { AttentionTrigger } from "./attention-types.js";

/** Input budget for the whole draft. At least one cap is required when the block is present. */
export interface ContextEngineeringBudgetConfig {
  readonly maxInputTokens?: number;
  readonly maxInputBytes?: number;
  /** Emit the `context.omissions` package event for every dropped row. Default `false`. */
  readonly reportOmissions?: boolean;
}

/** Old-tool-result folding. `summarize` defaults to `"truncate"` (deterministic, no model call).
 *  `keepLast` and `clearAtLeastTokens` apply only when batching (`clearAtLeastTokens > 0`). */
export interface ContextEngineeringFoldConfig {
  readonly minAgeTurns?: number;
  readonly minBytes?: number;
  readonly maxSummaryBytes?: number;
  readonly summarize?: "truncate" | { readonly model?: ModelRef };
  /** Newest tool results that batch mode never folds. Default `3`. */
  readonly keepLast?: number;
  /** Tool names that are never folded (batch and per-turn mode). Default `[]`. */
  readonly excludeTools?: readonly string[];
  /** Clear in batches of at least this many tokens. `0` (default) folds every eligible result per turn. */
  readonly clearAtLeastTokens?: number;
}

/** Progressive tool disclosure. `disclosure: "search"` narrows the draft and registers `search_tools`. */
export interface ContextEngineeringToolSearchConfig {
  readonly disclosure?: "all" | "search";
  readonly topK?: number;
}

/** Attention compiler settings, in the JSON-safe subset of the library's options. */
export interface ContextEngineeringAttentionConfig {
  readonly maxInputTokens?: number;
  readonly reserveTokens?: number;
  readonly triggerRatio?: number;
  readonly compactRatio?: number;
  readonly thinkingKeepTurns?: number;
  readonly keepLast?: number;
  readonly excludeTools?: readonly string[];
  /** Fold axes. Omitted keeps the `triggerRatio` axis. A predicate axis is not expressible in JSON. */
  readonly trigger?: readonly AttentionTrigger[] | AttentionTrigger;
}

/** Injected-block share cap: whole blocks over `maxShare × inputCap` are dropped. */
export interface ContextEngineeringBlocksConfig {
  /** Fraction of the input cap injected context blocks may occupy (0 < maxShare ≤ 1). */
  readonly maxShare: number;
}

export interface ContextEngineeringConfig {
  /** Emit `context.accounted` once per request even with no stage configured. Default `false`. */
  readonly accounting?: boolean;
  /** Cap the share of the input taken by injected context blocks (mutually exclusive with budget). */
  readonly blocks?: ContextEngineeringBlocksConfig;
  readonly budget?: ContextEngineeringBudgetConfig;
  readonly fold?: ContextEngineeringFoldConfig;
  readonly toolSearch?: ContextEngineeringToolSearchConfig;
  readonly attention?: ContextEngineeringAttentionConfig;
}

/** {@link ContextEngineeringConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedContextEngineeringConfig {
  readonly accounting: boolean;
  readonly blocks?: ContextEngineeringBlocksConfig;
  readonly budget?: ContextBudget;
  readonly fold?: {
    readonly minAgeTurns: number;
    readonly minBytes: number;
    readonly maxSummaryBytes: number;
    readonly summarize: "truncate" | { readonly model?: ModelRef };
    readonly keepLast: number;
    readonly excludeTools: readonly string[];
    readonly clearAtLeastTokens: number;
  };
  readonly toolSearch?: { readonly disclosure: "all" | "search"; readonly topK: number };
  readonly attention?: ContextEngineeringAttentionConfig;
}

export const DEFAULT_FOLD_MIN_AGE_TURNS = 2;
export const DEFAULT_FOLD_MIN_BYTES = 4_096;
export const DEFAULT_FOLD_MAX_SUMMARY_BYTES = 512;
export const DEFAULT_FOLD_KEEP_LAST = 3;
export const DEFAULT_FOLD_CLEAR_AT_LEAST_TOKENS = 0;
export const DEFAULT_TOOL_SEARCH_TOP_K = 16;

export const contextEngineeringConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    accounting: {
      type: "boolean",
      description: "Emit a context.accounted package event once per request (default false).",
    },
    blocks: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxShare: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Maximum share of the input cap for injected blocks; must be greater than 0.",
        },
      },
      required: ["maxShare"],
      description: "Cap injected context blocks at maxShare × inputCap (mutually exclusive with budget).",
    },
    budget: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxInputTokens: { type: "integer", minimum: 1, maximum: 2_000_000, description: "Token cap for the whole draft." },
        maxInputBytes: { type: "integer", minimum: 1, maximum: 33_554_432, description: "Byte cap for the whole draft." },
        reportOmissions: { type: "boolean", description: "Emit context.omissions for every dropped row." },
      },
      description: "Input budget for the whole draft (mutually exclusive with attention).",
    },
    fold: {
      type: "object",
      additionalProperties: false,
      properties: {
        minAgeTurns: { type: "integer", minimum: 1, maximum: 1_024 },
        minBytes: { type: "integer", minimum: 1, maximum: 33_554_432 },
        maxSummaryBytes: { type: "integer", minimum: 1, maximum: 4_096 },
        keepLast: { type: "integer", minimum: 0, maximum: 1_024, description: "Newest tool results batch mode never folds." },
        excludeTools: { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, maxItems: 1_024 },
        clearAtLeastTokens: {
          type: "integer",
          minimum: 0,
          maximum: 2_000_000,
          description: "Clear in batches of at least this many tokens; 0 folds every eligible result per turn.",
        },
        summarize: {
          additionalProperties: true,
          oneOf: [
            { const: "truncate" },
            {
              type: "object",
              additionalProperties: false,
              properties: { model: { additionalProperties: true, anyOf: [{ type: "string", minLength: 1 }, { type: "object" }] } },
            },
          ],
          description: 'How old tool results are folded: "truncate" (default, no model call) or { model } (one call per result).',
        },
      },
      description: "Rewrite old tool-result messages in the provider view only.",
    },
    toolSearch: {
      type: "object",
      additionalProperties: false,
      properties: {
        disclosure: { type: "string", enum: ["all", "search"] },
        topK: { type: "integer", minimum: 1, maximum: 64 },
      },
      description: 'Narrow the draft to the selected tools and register search_tools ("search").',
    },
    attention: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxInputTokens: { type: "integer", minimum: 1, description: "Host input cap; wins over the model window." },
        reserveTokens: { type: "integer", minimum: 0, maximum: 1_000_000 },
        triggerRatio: { type: "number", minimum: 0, maximum: 1.75 },
        compactRatio: { type: "number", minimum: 0, maximum: 1.9 },
        thinkingKeepTurns: { type: "integer", minimum: 0, maximum: 1_024 },
        keepLast: { type: "integer", minimum: 0, maximum: 1_024 },
        excludeTools: { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, maxItems: 1_024 },
        trigger: {
          anyOf: [
            { type: "object", additionalProperties: true },
            { type: "array", items: { type: "object", additionalProperties: true }, maxItems: 16 },
          ],
          description: "Fold axes: input_ratio, run_input_ratio, or token_floor.",
        },
      },
      description: "Sticky thinking/tool-result folding with a compaction trigger (mutually exclusive with budget).",
    },
  },
};

export class ContextEngineeringConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextEngineeringConfigError";
  }
}

/** A ratio outside `(0, 1)` would make the gate unsound, so it fails at setup, not on turn one. */
function assertRatio(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new ContextEngineeringConfigError(`attention.${name} must be a number in (0, 1)`);
  }
}

/** Apply the defaults and reject the one combination the package will not run. */
export function resolveContextEngineeringConfig(config: ContextEngineeringConfig = {}): ResolvedContextEngineeringConfig {
  if (config.budget && config.attention) {
    throw new ContextEngineeringConfigError(
      "budget and attention are mutually exclusive: both evict from the same request, so configure one",
    );
  }
  if (config.budget && config.blocks) {
    throw new ContextEngineeringConfigError(
      "budget and blocks are mutually exclusive: both evict context blocks from the same request, so configure one",
    );
  }
  if (
    config.blocks !== undefined &&
    (!Number.isFinite(config.blocks.maxShare) || config.blocks.maxShare <= 0 || config.blocks.maxShare > 1)
  ) {
    throw new ContextEngineeringConfigError("blocks.maxShare must be a number in (0, 1]");
  }
  assertRatio(config.attention?.triggerRatio, "triggerRatio");
  assertRatio(config.attention?.compactRatio, "compactRatio");
  const fold = config.fold
    ? {
        minAgeTurns: config.fold.minAgeTurns ?? DEFAULT_FOLD_MIN_AGE_TURNS,
        minBytes: config.fold.minBytes ?? DEFAULT_FOLD_MIN_BYTES,
        maxSummaryBytes: config.fold.maxSummaryBytes ?? DEFAULT_FOLD_MAX_SUMMARY_BYTES,
        keepLast: config.fold.keepLast ?? DEFAULT_FOLD_KEEP_LAST,
        excludeTools: [...(config.fold.excludeTools ?? [])],
        clearAtLeastTokens: config.fold.clearAtLeastTokens ?? DEFAULT_FOLD_CLEAR_AT_LEAST_TOKENS,
        summarize: config.fold.summarize ?? ("truncate" as const),
      }
    : undefined;
  const toolSearch = config.toolSearch
    ? {
        disclosure: config.toolSearch.disclosure ?? ("all" as const),
        topK: config.toolSearch.topK ?? DEFAULT_TOOL_SEARCH_TOP_K,
      }
    : undefined;
  return {
    accounting: config.accounting === true,
    ...(config.blocks ? { blocks: config.blocks } : {}),
    ...(config.budget ? { budget: config.budget } : {}),
    ...(fold ? { fold } : {}),
    ...(toolSearch ? { toolSearch } : {}),
    ...(config.attention ? { attention: config.attention } : {}),
  };
}

/** `true` when nothing is configured, so `setup` registers no handler at all. */
export function isEmptyContextEngineeringConfig(config: ResolvedContextEngineeringConfig): boolean {
  return (
    !config.accounting &&
    config.blocks === undefined &&
    config.budget === undefined &&
    config.fold === undefined &&
    config.toolSearch === undefined &&
    config.attention === undefined
  );
}
