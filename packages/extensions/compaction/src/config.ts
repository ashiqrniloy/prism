import { assertCompactionTrigger, type CompactionTrigger, type JsonSchema, type ModelRef } from "@arnilo/prism";

import { DEFAULT_MAX_SUMMARY_TOKENS, HARD_MAX_SUMMARY_TOKENS, HARD_RESERVE_TOKENS } from "./limits.js";
import { DEFAULT_KEEP_RECENT_TOKENS } from "./prepare.js";

/** `"coding"` tracks and reports read/modified files and focuses the summary on coding handoff. */
export type MemoryCompactionProfile = "default" | "coding";

/**
 * Validated `packageConfig` for `@arnilo/prism-extensions/compaction`. Every key is optional: with no
 * config the compactor summarizes with the session's own model and the 0.12 limits, and installing
 * the package is the opt-in.
 */
export interface MemoryCompactionConfig {
  /**
   * Summary model: `"provider/model"` or a model object. Defaults to the session's model, so the summary
   * rides the model the run already uses. A model object is a `ModelRef`, not a credential: the
   * provider's key comes from the credentials slot like any run.
   */
  readonly model?: ModelRef;
  /** Summary focus. Default `"default"`. */
  readonly profile?: MemoryCompactionProfile;
  /** Tokens of recent history the cut keeps verbatim. Default {@link DEFAULT_KEEP_RECENT_TOKENS}. */
  readonly keepRecentTokens?: number;
  /** Summary cap in tokens, and the per-call provider output budget. Default {@link DEFAULT_MAX_SUMMARY_TOKENS}. */
  readonly maxSummaryTokens?: number;
  /** Replaces the summarization system prompt. The turn-prefix prompt stays the package's own. */
  readonly summaryPrompt?: string;
  /**
   * Auto-compaction gate, the JSON-safe kinds of `CompactionTrigger` (`custom` is a function, so it
   * is not a config value: a host that needs one registers its own handler). Omitted: no handler is
   * registered and the kernel's `compaction.thresholdEntries` fallback owns the decision.
   *
   * When set, the package registers it as the session's `compaction.when` vote: the package asks for
   * compaction past the gate and declines (`{ compact: false }`) below it, so the kernel fallback
   * cannot override it. An `input_ratio` gate needs the model's input cap: a model that declares
   * none fails loudly, so a host running such a model sets `threshold_tokens` instead.
   */
  readonly trigger?: CompactionTrigger;
}

export const memoryCompactionConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    model: {
      description: 'Summary model: "provider/model" or a model object. Defaults to the session model.',
      // The shape is the `anyOf` below: the branch validates the keys, so the outer node stays open.
      additionalProperties: true,
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    profile: {
      type: "string",
      enum: ["default", "coding"],
      default: "default",
      description: 'Summary focus. "coding" adds read/modified file reporting.',
    },
    keepRecentTokens: {
      type: "integer",
      minimum: 0,
      maximum: HARD_RESERVE_TOKENS,
      default: DEFAULT_KEEP_RECENT_TOKENS,
      description: "Tokens of recent history the compaction cut keeps verbatim.",
    },
    maxSummaryTokens: {
      type: "integer",
      minimum: 1,
      maximum: HARD_MAX_SUMMARY_TOKENS,
      default: DEFAULT_MAX_SUMMARY_TOKENS,
      description: "Summary cap in tokens, and the per-call provider output budget.",
    },
    summaryPrompt: {
      type: "string",
      minLength: 1,
      description: "Replaces the summarization system prompt.",
    },
    trigger: {
      description: 'Auto-compaction gate, e.g. { "type": "input_ratio", "ratio": 0.8 }. Omitted: the kernel threshold applies.',
      // The shape is the `oneOf` below: keys are validated per branch, so the outer node stays open.
      additionalProperties: true,
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "entries"],
          properties: { type: { const: "threshold_entries" }, entries: { type: "integer", minimum: 1 } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "tokens"],
          properties: { type: { const: "threshold_tokens" }, tokens: { type: "integer", minimum: 1 } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "ratio"],
          properties: { type: { const: "input_ratio" }, ratio: { type: "number", minimum: 0, maximum: 1 } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: { type: { const: "each_turn" } },
        },
      ],
    },
  },
};

/** {@link MemoryCompactionConfig} with every default applied, so `setup` and the factory read one shape. */
export interface ResolvedMemoryCompactionConfig {
  readonly model?: ModelRef;
  readonly profile: MemoryCompactionProfile;
  readonly keepRecentTokens: number;
  readonly maxSummaryTokens: number;
  readonly summaryPrompt?: string;
  readonly trigger?: CompactionTrigger;
}

export function resolveMemoryCompactionConfig(config: MemoryCompactionConfig = {}): ResolvedMemoryCompactionConfig {
  return {
    ...(config.model === undefined ? {} : { model: config.model }),
    profile: config.profile ?? "default",
    keepRecentTokens: config.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS,
    maxSummaryTokens: config.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
    ...(config.summaryPrompt === undefined ? {} : { summaryPrompt: config.summaryPrompt }),
    // Validated at config time: an unknown kind or a bad threshold fails the load, not the run.
    ...(config.trigger === undefined ? {} : { trigger: assertCompactionTrigger(config.trigger) }),
  };
}
