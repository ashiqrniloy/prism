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
} from "@arnilo/prism-memory-system/core";
import {
  type ChunkStoreLocation,
  DEFAULT_MAX_CHUNK_BYTES,
  DEFAULT_MAX_CHUNKS_PER_EVENT,
  HARD_MAX_CHUNK_BYTES,
  HARD_MAX_CHUNKS_PER_EVENT,
} from "../chunks.js";

export const DEFAULT_STM_TRIGGER_TOKENS = 10_000;
/** Token budget of the recent-record index an STM request carries (plan 217 Task 1). */
export const DEFAULT_STM_CONTEXT_TOKENS = 4_000;
/** Active STM records habituation compares a new event against (plan 217 Task 3). */
export const DEFAULT_STM_HABITUATION_WINDOW = 50;
export const HARD_MAX_STM_HABITUATION_WINDOW = 1_000;
/** Minutes of silence before a user turn that make it an event boundary (plan 217 Task 3). */
export const DEFAULT_STM_BOUNDARY_GAP_MINUTES = 10;
export const DEFAULT_WM_OBSERVATION_TOKENS = 20_000;
export const DEFAULT_REHEARSAL_TARGET_TOKENS = 20_000;
export const DEFAULT_CONTEXT_RECENT_MESSAGES = 8;
export const DEFAULT_COMPACT_AT_RATIO = 0.6;

/** Internal render bounds: the pool the folded payload keeps, and the recall page size. */
export const OBSERVATIONS_POOL_MAX_TOKENS = 20_000;
export const OBSERVATIONS_POOL_TARGET_TOKENS = 10_000;

export type MemorySystemRehearsalPolicy = "model" | "lowest-relevance";

/** Relative compaction gate: `ratio` of the model's input cap, capped by `maxTokens` when set. */
export interface MemorySystemCompactAt {
  /** Share of the model's input cap. Default `0.6`. */
  readonly ratio?: number;
  /** Absolute cap on the resolved threshold. Required when the model declares no window. */
  readonly maxTokens?: number;
}

export interface MemorySystemWorkerConfig {
  /**
   * Worker model: `"provider/model"` or a model object. Default: the session's model, so the worker
   * rides the model the run already uses. The provider's key comes from the credentials slot like any run.
   */
  readonly model?: ModelRef;
  /** Text appended to the worker's default prompt. It cannot change the worker's tool set. */
  readonly instruction?: string;
  /** Reasoning level for the worker's model calls (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). */
  readonly thinkingLevel?: string;
}

/**
 * The session-tier part of `@arnilo/prism-memory-system`'s `packageConfig` (the full config adds `ltm`, `src/config.ts`). Every key is optional: with no config
 * the package registers everything, stays off until `memory:session` turns it on, and runs its workers
 * on the session's own model.
 *
 * `stm` records events (plan 217); `wm` runs today's reflector and `rehearsal` today's dropper,
 * unchanged, until plans 218–219 redesign them.
 */
export interface MemorySessionConfig {
  /** Starting value of the per-session toggle. Default `false`; `memory:session` flips it per session. */
  readonly enabled?: boolean;
  readonly stm?: MemorySystemWorkerConfig & {
    /** Unscanned eligible tokens that trigger a short-term memory pass. Default 10_000. */
    readonly triggerTokens?: number;
    /** Token budget of the recent STM record index each STM request carries. Default 4_000. */
    readonly contextTokens?: number;
    /** Verbatim chunks one event may carry; `0` turns chunks off. Default 2, at most 8. */
    readonly maxChunksPerEvent?: number;
    /** Bytes one stored chunk may take, truncation marker included. Default 4_096, at most 65_536. */
    readonly maxChunkBytes?: number;
    /**
     * Where the default chunk store lives: `"memory"` (the default: the process lifetime) or `{ sqlite: { path } }`, a
     * file in the host's data directory, created mode 0600. A package providing the `memory.chunks` service replaces it.
     */
    readonly chunkStore?: ChunkStoreLocation;
    /**
     * Habituation: an event whose kind and normalised description match one of the newest `windowEvents` active
     * records (default 50), with byte-equal chunks or none, raises that record's count instead of adding one.
     * `false` records every event.
     */
    readonly habituation?: false | { readonly windowEvents?: number };
    /**
     * Boundary passes. Boundary markers (outcome, task-state change, user turn after an idle gap) are always
     * recorded, at no model cost. `true` also runs an STM pass below `triggerTokens` when the unscanned tail holds a
     * user turn after an idle gap: at most one extra STM call per boundary. Default `false`.
     */
    readonly boundaries?: boolean;
    /** Minutes of silence before a user turn that make it a boundary. Default 10. */
    readonly boundaryGapMinutes?: number;
  };
  readonly wm?: MemorySystemWorkerConfig & {
    /** Unreflected observation tokens that trigger a working-memory pass. Default 20_000. */
    readonly observationTokens?: number;
  };
  readonly rehearsal?: MemorySystemWorkerConfig & {
    /** Active-observation token budget rehearsal approaches. Default 20_000. */
    readonly targetTokens?: number;
    /** `"model"` asks the rehearsal model; `"lowest-relevance"` drops deterministically. Default `"model"`. */
    readonly policy?: MemorySystemRehearsalPolicy;
  };
  readonly context?: {
    /** Recent messages the compaction cut keeps verbatim. Default 8. */
    readonly recentMessages?: number;
    /**
     * Request compaction at this share of the model's input cap, capped by `maxTokens`. Default
     * `{ ratio: 0.6 }`. A model that declares no window uses `maxTokens` and fails without it.
     */
    readonly compactAt?: MemorySystemCompactAt;
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

const memorySystemSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: {
      type: "boolean",
      default: false,
      description: "Starting value of the per-session toggle. The memory:session command flips it per session.",
    },
    stm: {
      type: "object",
      additionalProperties: false,
      description: "Short-term memory pass: records what happened as events. What triggers it and which model runs it.",
      properties: {
        ...workerProperties("STM"),
        triggerTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_STM_TRIGGER_TOKENS,
          description: "Unscanned eligible tokens that trigger a short-term memory pass.",
        },
        contextTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_STM_CONTEXT_TOKENS,
          description: "Token budget of the recent STM record index each STM request carries.",
        },
        maxChunksPerEvent: {
          type: "integer",
          minimum: 0,
          maximum: HARD_MAX_CHUNKS_PER_EVENT,
          default: DEFAULT_MAX_CHUNKS_PER_EVENT,
          description: "Verbatim chunks one STM event may carry; 0 turns chunks off.",
        },
        maxChunkBytes: {
          type: "integer",
          minimum: 256,
          maximum: HARD_MAX_CHUNK_BYTES,
          default: DEFAULT_MAX_CHUNK_BYTES,
          description: "Bytes one stored chunk may take, truncation marker included.",
        },
        chunkStore: {
          description: 'Where the default chunk store lives: "memory" (process lifetime) or { "sqlite": { "path": "…" } } (mode 0600).',
          additionalProperties: true,
          anyOf: [
            { const: "memory" },
            {
              type: "object",
              additionalProperties: false,
              required: ["sqlite"],
              properties: {
                sqlite: {
                  type: "object",
                  additionalProperties: false,
                  required: ["path"],
                  properties: { path: { type: "string", minLength: 1, maxLength: 4096 } },
                },
              },
            },
          ],
        },
        habituation: {
          description: "Collapse repeated identical events into one record with a count; false records every event.",
          additionalProperties: true,
          anyOf: [
            { const: false },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                windowEvents: {
                  type: "integer",
                  minimum: 1,
                  maximum: HARD_MAX_STM_HABITUATION_WINDOW,
                  default: DEFAULT_STM_HABITUATION_WINDOW,
                  description: "Newest active STM records a new event is compared against.",
                },
              },
            },
          ],
        },
        boundaries: {
          type: "boolean",
          default: false,
          description:
            "Run an STM pass below triggerTokens when a user turn follows an idle gap (one extra STM call per boundary). Markers are recorded either way.",
        },
        boundaryGapMinutes: {
          type: "number",
          minimum: 1,
          maximum: 10_080,
          default: DEFAULT_STM_BOUNDARY_GAP_MINUTES,
          description: "Minutes of silence before a user turn that make it an event boundary.",
        },
      },
    },
    wm: {
      type: "object",
      additionalProperties: false,
      description: "Working-memory pass (today's reflector): what triggers it and which model runs it.",
      properties: {
        ...workerProperties("WM"),
        observationTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_WM_OBSERVATION_TOKENS,
          description: "Unreflected observation tokens that trigger a working-memory pass.",
        },
      },
    },
    rehearsal: {
      type: "object",
      additionalProperties: false,
      description: "Rehearsal pass (today's dropper): the active-observation budget and which model trims it.",
      properties: {
        ...workerProperties("Rehearsal"),
        targetTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_REHEARSAL_TARGET_TOKENS,
          description: "Active-observation token budget rehearsal approaches.",
        },
        policy: {
          type: "string",
          enum: ["model", "lowest-relevance"],
          default: "model",
          description: '"model" asks the rehearsal model; "lowest-relevance" drops deterministically.',
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
/** The model, instruction and thinking-level fields every worker section shares. */
function workerProperties(label: string): Record<string, JsonSchema> {
  return {
    model: {
      description: `${label} model: "provider/model" or a model object. Defaults to the session model.`,
      // The shape is the `anyOf` below: the branch validates the keys, so the outer node stays open.
      additionalProperties: true,
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    instruction: {
      type: "string",
      maxLength: 8_192,
      description: `Text appended to the ${label} worker's default prompt. It cannot change the worker's tools.`,
    },
    thinkingLevel: {
      type: "string",
      enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      description: `Reasoning level for the ${label} worker's model calls.`,
    },
  };
}

const TUNING_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  "stm.triggerTokens",
  "stm.contextTokens",
  "stm.maxChunksPerEvent",
  "stm.maxChunkBytes",
  "stm.habituation.windowEvents",
  "stm.boundaryGapMinutes",
  "stm.thinkingLevel",
  "wm.observationTokens",
  "wm.thinkingLevel",
  "rehearsal.targetTokens",
  "rehearsal.thinkingLevel",
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

export const memorySessionConfigSchema: JsonSchema = withStability(memorySystemSchema, TUNING_CONFIG_FIELDS);

/** A worker's resolved model and prompt settings. */
export interface ResolvedWorkerSettings {
  readonly model?: ModelRef;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
}

/** {@link MemorySessionConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedMemorySystemConfig {
  readonly enabled: boolean;
  readonly recall: boolean;
  readonly stm: ResolvedWorkerSettings & {
    readonly triggerTokens: number;
    readonly contextTokens: number;
    readonly maxChunksPerEvent: number;
    readonly maxChunkBytes: number;
    readonly chunkStore: ChunkStoreLocation;
    /** `false` when habituation is off. */
    readonly habituation: false | { readonly windowEvents: number };
    readonly boundaries: boolean;
    readonly boundaryGapMinutes: number;
  };
  /** `enabled` is the `wm` component: off, no reflector pass runs. */
  readonly wm: ResolvedWorkerSettings & { readonly enabled: boolean; readonly observationTokens: number };
  /** `enabled` is the `rehearsal` component: off, no dropper pass runs. */
  readonly rehearsal: ResolvedWorkerSettings & {
    readonly enabled: boolean;
    readonly targetTokens: number;
    readonly policy: MemorySystemRehearsalPolicy;
  };
  readonly context: { readonly recentMessages: number; readonly compactAt: ResolvedCompactAt; readonly trigger?: CompactionTrigger };
  readonly worker: MemoryWorkerLimitOptions;
}

export interface ResolvedCompactAt {
  readonly ratio: number;
  readonly maxTokens?: number;
}

/** {@link MemorySessionConfig} whose component sections may also be `false` or `null`. */
export type MemorySessionConfigInput = Omit<MemorySessionConfig, "stm" | "wm" | "rehearsal"> & {
  readonly stm?: MemorySessionConfig["stm"] | false | null;
  readonly wm?: MemorySessionConfig["wm"] | false | null;
  readonly rehearsal?: MemorySessionConfig["rehearsal"] | false | null;
};

/** Config keys the 2026-11-08 rename retired, with their successors (no alias is kept). */
const RETIRED_CONFIG_KEYS: Readonly<Record<string, string>> = {
  observer: "stm (observer.messageTokens is stm.triggerTokens)",
  reflector: "wm",
  dropper: "rehearsal",
};

/** Fails closed on a retired key, naming its successor. */
export function assertNoRetiredMemorySystemKeys(config: object): void {
  for (const [key, successor] of Object.entries(RETIRED_CONFIG_KEYS)) {
    if (key in config) throw new TypeError(`memory-system config: "${key}" was renamed; use "${successor}"`);
  }
}

function workerSettings(value: MemorySystemWorkerConfig | undefined): ResolvedWorkerSettings {
  return {
    ...(value?.model === undefined ? {} : { model: value.model }),
    ...(value?.instruction === undefined || value.instruction.trim() === "" ? {} : { instruction: value.instruction }),
    ...(value?.thinkingLevel === undefined ? {} : { thinkingLevel: value.thinkingLevel }),
  };
}

/** The session-tier components a resolved config runs (`components.ts` resolves them for the package). */
export interface MemorySessionComponents {
  readonly wm: boolean;
  readonly rehearsal: boolean;
}

/**
 * Applies the session tiers' defaults. A component section may be `false` or `null` (the system config's component
 * values): its fields then take their defaults, and `components` says whether it runs (default: both run).
 */
export function resolveMemorySystemConfig(
  input: MemorySessionConfigInput = {},
  components: MemorySessionComponents = { wm: true, rehearsal: true },
): ResolvedMemorySystemConfig {
  assertNoRetiredMemorySystemKeys(input);
  const section = <T>(value: T | false | null | undefined): T | undefined => (value === false || value === null ? undefined : value);
  const config: MemorySessionConfig = {
    ...input,
    stm: section(input.stm),
    wm: section(input.wm),
    rehearsal: section(input.rehearsal),
  };
  if (
    (config.rehearsal?.targetTokens ?? DEFAULT_REHEARSAL_TARGET_TOKENS) < (config.wm?.observationTokens ?? DEFAULT_WM_OBSERVATION_TOKENS)
  ) {
    throw new Error("rehearsal.targetTokens must be >= wm.observationTokens");
  }
  return {
    enabled: config.enabled === true,
    recall: config.recall !== false,
    stm: {
      ...workerSettings(config.stm),
      triggerTokens: config.stm?.triggerTokens ?? DEFAULT_STM_TRIGGER_TOKENS,
      contextTokens: config.stm?.contextTokens ?? DEFAULT_STM_CONTEXT_TOKENS,
      maxChunksPerEvent: config.stm?.maxChunksPerEvent ?? DEFAULT_MAX_CHUNKS_PER_EVENT,
      maxChunkBytes: config.stm?.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES,
      chunkStore: config.stm?.chunkStore ?? "memory",
      habituation:
        config.stm?.habituation === false
          ? false
          : { windowEvents: config.stm?.habituation?.windowEvents ?? DEFAULT_STM_HABITUATION_WINDOW },
      boundaries: config.stm?.boundaries === true,
      boundaryGapMinutes: config.stm?.boundaryGapMinutes ?? DEFAULT_STM_BOUNDARY_GAP_MINUTES,
    },
    wm: {
      ...workerSettings(config.wm),
      enabled: components.wm,
      observationTokens: config.wm?.observationTokens ?? DEFAULT_WM_OBSERVATION_TOKENS,
    },
    rehearsal: {
      ...workerSettings(config.rehearsal),
      enabled: components.rehearsal,
      targetTokens: config.rehearsal?.targetTokens ?? DEFAULT_REHEARSAL_TARGET_TOKENS,
      policy: config.rehearsal?.policy === "lowest-relevance" ? "lowest-relevance" : "model",
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

function resolveCompactAt(value: MemorySystemCompactAt | undefined): ResolvedCompactAt {
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
