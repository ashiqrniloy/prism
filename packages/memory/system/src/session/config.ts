import { type JsonSchema, type ModelConfig, type ModelRef, resolveInputCap } from "@arnilo/prism";

import {
  DEFAULT_MAX_TASK_STATE_BYTES,
  DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
  DEFAULT_MAX_WORKER_ERROR_BYTES,
  DEFAULT_MAX_WORKER_MESSAGE_BYTES,
  DEFAULT_MAX_WORKER_RESULT_BYTES,
  DEFAULT_MAX_WORKER_TOOL_CALLS,
  DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_WORKER_TURNS,
  type MemoryWorkerLimitOptions,
} from "@arnilo/prism-memory-system/core";
import { DEFAULT_MAX_RECALL_PAGE_LIMIT, DEFAULT_RECALL_PAGE_BYTES, DEFAULT_RECALL_PAGE_LIMIT, MIN_RECALL_PAGE_BYTES } from "./limits.js";
import { DEFAULT_SCOPE_MAX_BYTES, type EpisodeScope, prepareScope } from "./scope.js";

/** `recallLimits`: the `recall` tool's host bounds. */
export interface RecallLimitsConfig {
  /** The page size when the call carries none. Default 20. */
  readonly pageLimit?: number;
  /** Bytes one answer may carry. Default 16,384, at least 1,024. */
  readonly pageBytes?: number;
  /** The most hits or messages one call may ask for (the model's `limit`). Default 100. */
  readonly maxPageLimit?: number;
}

export const DEFAULT_STM_TRIGGER_TOKENS = 10_000;
/**
 * The reasoning level of the STM, WM and Rehearsal worker calls when a section names none (plan 218 Task 6, gate M-2):
 * recording and judging records needs little reasoning, and a model's own default (`high` on some) spends the output
 * limit before any verdict. A model without reasoning levels ignores it.
 */
export const DEFAULT_MEMORY_WORKER_THINKING_LEVEL = "low";
/** Token budget of the recent-record index an STM request carries (plan 217 Task 1). */
export const DEFAULT_STM_CONTEXT_TOKENS = 4_000;
/** Characters (whitespace collapsed) up to which STM keeps a user message word for word (plan 218.5 Task 1, fix 1). */
export const DEFAULT_STM_VERBATIM_USER_CHARS = 2_000;
/** Active STM records habituation compares a new event against (plan 217 Task 3). */
export const DEFAULT_STM_HABITUATION_WINDOW = 50;
/** Minutes of silence before a user turn that make it an event boundary (plan 217 Task 3). */
export const DEFAULT_STM_BOUNDARY_GAP_MINUTES = 10;
/** STM surface tokens (records WM has not given a verdict) that trigger a WM pass (plan 218 Task 2). */
export const DEFAULT_WM_TRIGGER_TOKENS = 10_000;
/**
 * STM record tokens one WM pass is sent. Sized so a batch's verdicts (one `judge` call, about 40-75 output tokens per
 * record on the plan 218.2 Task 5 replay) fit one model's output cap: gate M-1 saw two answer models write nothing on
 * about 22k tokens.
 */
export const DEFAULT_WM_BATCH_TOKENS = 3_000;
/** The share of a batch's surface tokens WM's items aim at (plan 218 Task 3): pressure after relevance, never a cut of protected records. */
export const DEFAULT_WM_TARGET_RATIO = 0.2;
/** Tombstoned STM record tokens the first WM pass after a scope change is also sent for re-judgment (plan 218 Task 4). */
export const DEFAULT_WM_REJUDGE_TOKENS = 8_000;
/** Earlier records one WM pass is offered for the scope's remaining steps (plan 218.3 Task 1 decision 5). */
export const DEFAULT_WM_LOOKAHEAD_RECORDS = 12;
/** Record tokens one WM pass is offered for the scope's remaining steps (plan 218.3 Task 1 decision 5). */
export const DEFAULT_WM_LOOKAHEAD_TOKENS = 3_000;
/**
 * Newer user requests a request or error stays protected by link without a resolving outcome (plan 218.2 Task 3;
 * counted in tasks since plan 218.5 Task 7: counted in WM passes, it outlived every task of a long session).
 */
export const DEFAULT_WM_PROTECT_REQUEST_TASKS = 3;
export const DEFAULT_REHEARSAL_TARGET_TOKENS = 20_000;
/** The mid-loop trigger: the share of the model's input cap a request may reach inside an agentic loop (plan 218.3 Task 2). */
export const DEFAULT_COMPACT_AT_RATIO = 0.8;
/** The between-loop trigger: the request size at which a run that starts after a completed loop compacts first. */
export const DEFAULT_COMPACT_AFTER_RUN_TOKENS = 80_000;
/** The mid-loop cut's verbatim tail, as a share of the model's input cap, when `context.keepRecentTokens` is unset. */
export const DEFAULT_KEEP_RECENT_RATIO = 0.2;

/** Internal render bounds: the pool the folded payload keeps, and the recall page size. */
export const OBSERVATIONS_POOL_MAX_TOKENS = 20_000;
export const OBSERVATIONS_POOL_TARGET_TOKENS = 10_000;
/**
 * The pool's share of the model's input cap (plan 218.3 Task 12): with the 20% kept tail and the prompt, the folded
 * pool must leave a compacted request under the 80% mid-loop trigger. A fixed 20,000 at a 32K window did not, so the
 * next tool round overflowed.
 */
export const OBSERVATIONS_POOL_CAP_RATIO = 0.3;

/** The folded pool's token budget: {@link OBSERVATIONS_POOL_MAX_TOKENS}, or 30% of the input cap when that is smaller. */
export function resolveObservationsPoolTokens(inputCapTokens: number | undefined): number {
  return inputCapTokens === undefined
    ? OBSERVATIONS_POOL_MAX_TOKENS
    : Math.min(OBSERVATIONS_POOL_MAX_TOKENS, Math.floor(inputCapTokens * OBSERVATIONS_POOL_CAP_RATIO));
}

export type MemorySystemRehearsalPolicy = "model" | "lowest-relevance";
/**
 * The order STM records are left out of the memory block when the pool is over its bound (plan 218.5 Task 3).
 * `"relevance"`: lowest relevance first, then smallest. `"protect-user"`: the agent's own records first (lowest
 * relevance, then oldest), and no durable record or user statement while one of those remains.
 */
export type MemorySystemEviction = "relevance" | "protect-user";
/** `"model"` asks the WM model for verdicts; `"deterministic"` keeps protected records and outcomes and discards the lowest-relevance oldest to the target, with no call. */
export type MemorySystemWmPolicy = "model" | "deterministic";

/** The mid-loop trigger: compact inside an agentic loop when the request reaches `ratio` of the model's input cap. */
export interface MemorySystemCompactAt {
  /** Share of the model's input cap. Default `0.8`. */
  readonly ratio?: number;
}

/**
 * The between-loop trigger, checked only at the start of a run that follows a completed loop: compact when the request
 * reaches `maxTokens`, or `ratio` of the model's input cap; the smaller wins when both are set. Default
 * `{ maxTokens: 80_000 }`.
 */
export interface MemorySystemCompactAfterRun {
  readonly maxTokens?: number;
  readonly ratio?: number;
}

export interface MemorySystemWorkerConfig {
  /**
   * Worker model: `"provider/model"` or a model object. Default: the session's model, so the worker
   * rides the model the run already uses. The provider's key comes from the credentials slot like any run.
   */
  readonly model?: ModelRef;
  /** Text appended to the worker's default prompt. It cannot change the worker's tool set. */
  readonly instruction?: string;
  /** Reasoning level for the worker's model calls (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Default `low`. */
  readonly thinkingLevel?: string;
}

/**
 * The session-tier part of `@arnilo/prism-memory-system`'s `packageConfig` (the full config adds `ltm`, `src/config.ts`). Every key is optional: with no config
 * the package registers everything, stays off until `memory:session` turns it on, and runs its workers
 * on the session's own model.
 *
 * `stm` records events (plan 217); `wm` gives verdicts on them (plan 218); `rehearsal` runs today's dropper,
 * unchanged, until plan 219 redesigns it.
 */
export interface MemorySessionConfig {
  /** Starting value of the per-session toggle. Default `false`; `memory:session` flips it per session. */
  readonly enabled?: boolean;
  readonly stm?: MemorySystemWorkerConfig & {
    /** Unscanned eligible tokens that trigger a short-term memory pass. Default 10_000. */
    readonly triggerTokens?: number;
    /** Token budget of the recent STM record index each STM request carries. Default 4_000. */
    readonly contextTokens?: number;
    /**
     * Habituation: an event whose kind and normalised description match one of the newest `windowEvents` active
     * records (default 50) raises that record's count instead of adding one.
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
    /**
     * A user message up to this many characters (whitespace collapsed) is kept word for word as one `request` record,
     * written without the model; a longer one is left to the model. It costs the message's tokens on the memory
     * surface once (no model call). 0 leaves every user message to the model. Default 2_000.
     */
    readonly verbatimUserChars?: number;
  };
  readonly wm?: MemorySystemWorkerConfig & {
    /** STM surface tokens (records without a WM verdict) that trigger a working-memory pass. Default 10_000. */
    readonly triggerTokens?: number;
    /** STM record tokens one WM pass is sent, oldest first; the rest waits for the next pass. Default 3_000. */
    readonly batchTokens?: number;
    /** Items' tokens over the processed records' tokens a pass aims at, as pressure (protected records are never cut). Default 0.2. */
    readonly targetRatio?: number;
    /** Tombstoned record tokens the first WM pass after a scope change re-judges (discarded records). Default 8_000. */
    readonly rejudgeTokens?: number;
    /** Earlier STM records (discarded or dropped) matching the scope's remaining steps one WM pass is offered to keep. 0 turns look-ahead off. Default 12. */
    readonly lookAheadRecords?: number;
    /** Tokens of those look-ahead records one WM pass is offered. Default 3_000. */
    readonly lookAheadTokens?: number;
    /**
     * Newer user requests a user request (or an error) stays protected through without an outcome naming it in
     * `resolves`; then the next WM pass records `protection_lapsed` and may discard it. Read only when the recorder
     * writes `resolves`. Default 3.
     */
    readonly protectRequestTasks?: number;
    /** `"model"` (default) or `"deterministic"` (no model call). */
    readonly policy?: MemorySystemWmPolicy;
  };
  readonly rehearsal?: MemorySystemWorkerConfig & {
    /** Active-observation token budget rehearsal approaches. Default 20_000. */
    readonly targetTokens?: number;
    /** `"model"` asks the rehearsal model; `"lowest-relevance"` drops deterministically. Default `"model"`. */
    readonly policy?: MemorySystemRehearsalPolicy;
  };
  readonly context?: {
    /**
     * Session memory is the agent's compaction system. Default `true`: the package claims the `compaction` slot and
     * answers every compaction vote of a session that has memory on. `false` leaves compaction to another system (the
     * `@arnilo/prism-extensions/compaction` package or the kernel default); STM still records, `recall` still works and
     * the memory block is pinned after each compaction. Two compaction systems never run together: with `true`, listing
     * the compaction package (or `context-engineering`'s `fold` or `attention`) fails at agent creation.
     */
    readonly compaction?: boolean;
    /** The mid-loop trigger. Default `{ ratio: 0.8 }`. */
    readonly compactAt?: MemorySystemCompactAt;
    /** The between-loop trigger. Default `{ maxTokens: 80_000 }`. */
    readonly compactAfterRun?: MemorySystemCompactAfterRun;
    /**
     * Tokens a mid-loop compaction keeps verbatim at the end of the branch, besides the newest tool round (always kept).
     * Default: 20% of the model's input cap, else 20% of `compactAfterRun.maxTokens`. A between-loop compaction keeps only
     * the run's new input.
     */
    readonly keepRecentTokens?: number;
    /**
     * The order STM records are left out of the memory block when the pool is over its bound. Default `"relevance"`.
     * `"protect-user"` is a candidate under measurement (plan 218.5); the default may change on its verdict.
     */
    readonly eviction?: MemorySystemEviction;
  };
  /** Worker loop ceilings. Defaults and hard caps are the package's own (`limits.ts`). */
  readonly worker?: MemoryWorkerLimitOptions;
  /** Expose the `recall` tool while the session's toggle is on. Default `true`. */
  readonly recall?: boolean;
  /** The `recall` tool's bounds. The model picks `limit`; these are the host's. */
  readonly recallLimits?: RecallLimitsConfig;
  /**
   * The episode scope (plan 218 Task 1): what the current body of work must achieve, read by WM and Rehearsal only.
   * `text` is every session's scope until `memory:scope` or `memory.system.setScope()` replaces or clears it.
   */
  readonly scope?: {
    /** The starting scope text, redacted and bounded like a set. */
    readonly text?: string;
    /** Bytes one scope may take. Longer text fails with `scope_too_large`. Default 32_768, at most 49_152. */
    readonly maxBytes?: number;
  };
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
        verbatimUserChars: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_STM_VERBATIM_USER_CHARS,
          description:
            "A user message up to this many characters is kept word for word, without the model; 0 leaves every user message to the model.",
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
      description: "Working-memory pass: verdicts on STM records, what triggers it and which model runs it.",
      properties: {
        ...workerProperties("WM"),
        triggerTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_WM_TRIGGER_TOKENS,
          description: "STM surface tokens (records without a WM verdict) that trigger a working-memory pass.",
        },
        batchTokens: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_WM_BATCH_TOKENS,
          description: "STM record tokens one WM pass is sent, oldest first; the rest waits for the next pass.",
        },
        targetRatio: {
          type: "number",
          minimum: 0.01,
          maximum: 1,
          default: DEFAULT_WM_TARGET_RATIO,
          description:
            "Items' tokens over the processed records' tokens a WM pass aims at: pressure after relevance; protected records are never cut.",
        },
        rejudgeTokens: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_WM_REJUDGE_TOKENS,
          description:
            "Tokens of discarded STM records the first WM pass after a scope change is also sent, so it may keep them back; 0 turns re-judgment off.",
        },
        lookAheadRecords: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_WM_LOOKAHEAD_RECORDS,
          description:
            "Earlier STM records (discarded or dropped) matching the scope's remaining steps one WM pass is offered to keep; 0 turns look-ahead off.",
        },
        lookAheadTokens: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_WM_LOOKAHEAD_TOKENS,
          description: "Tokens of earlier STM records one WM pass is offered for the scope's remaining steps.",
        },
        protectRequestTasks: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_WM_PROTECT_REQUEST_TASKS,
          description:
            "Newer user requests a user request or error stays protected through without an outcome naming it in resolves; then the next WM pass records protection_lapsed.",
        },
        policy: {
          type: "string",
          enum: ["model", "deterministic"],
          default: "deterministic",
          description:
            '"model" asks the WM model; "deterministic" keeps protected records and outcomes and discards the lowest-relevance oldest to the target, with no model call.',
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
      description: "Session memory as the compaction system: whether it is on, and its two triggers.",
      properties: {
        compaction: {
          type: "boolean",
          default: true,
          description:
            "Session memory is the agent's compaction system. false leaves compaction to another system; two never run together.",
        },
        compactAt: {
          type: "object",
          additionalProperties: false,
          description: "The mid-loop trigger: compact inside an agentic loop at ratio of the model's input cap.",
          properties: {
            ratio: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: DEFAULT_COMPACT_AT_RATIO,
              description: "Share of the model's input cap. Default 0.8.",
            },
          },
        },
        compactAfterRun: {
          type: "object",
          additionalProperties: false,
          description:
            "The between-loop trigger, checked only when a run starts after a completed loop: maxTokens, or ratio of the input cap (the smaller wins).",
          properties: {
            maxTokens: {
              type: "integer",
              minimum: 1,
              description: "Request tokens. Default 80000 when the section is omitted. Required when the model declares no window.",
            },
            ratio: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Share of the model's input cap.",
            },
          },
        },
        keepRecentTokens: {
          type: "integer",
          minimum: 1,
          description: "Tokens a mid-loop compaction keeps verbatim besides the newest tool round. Default 20% of the model's input cap.",
        },
        eviction: {
          type: "string",
          enum: ["relevance", "protect-user"],
          default: "relevance",
          description:
            'The order STM records are left out of the memory block when the pool is over its bound. "relevance": lowest relevance first, then smallest. "protect-user": the agent\'s own records first (lowest relevance, then oldest), and no durable record or user statement while one of those remains.',
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
          default: DEFAULT_MAX_TASK_STATE_BYTES,
          description: "Text bytes in the current task state.",
        },
        maxTurns: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_TURNS,
          description: "Provider turns one worker pass may take.",
        },
        maxToolCallsPerTurn: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
          description: "Tool calls one worker turn may make.",
        },
        maxToolCalls: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_TOOL_CALLS,
          description: "Tool calls one worker pass may make.",
        },
        maxArgumentBytes: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
          description: "Bytes one worker tool call may carry.",
        },
        maxResultBytes: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_RESULT_BYTES,
          description: "Bytes one worker tool result may carry.",
        },
        maxMessageBytes: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_WORKER_MESSAGE_BYTES,
          description: "Bytes one worker message may carry.",
        },
        maxErrorBytes: {
          type: "integer",
          minimum: 1,
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
    recallLimits: {
      type: "object",
      additionalProperties: false,
      description: "The recall tool's bounds: the default page size, the bytes one answer may carry, and the most a call may ask for.",
      properties: {
        pageLimit: { type: "integer", minimum: 1, default: DEFAULT_RECALL_PAGE_LIMIT },
        pageBytes: { type: "integer", minimum: MIN_RECALL_PAGE_BYTES, default: DEFAULT_RECALL_PAGE_BYTES },
        maxPageLimit: { type: "integer", minimum: 1, default: DEFAULT_MAX_RECALL_PAGE_LIMIT },
      },
    },
    scope: {
      type: "object",
      additionalProperties: false,
      description: "The episode scope: what the current body of work must achieve. Read by WM and Rehearsal only, never STM.",
      properties: {
        text: {
          type: "string",
          description: "Every session's starting scope until memory:scope or memory.system.setScope() replaces or clears it.",
        },
        maxBytes: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_SCOPE_MAX_BYTES,
          description: "Bytes one scope may take; longer text fails with scope_too_large and is never truncated.",
        },
      },
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
      default: DEFAULT_MEMORY_WORKER_THINKING_LEVEL,
      description: `Reasoning level for the ${label} worker's model calls. Default low; a model without reasoning levels ignores it.`,
    },
  };
}

const TUNING_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  "stm.triggerTokens",
  "stm.contextTokens",
  "stm.habituation.windowEvents",
  "stm.boundaryGapMinutes",
  "stm.verbatimUserChars",
  "stm.thinkingLevel",
  "wm.triggerTokens",
  "wm.batchTokens",
  "wm.targetRatio",
  "wm.rejudgeTokens",
  "wm.lookAheadRecords",
  "wm.lookAheadTokens",
  "wm.protectRequestTasks",
  "wm.thinkingLevel",
  "rehearsal.targetTokens",
  "rehearsal.thinkingLevel",
  "context.compactAt.ratio",
  "context.compactAfterRun.maxTokens",
  "context.compactAfterRun.ratio",
  "context.keepRecentTokens",
  "context.eviction",
  "recallLimits.pageLimit",
  "recallLimits.pageBytes",
  "recallLimits.maxPageLimit",
  "worker.maxTaskStateBytes",
  "worker.maxTurns",
  "worker.maxToolCallsPerTurn",
  "worker.maxToolCalls",
  "worker.maxArgumentBytes",
  "worker.maxResultBytes",
  "worker.maxMessageBytes",
  "worker.maxErrorBytes",
  "scope.maxBytes",
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
  readonly recallLimits: RecallLimitsConfig;
  readonly stm: ResolvedWorkerSettings & {
    readonly triggerTokens: number;
    readonly contextTokens: number;
    /** `false` when habituation is off. */
    readonly habituation: false | { readonly windowEvents: number };
    readonly boundaries: boolean;
    readonly boundaryGapMinutes: number;
    readonly verbatimUserChars: number;
  };
  /** `enabled` is the `wm` component: off, no WM pass runs. */
  readonly wm: ResolvedWorkerSettings & {
    readonly enabled: boolean;
    readonly triggerTokens: number;
    readonly batchTokens: number;
    readonly targetRatio: number;
    readonly rejudgeTokens: number;
    readonly lookAheadRecords: number;
    readonly lookAheadTokens: number;
    readonly protectRequestTasks: number;
    readonly policy: MemorySystemWmPolicy;
  };
  /** `enabled` is the `rehearsal` component: off, no dropper pass runs. */
  readonly rehearsal: ResolvedWorkerSettings & {
    readonly enabled: boolean;
    readonly targetTokens: number;
    readonly policy: MemorySystemRehearsalPolicy;
  };
  readonly context: {
    readonly compaction: boolean;
    readonly compactAt: ResolvedCompactAt;
    readonly compactAfterRun: ResolvedCompactAfterRun;
    /** Absent: 20% of the input cap (or of `compactAfterRun.maxTokens`), resolved at each compaction. */
    readonly keepRecentTokens?: number;
    readonly eviction: MemorySystemEviction;
  };
  readonly worker: MemoryWorkerLimitOptions;
  /**
   * The episode scope settings. `text` is the validated config scope; it is redacted again with the session's secret
   * set on every worker call, since no secret set exists at load.
   */
  readonly scope: { readonly maxBytes: number; readonly text?: EpisodeScope };
}

export interface ResolvedCompactAt {
  readonly ratio: number;
}

/** At least one of the two is set. */
export interface ResolvedCompactAfterRun {
  readonly maxTokens?: number;
  readonly ratio?: number;
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

/** Section keys plan 218 Task 2 retired, with their successors. */
const RETIRED_SECTION_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  wm: { observationTokens: "wm.triggerTokens (STM surface tokens; default 10_000)" },
  // Plan 218.3 Task 4: no chunk store; recall reads the original entries from the session store.
  stm: {
    maxChunksPerEvent: 'recall { id, detail: "full" } or recall { entry } (originals from the session store)',
    maxChunkBytes: "recall { entry, offset } (pages inside one original entry)",
    autoChunkBytes: 'recall { id, detail: "full" } (a record\'s cited entries, verbatim)',
    chunkStore: "the session store (recall reads the original entries; nothing is copied)",
  },
  // Plan 218.3 Task 2: session memory compacts on two triggers only.
  context: {
    recentMessages: "context.keepRecentTokens (the mid-loop cut's verbatim tail, in tokens)",
    trigger: "context.compactAt (mid-loop) and context.compactAfterRun (between loops)",
  },
};

/** Fails closed on a retired key, naming its successor. */
export function assertNoRetiredMemorySystemKeys(config: object): void {
  for (const [key, successor] of Object.entries(RETIRED_CONFIG_KEYS)) {
    if (key in config) throw new TypeError(`memory-system config: "${key}" was renamed; use "${successor}"`);
  }
  for (const [section, keys] of Object.entries(RETIRED_SECTION_KEYS)) {
    const value = (config as Record<string, unknown>)[section];
    if (typeof value !== "object" || value === null) continue;
    for (const [key, successor] of Object.entries(keys))
      if (key in value) throw new TypeError(`memory-system config: "${section}.${key}" was retired; use "${successor}"`);
  }
  const compactAt = (config as { context?: { compactAt?: unknown } }).context?.compactAt;
  if (typeof compactAt === "object" && compactAt !== null && "maxTokens" in compactAt)
    throw new TypeError('memory-system config: "context.compactAt.maxTokens" was retired; use "context.compactAfterRun.maxTokens"');
}

function workerSettings(value: MemorySystemWorkerConfig | undefined): ResolvedWorkerSettings {
  return {
    ...(value?.model === undefined ? {} : { model: value.model }),
    ...(value?.instruction === undefined || value.instruction.trim() === "" ? {} : { instruction: value.instruction }),
    thinkingLevel: value?.thinkingLevel ?? DEFAULT_MEMORY_WORKER_THINKING_LEVEL,
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
  if ((config.rehearsal?.targetTokens ?? DEFAULT_REHEARSAL_TARGET_TOKENS) < (config.wm?.triggerTokens ?? DEFAULT_WM_TRIGGER_TOKENS)) {
    throw new Error("rehearsal.targetTokens must be >= wm.triggerTokens");
  }
  const targetRatio = config.wm?.targetRatio;
  if (targetRatio !== undefined && !(Number.isFinite(targetRatio) && targetRatio >= 0.01 && targetRatio <= 1)) {
    throw new Error("wm.targetRatio must be a number from 0.01 to 1");
  }
  return {
    enabled: config.enabled === true,
    recall: config.recall !== false,
    recallLimits: { ...config.recallLimits },
    stm: {
      ...workerSettings(config.stm),
      triggerTokens: config.stm?.triggerTokens ?? DEFAULT_STM_TRIGGER_TOKENS,
      contextTokens: config.stm?.contextTokens ?? DEFAULT_STM_CONTEXT_TOKENS,
      habituation:
        config.stm?.habituation === false
          ? false
          : { windowEvents: config.stm?.habituation?.windowEvents ?? DEFAULT_STM_HABITUATION_WINDOW },
      boundaries: config.stm?.boundaries === true,
      boundaryGapMinutes: config.stm?.boundaryGapMinutes ?? DEFAULT_STM_BOUNDARY_GAP_MINUTES,
      verbatimUserChars: config.stm?.verbatimUserChars ?? DEFAULT_STM_VERBATIM_USER_CHARS,
    },
    wm: {
      ...workerSettings(config.wm),
      enabled: components.wm,
      triggerTokens: config.wm?.triggerTokens ?? DEFAULT_WM_TRIGGER_TOKENS,
      batchTokens: config.wm?.batchTokens ?? DEFAULT_WM_BATCH_TOKENS,
      targetRatio: config.wm?.targetRatio ?? DEFAULT_WM_TARGET_RATIO,
      rejudgeTokens: config.wm?.rejudgeTokens ?? DEFAULT_WM_REJUDGE_TOKENS,
      lookAheadRecords: config.wm?.lookAheadRecords ?? DEFAULT_WM_LOOKAHEAD_RECORDS,
      lookAheadTokens: config.wm?.lookAheadTokens ?? DEFAULT_WM_LOOKAHEAD_TOKENS,
      protectRequestTasks: config.wm?.protectRequestTasks ?? DEFAULT_WM_PROTECT_REQUEST_TASKS,
      policy: config.wm?.policy === "model" ? "model" : "deterministic",
    },
    rehearsal: {
      ...workerSettings(config.rehearsal),
      enabled: components.rehearsal,
      targetTokens: config.rehearsal?.targetTokens ?? DEFAULT_REHEARSAL_TARGET_TOKENS,
      policy: config.rehearsal?.policy === "lowest-relevance" ? "lowest-relevance" : "model",
    },
    context: {
      compaction: config.context?.compaction !== false,
      compactAt: resolveCompactAt(config.context?.compactAt),
      compactAfterRun: resolveCompactAfterRun(config.context?.compactAfterRun),
      ...keepRecentTokensOf(config.context?.keepRecentTokens),
      eviction: config.context?.eviction === "protect-user" ? "protect-user" : "relevance",
    },
    worker: { ...config.worker },
    scope: resolveScopeConfig(config.scope),
  };
}

/** A config scope over its cap fails the load with `scope_too_large`, like a set. */
function resolveScopeConfig(input: MemorySessionConfig["scope"]): ResolvedMemorySystemConfig["scope"] {
  const maxBytes = input?.maxBytes ?? DEFAULT_SCOPE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("scope.maxBytes must be a positive integer");
  if (input?.text === undefined || input.text.trim() === "") return { maxBytes };
  // The config scope's time is fixed, so the stored hash and record are the same on every load.
  const prepared = prepareScope(input.text, { maxBytes, at: "1970-01-01T00:00:00.000Z" });
  if (!prepared.ok) throw new RangeError(`${prepared.reason}: ${prepared.text}`);
  return { maxBytes, text: prepared.scope };
}

function resolveCompactAt(value: MemorySystemCompactAt | undefined): ResolvedCompactAt {
  const ratio = value?.ratio ?? DEFAULT_COMPACT_AT_RATIO;
  if (!isRatio(ratio)) throw new TypeError("context.compactAt.ratio must be a number in (0, 1]");
  return { ratio };
}

function resolveCompactAfterRun(value: MemorySystemCompactAfterRun | undefined): ResolvedCompactAfterRun {
  if (value === undefined || (value.maxTokens === undefined && value.ratio === undefined))
    return { maxTokens: DEFAULT_COMPACT_AFTER_RUN_TOKENS };
  if (value.maxTokens !== undefined && (!Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1))
    throw new TypeError("context.compactAfterRun.maxTokens must be a positive safe integer");
  if (value.ratio !== undefined && !isRatio(value.ratio)) throw new TypeError("context.compactAfterRun.ratio must be a number in (0, 1]");
  return {
    ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }),
    ...(value.ratio === undefined ? {} : { ratio: value.ratio }),
  };
}

function keepRecentTokensOf(value: number | undefined): { readonly keepRecentTokens?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("context.keepRecentTokens must be a positive safe integer");
  return { keepRecentTokens: value };
}

/**
 * The tokens a mid-loop compaction keeps verbatim (plan 218.3 Task 3): `context.keepRecentTokens`, else
 * {@link DEFAULT_KEEP_RECENT_RATIO} of the input cap, else of `compactAfterRun.maxTokens`, else 0 (only the newest tool round).
 */
export function resolveKeepRecentTokens(
  context: Pick<ResolvedMemorySystemConfig["context"], "keepRecentTokens" | "compactAfterRun">,
  inputCapTokens: number | undefined,
): number {
  if (context.keepRecentTokens !== undefined) return context.keepRecentTokens;
  const base = inputCapTokens ?? context.compactAfterRun.maxTokens;
  return base === undefined ? 0 : Math.floor(base * DEFAULT_KEEP_RECENT_RATIO);
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

/** Which of the two triggers a compaction check answers. */
export type CompactionTriggerPoint = "mid-loop" | "between-loops";

/**
 * The token threshold a compaction check compares the kernel's estimate against (plan 218.3 Task 2).
 *
 * - `mid-loop`: `compactAt.ratio` × the model's input cap. A model that declares no window has no mid-loop trigger
 *   (`Infinity`): only the between-loop trigger and the kernel's overflow recovery apply.
 * - `between-loops`: the smaller of `compactAfterRun.maxTokens` and `compactAfterRun.ratio` × the cap, and never above the
 *   mid-loop threshold (a run that starts past the window share compacts before its first turn rather than sending it).
 *
 * A model that declares no window and a config without `compactAfterRun.maxTokens` fails, naming both keys.
 */
/** The model's declared input cap, or `undefined` when `limits.contextWindow` is unset. */
export function resolveModelInputCap(model: Pick<ModelConfig, "limits"> | undefined): number | undefined {
  try {
    return resolveInputCap(undefined, model);
  } catch {
    return undefined;
  }
}

export function resolveCompactionThreshold(
  context: Pick<ResolvedMemorySystemConfig["context"], "compactAt" | "compactAfterRun">,
  model: Pick<ModelConfig, "limits"> | undefined,
  point: CompactionTriggerPoint,
): number {
  const cap = resolveModelInputCap(model);
  const { maxTokens, ratio } = context.compactAfterRun;
  if (cap === undefined && maxTokens === undefined)
    throw new TypeError("context.compactAfterRun.maxTokens is required when the model declares no context window (limits.contextWindow)");
  const midLoop = cap === undefined ? Number.POSITIVE_INFINITY : cap * context.compactAt.ratio;
  if (point === "mid-loop") return midLoop;
  const afterRun = Math.min(
    maxTokens ?? Number.POSITIVE_INFINITY,
    cap === undefined || ratio === undefined ? Number.POSITIVE_INFINITY : cap * ratio,
  );
  return Math.min(afterRun, midLoop);
}
