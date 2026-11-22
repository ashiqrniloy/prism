import type { ModelRef, RunLimits } from "@arnilo/prism";
import type { DelegateContextConfig } from "./context.js";

export type { DelegateContextConfig };

export type DelegateReport = "on-complete" | "milestones" | "stream";

/**
 * One child the model may delegate to. The child is a session of the parent's own agent, linked to the parent session;
 * `inherit` names the packages whose tools it may call.
 */
export interface DelegateChildConfig {
  /**
   * Package names (loaded in the parent) whose registered tools the child may call, narrowed by `tools.only`. `[]` gives
   * no tools. Never includes this package. Hooks of every loaded package apply to the child either way.
   */
  readonly inherit: readonly string[];
  readonly instructions?: string;
  /** One line the parent model reads to choose this child. Defaults to the first sentence of `instructions`. */
  readonly description?: string;
  /** Defaults to the parent session's model. */
  readonly model?: ModelRef;
  readonly tools?: { readonly only?: readonly string[] };
  /**
   * The child's run limits: any `RunLimits` axis, `null` where the kernel accepts it. A value above a delegate ceiling
   * (`DelegateConfig.ceilings`) fails the load; it is never clamped.
   */
  readonly limits?: DelegateChildLimits;
  readonly report?: DelegateReport;
  /** Which of the parent's skills the child gets: `"inherit"` (default), `"none"`, or names. An unknown name fails the delegation. */
  readonly skills?: "inherit" | "none" | readonly string[];
  /**
   * How much of the parent's conversation the child is given: `"none"` (default), `"summary"` (one model
   * call, then a summary entry), or `{ lastTurns, maxChars? }`. Host config only; the tool cannot widen it.
   */
  readonly context?: DelegateContextConfig;
  /** Left out of the `delegate` description and its `child` enum; only the `delegate` service can start it. */
  readonly hidden?: boolean;
  /** Cap on the answer text the parent sees. Default 12,000; at most `ceilings.resultMaxChars` (64,000). The rest is paged by `delegate_wait`. */
  readonly resultMaxChars?: number;
  /**
   * `"worktree"` runs the child in its own git worktree of the inherited coding package's repository
   * and merges its branch into the parent's current branch when it completes. `"none"` (default)
   * leaves it in whatever tree the inherited tools use.
   */
  readonly isolation?: "none" | "worktree";
}

/** Every `RunLimits` axis a child run takes (`backgroundSettleMs` is agent-wide, so not here). */
export type DelegateChildLimits = Omit<RunLimits, "backgroundSettleMs">;

/**
 * Host-only ceilings over every child's config (plan 239 Task 5). A child value above one fails the load. `null` on a
 * run-limit axis removes that ceiling. The model's `delegate` arguments never reach a limit.
 */
export interface DelegateCeilings {
  /** Default 200. */
  readonly maxTurns?: number | null;
  /** Default 1,000. */
  readonly maxToolCalls?: number | null;
  /** Default 2,000,000. */
  readonly maxTotalTokens?: number | null;
  /** Default 3,600,000 (one hour). */
  readonly maxWallTimeMs?: number | null;
  /** Ceiling for a child's `resultMaxChars`. Default 64,000. */
  readonly resultMaxChars?: number;
  /** Answer text one delegation retains for `delegate_wait` paging. Default 256,000, and at least `resultMaxChars`. */
  readonly retainedResultChars?: number;
}

export interface DelegateConfig {
  readonly children: Readonly<Record<string, DelegateChildConfig>>;
  /**
   * A directory holding Claude Code subagent files: `<agentsRoot>/.agents/agents/*.md` then
   * `<agentsRoot>/.claude/agents/*.md`. Each file becomes a child that inherits `defaultInherit`,
   * narrowed by its own `tools` list; a file never names a package.
   */
  readonly agentsRoot?: string;
  /** The packages file-defined children inherit. Required when `agentsRoot` is set. */
  readonly defaultInherit?: readonly string[];
  /**
   * How deep a delegation tree may grow: `1` (default) means a child never sees `delegate`; `2` lets a child delegate
   * once more; at most `3`. A session at depth `d` (`SessionContext.depth`) sees `delegate` only while `d < maxDepth`.
   */
  readonly maxDepth?: number;
  /** Running delegations at once across the whole tree (every depth, sync and async). */
  readonly maxConcurrent?: number;
  /**
   * How long a call over `maxConcurrent` waits for a slot, in call order, before it fails. Default 30,000 ms; `0` fails
   * at once (the behavior before plan 232).
   */
  readonly queueTimeoutMs?: number;
  /**
   * When a run is about to end while async delegations of its session are still running or finished but unread, ask
   * for one `run.end` continuation naming them. Default `true`. Bounded by the kernel's `limits.maxContinuations`.
   */
  readonly announceAsync?: boolean;
  /** How often a `report: "stream"` child's buffered `delegate.activity` text is flushed, in ms. Default 1,000. */
  readonly activityFlushMs?: number;
  /** Host-only ceilings over the children's limits and answer sizes. */
  readonly ceilings?: DelegateCeilings;
}

export const DEFAULT_MAX_CONCURRENT = 4;
export const DEFAULT_MAX_DEPTH = 1;
/** Attribution carries two path entries per level; three levels keep a tree well inside the kernel's caps. */
export const HARD_MAX_DEPTH = 3;
export const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

const positive = { type: "integer", minimum: 1 } as const;
const nullablePositive = { anyOf: [positive, { type: "null" }] } as const;

const modelRef = {
  anyOf: [
    { type: "string" },
    { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: ["provider", "model"] },
  ],
} as const;

export const delegateConfigSchema = {
  type: "object",
  properties: {
    children: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          inherit: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          model: modelRef,
          tools: { type: "object", properties: { only: { type: "array", items: { type: "string" } } }, additionalProperties: false },
          limits: {
            type: "object",
            properties: {
              maxTurns: nullablePositive,
              maxProviderAttempts: nullablePositive,
              maxToolRounds: nullablePositive,
              maxToolCalls: nullablePositive,
              maxWallTimeMs: nullablePositive,
              maxRequestBytes: positive,
              maxResponseBytes: positive,
              maxInputTokens: nullablePositive,
              maxOutputTokens: nullablePositive,
              maxTotalTokens: nullablePositive,
              maxCost: {
                type: "object",
                properties: { amount: { type: "number", minimum: 0 }, currency: { type: "string", minLength: 1 } },
                required: ["amount", "currency"],
                additionalProperties: false,
              },
              maxContinuations: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
              maxToolTimeMs: nullablePositive,
              bufferOutput: { type: "boolean" },
              maxRunStateBytes: positive,
            },
            additionalProperties: false,
          },
          report: { type: "string", enum: ["on-complete", "milestones", "stream"] },
          skills: {
            anyOf: [
              { type: "string", enum: ["inherit", "none"] },
              { type: "array", items: { type: "string" } },
            ],
          },
          resultMaxChars: { type: "integer", minimum: 1 },
          context: {
            anyOf: [
              { type: "string", enum: ["none", "summary"] },
              {
                type: "object",
                properties: { lastTurns: { type: "integer", minimum: 1 }, maxChars: { type: "integer", minimum: 1 } },
                required: ["lastTurns"],
                additionalProperties: false,
              },
            ],
          },
          hidden: { type: "boolean" },
          isolation: { type: "string", enum: ["none", "worktree"] },
          description: { type: "string", minLength: 1 },
        },
        required: ["inherit"],
        additionalProperties: false,
      },
    },
    agentsRoot: { type: "string", minLength: 1 },
    defaultInherit: { type: "array", items: { type: "string" } },
    // Retired (plan 232 Task 4): kept in the schema only so `setup` can fail the load with a message naming the replacement.
    ownership: { description: "Retired: a child session inherits the parent session's ownership scope." },
    maxDepth: { type: "integer", minimum: 1, maximum: HARD_MAX_DEPTH },
    maxConcurrent: { type: "integer", minimum: 1 },
    queueTimeoutMs: { type: "integer", minimum: 0 },
    announceAsync: { type: "boolean" },
    activityFlushMs: { type: "integer", minimum: 0 },
    ceilings: {
      type: "object",
      properties: {
        maxTurns: nullablePositive,
        maxToolCalls: nullablePositive,
        maxTotalTokens: nullablePositive,
        maxWallTimeMs: nullablePositive,
        resultMaxChars: positive,
        retainedResultChars: positive,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export type { RunLimits };
