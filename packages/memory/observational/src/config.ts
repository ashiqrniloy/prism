import {
  assertCompactionTrigger,
  type CompactionTrigger,
  type JsonSchema,
  type ModelConfig,
  type ModelRef,
  resolveInputCap,
} from "@arnilo/prism";

import {
  DEFAULT_MAX_TASK_STATE_BYTES,
  DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
  DEFAULT_MAX_WORKER_ERROR_BYTES,
  DEFAULT_MAX_WORKER_MESSAGE_BYTES,
  DEFAULT_MAX_WORKER_RESULT_BYTES,
  DEFAULT_MAX_WORKER_TOOL_CALLS,
  DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_WORKER_TURNS,
  HARD_MAX_TASK_STATE_BYTES,
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
export const DEFAULT_COMPACT_AT_RATIO = 0.6;

/** Internal render bounds: the pool the folded payload keeps, and the recall page size. */
export const OBSERVATIONS_POOL_MAX_TOKENS = 20_000;
export const OBSERVATIONS_POOL_TARGET_TOKENS = 10_000;

export type MemoryObservationalDropperPolicy = "model" | "lowest-relevance";

/** Relative compaction gate: `ratio` of the model's input cap, capped by `maxTokens` when set. */
export interface MemoryObservationalCompactAt {
  /** Share of the model's input cap. Default `0.6`. */
  readonly ratio?: number;
  /** Absolute cap on the resolved threshold. Required when the model declares no window. */
  readonly maxTokens?: number;
}

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
    /**
     * Request compaction at this share of the model's input cap, capped by `maxTokens`. Default
     * `{ ratio: 0.6 }`. A model that declares no window uses `maxTokens` and fails without it.
     */
    readonly compactAt?: MemoryObservationalCompactAt;
    /**
     * Replaces the ratio gate with a `CompactionTrigger` (the JSON-safe kinds: `custom` is a function
     * and not a config value). Omitted, the gate stays `compactAt`.
     */
    readonly trigger?: CompactionTrigger;
  };
  /** Worker loop ceilings. Defaults and hard caps are the package's own (`limits.ts`). */
  readonly worker?: MemoryWorkerLimitOptions;
  /** Expose the `recall` tool while the session's toggle is on. Default `true`. */
  readonly recall?: boolean;
}

const observationalConfigSchema: JsonSchema = {
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
        compactAt: {
          type: "object",
          additionalProperties: false,
          description: "Request compaction at ratio of the model's input cap, capped by maxTokens.",
          properties: {
            ratio: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: DEFAULT_COMPACT_AT_RATIO,
              description: "Share of the model's input cap. Default 0.6.",
            },
            maxTokens: {
              type: "integer",
              minimum: 1,
              description: "Absolute cap on the threshold. Required when the model declares no window.",
            },
          },
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

/**
 * Config fields whose value is a tuning default: a budget, cap, threshold or ratio. Their value may
 * change in a minor version. Every other field is `contract` (README `## Compatibility`).
 */
const TUNING_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  "observer.messageTokens",
  "reflector.observationTokens",
  "dropper.targetTokens",
  "context.recentMessages",
  "context.compactAt.ratio",
  "context.compactAt.maxTokens",
  "context.trigger.entries",
  "context.trigger.tokens",
  "context.trigger.ratio",
  "worker.maxTaskStateBytes",
  "worker.maxTurns",
  "worker.maxToolCallsPerTurn",
  "worker.maxToolCalls",
  "worker.maxArgumentBytes",
  "worker.maxResultBytes",
  "worker.maxMessageBytes",
  "worker.maxErrorBytes",
]);

/** Tag every field with its stability tier; `validateJsonSchema` ignores the extension keyword. */
function withStability(schema: JsonSchema, tuning: ReadonlySet<string>, path = ""): JsonSchema {
  const properties = schema.properties;
  const tagged: JsonSchema = properties
    ? {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(properties).map(([key, child]) => {
            const childPath = path ? `${path}.${key}` : key;
            return [
              key,
              { ...withStability(child, tuning, childPath), "x-prism-stability": tuning.has(childPath) ? "tuning" : "contract" },
            ];
          }),
        ),
      }
    : schema;
  if (schema.anyOf) return { ...tagged, anyOf: schema.anyOf.map((branch) => withStability(branch, tuning, path)) };
  if (schema.oneOf) return { ...tagged, oneOf: schema.oneOf.map((branch) => withStability(branch, tuning, path)) };
  return tagged;
}

export const memoryObservationalConfigSchema: JsonSchema = withStability(observationalConfigSchema, TUNING_CONFIG_FIELDS);

/** {@link MemoryObservationalConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedMemoryObservationalConfig {
  readonly enabled: boolean;
  readonly recall: boolean;
  readonly observer: { readonly model?: ModelRef; readonly messageTokens: number };
  readonly reflector: { readonly model?: ModelRef; readonly observationTokens: number };
  readonly dropper: { readonly model?: ModelRef; readonly targetTokens: number; readonly policy: MemoryObservationalDropperPolicy };
  readonly context: { readonly recentMessages: number; readonly compactAt: ResolvedCompactAt; readonly trigger?: CompactionTrigger };
  readonly worker: MemoryWorkerLimitOptions;
}

export interface ResolvedCompactAt {
  readonly ratio: number;
  readonly maxTokens?: number;
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
      compactAt: resolveCompactAt(config.context?.compactAt),
      // Validated at config time: an unknown kind or a bad threshold fails the load, not the run.
      ...(config.context?.trigger === undefined ? {} : { trigger: assertCompactionTrigger(config.context.trigger) }),
    },
    worker: { ...config.worker },
  };
}

function resolveCompactAt(value: MemoryObservationalCompactAt | undefined): ResolvedCompactAt {
  const ratio = value?.ratio ?? DEFAULT_COMPACT_AT_RATIO;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new TypeError("context.compactAt.ratio must be a number in (0, 1]");
  }
  if (value?.maxTokens !== undefined && (!Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1)) {
    throw new TypeError("context.compactAt.maxTokens must be a positive safe integer");
  }
  return { ratio, ...(value?.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }) };
}

/**
 * The token threshold the gate compares against. A model with a window uses
 * `min(ratio × input cap, maxTokens)`; without one it uses `maxTokens` or fails at load.
 */
export function resolveCompactAtThreshold(compactAt: ResolvedCompactAt, model?: Pick<ModelConfig, "limits">): number {
  let cap: number | undefined;
  try {
    cap = resolveInputCap(undefined, model);
  } catch {
    cap = undefined;
  }
  if (cap === undefined) {
    if (compactAt.maxTokens === undefined) {
      throw new TypeError("context.compactAt.maxTokens is required when the model declares no context window");
    }
    return compactAt.maxTokens;
  }
  const ratioThreshold = cap * compactAt.ratio;
  return compactAt.maxTokens === undefined ? ratioThreshold : Math.min(ratioThreshold, compactAt.maxTokens);
}
