/**
 * Validated `packageConfig` for `@arnilo/prism-context-engineering` (plan 158 Task 7).
 *
 * Every stage is off unless configured, and one handler composes the configured stages in a fixed
 * order (fold → tool search → attention or budget). `budget` and `attention` are mutually exclusive:
 * both evict from the same request for the same reason, and configuring both would leave the order
 * of two competing evictions to chance.
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

/** Old-tool-result folding. `summarize` defaults to `"truncate"` (deterministic, no model call). */
export interface ContextEngineeringFoldConfig {
  readonly minAgeTurns?: number;
  readonly minBytes?: number;
  readonly maxSummaryBytes?: number;
  readonly summarize?: "truncate" | { readonly model?: ModelRef };
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

export interface ContextEngineeringConfig {
  readonly budget?: ContextEngineeringBudgetConfig;
  readonly fold?: ContextEngineeringFoldConfig;
  readonly toolSearch?: ContextEngineeringToolSearchConfig;
  readonly attention?: ContextEngineeringAttentionConfig;
}

/** {@link ContextEngineeringConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedContextEngineeringConfig {
  readonly budget?: ContextBudget;
  readonly fold?: {
    readonly minAgeTurns: number;
    readonly minBytes: number;
    readonly maxSummaryBytes: number;
    readonly summarize: "truncate" | { readonly model?: ModelRef };
  };
  readonly toolSearch?: { readonly disclosure: "all" | "search"; readonly topK: number };
  readonly attention?: ContextEngineeringAttentionConfig;
}

export const DEFAULT_FOLD_MIN_AGE_TURNS = 2;
export const DEFAULT_FOLD_MIN_BYTES = 4_096;
export const DEFAULT_FOLD_MAX_SUMMARY_BYTES = 512;
export const DEFAULT_TOOL_SEARCH_TOP_K = 16;

export const contextEngineeringConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
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
  assertRatio(config.attention?.triggerRatio, "triggerRatio");
  assertRatio(config.attention?.compactRatio, "compactRatio");
  const fold = config.fold
    ? {
        minAgeTurns: config.fold.minAgeTurns ?? DEFAULT_FOLD_MIN_AGE_TURNS,
        minBytes: config.fold.minBytes ?? DEFAULT_FOLD_MIN_BYTES,
        maxSummaryBytes: config.fold.maxSummaryBytes ?? DEFAULT_FOLD_MAX_SUMMARY_BYTES,
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
    ...(config.budget ? { budget: config.budget } : {}),
    ...(fold ? { fold } : {}),
    ...(toolSearch ? { toolSearch } : {}),
    ...(config.attention ? { attention: config.attention } : {}),
  };
}

/** `true` when nothing is configured, so `setup` registers no handler at all. */
export function isEmptyContextEngineeringConfig(config: ResolvedContextEngineeringConfig): boolean {
  return config.budget === undefined && config.fold === undefined && config.toolSearch === undefined && config.attention === undefined;
}
