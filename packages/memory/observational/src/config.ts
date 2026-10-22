import { assertCompactionTrigger, type CompactionTrigger, type JsonSchema, type ModelRef } from "@arnilo/prism";

import {
  DEFAULT_MAX_TASK_STATE_BYTES,
  HARD_MAX_TASK_STATE_BYTES,
  DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
  DEFAULT_MAX_WORKER_ERROR_BYTES,
  DEFAULT_MAX_WORKER_MESSAGE_BYTES,
  DEFAULT_MAX_WORKER_RESULT_BYTES,
  DEFAULT_MAX_WORKER_TOOL_CALLS,
  DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_WORKER_TURNS,
  HARD_MAX_WORKER_ARGUMENT_BYTES,
  HARD_MAX_WORKER_ERROR_BYTES,
  HARD_MAX_WORKER_MESSAGE_BYTES,
  HARD_MAX_WORKER_RESULT_BYTES,
  HARD_MAX_WORKER_TOOL_CALLS,
  HARD_MAX_WORKER_TOOL_CALLS_PER_TURN,
  HARD_MAX_WORKER_TURNS,
  type MemoryWorkerLimitOptions,
} from "./limits.js";

export const DEFAULT_OBSERVER_MESSAGE_TOKENS = 10_000;
export const DEFAULT_REFLECTOR_OBSERVATION_TOKENS = 20_000;
export const DEFAULT_DROPPER_TARGET_TOKENS = 20_000;
export const DEFAULT_CONTEXT_RECENT_MESSAGES = 8;
export const DEFAULT_COMPACT_AFTER_TOKENS = 81_000;

/** Internal render bounds: the pool the folded payload keeps, and the recall page size. */
export const OBSERVATIONS_POOL_MAX_TOKENS = 20_000;
export const OBSERVATIONS_POOL_TARGET_TOKENS = 10_000;

export type MemoryObservationalDropperPolicy = "model" | "lowest-relevance";

export interface MemoryObservationalWorkerConfig {
  /**
   * Worker model: `"provider/model"` or a model object. Default: the session's model, so the observer
   * rides the model the run already uses. The provider's key comes from the credentials slot like any run.
   */
  readonly model?: ModelRef;
}

/**
 * Validated `packageConfig` for `@arnilo/prism-memory-observational`. Every key is optional: with no
 * config the package registers everything, stays off until `om` turns it on, and observes with the
 * session's own model.
 */
export interface MemoryObservationalConfig {
  /** Starting value of the per-session toggle. Default `false`; the `om` command flips it per session. */
  readonly enabled?: boolean;
  readonly observer?: MemoryObservationalWorkerConfig & {
    /** Unscanned eligible tokens that trigger an observation pass. Default 10_000. */
    readonly messageTokens?: number;
  };
  readonly reflector?: MemoryObservationalWorkerConfig & {
    /** Unreflected observation tokens that trigger a reflection pass. Default 20_000. */
    readonly observationTokens?: number;
  };
  readonly dropper?: MemoryObservationalWorkerConfig & {
    /** Active-observation token budget the dropper approaches. Default 20_000. */
    readonly targetTokens?: number;
    /** `"model"` asks the dropper model; `"lowest-relevance"` drops deterministically. Default `"model"`. */
    readonly policy?: MemoryObservationalDropperPolicy;
  };
  readonly context?: {
    /** Recent messages the compaction cut keeps verbatim. Default 8. */
    readonly recentMessages?: number;
    /** Estimated input tokens that request compaction. Default 81_000. Ignored when `trigger` is set. */
    readonly compactAfterTokens?: number;
    /**
     * Replaces the token gate with a `CompactionTrigger` (the JSON-safe kinds: `custom` is a function
     * and not a config value). Omitted, the gate stays `compactAfterTokens`.
     */
    readonly trigger?: CompactionTrigger;
  };
  /** Worker loop ceilings. Defaults and hard caps are the package's own (`limits.ts`). */
  readonly worker?: MemoryWorkerLimitOptions;
  /** Expose the `recall` tool while the session's toggle is on. Default `true`. */
  readonly recall?: boolean;
}

export const memoryObservationalConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: {
      type: "boolean",
      default: false,
      description: "Starting value of the per-session toggle. The om command flips it per session.",
    },
    observer: {
      type: "object",
      additionalProperties: false,
      description: "Observation pass: what triggers it and which model runs it.",
      properties: {
        model: {
          description: 'Observer model: "provider/model" or a model object. Defaults to the session model.',
          // The shape is the `anyOf` below: the branch validates the keys, so the outer node stays open.
          additionalProperties: true,
          anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
        },
        messageTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_OBSERVER_MESSAGE_TOKENS,
          description: "Unscanned eligible tokens that trigger an observation pass.",
        },
      },
    },
    reflector: {
      type: "object",
      additionalProperties: false,
      description: "Reflection pass: what triggers it and which model runs it.",
      properties: {
        model: {
          description: 'Reflector model: "provider/model" or a model object. Defaults to the session model.',
          // The shape is the `anyOf` below: the branch validates the keys, so the outer node stays open.
          additionalProperties: true,
          anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
        },
        observationTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_REFLECTOR_OBSERVATION_TOKENS,
          description: "Unreflected observation tokens that trigger a reflection pass.",
        },
      },
    },
    dropper: {
      type: "object",
      additionalProperties: false,
      description: "Drop pass: the active-observation budget and which model trims it.",
      properties: {
        model: {
          description: 'Dropper model: "provider/model" or a model object. Defaults to the session model.',
          // The shape is the `anyOf` below: the branch validates the keys, so the outer node stays open.
          additionalProperties: true,
          anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
        },
        targetTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_DROPPER_TARGET_TOKENS,
          description: "Active-observation token budget the dropper approaches.",
        },
        policy: {
          type: "string",
          enum: ["model", "lowest-relevance"],
          default: "model",
          description: '"model" asks the dropper model; "lowest-relevance" drops deterministically.',
        },
      },
    },
    context: {
      type: "object",
      additionalProperties: false,
      description: "Compaction sizing: what the cut keeps and when it is requested.",
      properties: {
        recentMessages: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_CONTEXT_RECENT_MESSAGES,
          description: "Recent messages the compaction cut keeps verbatim.",
        },
        compactAfterTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_COMPACT_AFTER_TOKENS,
          description: "Estimated input tokens that request compaction. Ignored when trigger is set.",
        },
        trigger: {
          description: 'Replaces the token gate, e.g. { "type": "threshold_entries", "entries": 50 }.',
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
    },
    worker: {
      type: "object",
      additionalProperties: false,
      description: "Worker loop ceilings.",
      properties: {
        maxTaskStateBytes: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_TASK_STATE_BYTES,
          default: DEFAULT_MAX_TASK_STATE_BYTES,
          description: "Text bytes in the current task state.",
        },
        maxTurns: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_TURNS,
          default: DEFAULT_MAX_WORKER_TURNS,
          description: "Provider turns one worker pass may take.",
        },
        maxToolCallsPerTurn: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_TOOL_CALLS_PER_TURN,
          default: DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
          description: "Tool calls one worker turn may make.",
        },
        maxToolCalls: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_TOOL_CALLS,
          default: DEFAULT_MAX_WORKER_TOOL_CALLS,
          description: "Tool calls one worker pass may make.",
        },
        maxArgumentBytes: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_ARGUMENT_BYTES,
          default: DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
          description: "Bytes one worker tool call may carry.",
        },
        maxResultBytes: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_RESULT_BYTES,
          default: DEFAULT_MAX_WORKER_RESULT_BYTES,
          description: "Bytes one worker tool result may carry.",
        },
        maxMessageBytes: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_MESSAGE_BYTES,
          default: DEFAULT_MAX_WORKER_MESSAGE_BYTES,
          description: "Bytes one worker message may carry.",
        },
        maxErrorBytes: {
          type: "integer",
          minimum: 1,
          maximum: HARD_MAX_WORKER_ERROR_BYTES,
          default: DEFAULT_MAX_WORKER_ERROR_BYTES,
          description: "Bytes of a worker error kept for reporting.",
        },
      },
    },
    recall: {
      type: "boolean",
      default: true,
      description: "Expose the recall tool while the session's toggle is on.",
    },
  },
};

/** {@link MemoryObservationalConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedMemoryObservationalConfig {
  readonly enabled: boolean;
  readonly recall: boolean;
  readonly observer: { readonly model?: ModelRef; readonly messageTokens: number };
  readonly reflector: { readonly model?: ModelRef; readonly observationTokens: number };
  readonly dropper: { readonly model?: ModelRef; readonly targetTokens: number; readonly policy: MemoryObservationalDropperPolicy };
  readonly context: { readonly recentMessages: number; readonly compactAfterTokens: number; readonly trigger?: CompactionTrigger };
  readonly worker: MemoryWorkerLimitOptions;
}

export function resolveMemoryObservationalConfig(config: MemoryObservationalConfig = {}): ResolvedMemoryObservationalConfig {
  if (
    (config.dropper?.targetTokens ?? DEFAULT_DROPPER_TARGET_TOKENS) <
    (config.reflector?.observationTokens ?? DEFAULT_REFLECTOR_OBSERVATION_TOKENS)
  ) {
    throw new Error("dropper.targetTokens must be >= reflector.observationTokens");
  }
  return {
    enabled: config.enabled === true,
    recall: config.recall !== false,
    observer: {
      ...(config.observer?.model === undefined ? {} : { model: config.observer.model }),
      messageTokens: config.observer?.messageTokens ?? DEFAULT_OBSERVER_MESSAGE_TOKENS,
    },
    reflector: {
      ...(config.reflector?.model === undefined ? {} : { model: config.reflector.model }),
      observationTokens: config.reflector?.observationTokens ?? DEFAULT_REFLECTOR_OBSERVATION_TOKENS,
    },
    dropper: {
      ...(config.dropper?.model === undefined ? {} : { model: config.dropper.model }),
      targetTokens: config.dropper?.targetTokens ?? DEFAULT_DROPPER_TARGET_TOKENS,
      policy: config.dropper?.policy === "lowest-relevance" ? "lowest-relevance" : "model",
    },
    context: {
      recentMessages: config.context?.recentMessages ?? DEFAULT_CONTEXT_RECENT_MESSAGES,
      compactAfterTokens: config.context?.compactAfterTokens ?? DEFAULT_COMPACT_AFTER_TOKENS,
      // Validated at config time: an unknown kind or a bad threshold fails the load, not the run.
      ...(config.context?.trigger === undefined ? {} : { trigger: assertCompactionTrigger(config.context.trigger) }),
    },
    worker: { ...config.worker },
  };
}
