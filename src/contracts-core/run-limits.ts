/** Contracts-core run-limits family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ToolResult } from "../contracts-protocol.js";
import type { ToolCallContent } from "./content.js";

/**
 * Host-authored run limits. Policy axes accept `null` to explicitly disable the cap
 * (process safety still caps request/response bytes, which reject `null`). Omitted keys
 * resolve to `DEFAULT_RUN_LIMITS`.
 */
export interface RunLimits {
  readonly maxTurns?: number | null;
  readonly maxProviderAttempts?: number | null;
  readonly maxToolRounds?: number | null;
  readonly maxToolCalls?: number | null;
  /**
   * Stall axis (plan 239 Task 9): consecutive tool rounds that repeat one of the run's previous 8 rounds
   * exactly — the same set of `(name, argHash, resultHash)`. Default 5; the run fails when the count
   * reaches the cap. Any new argument or changed result resets the count. `null` disables it.
   */
  readonly maxRepeatedToolRounds?: number | null;
  readonly maxWallTimeMs?: number | null;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxInputTokens?: number | null;
  readonly maxOutputTokens?: number | null;
  readonly maxTotalTokens?: number | null;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
  /**
   * Clean cap on `run.end` continuations in one run (plan 145 Task 4; was `maxStopContinuations`).
   * Default 3; `0` observes `run.end` but never continues; `null` disables the cap. Layers narrow by
   * min like every other policy axis, and the cap ends the run with `stopReason: "hook_limit"`
   * (no limit breach).
   */
  readonly maxContinuations?: number | null;
  /**
   * Upper bound on one tool call's `execute`, in ms. Default `null` (no per-call cap). A tool's own
   * `timeoutMs` applies too and the smaller wins; layers narrow by min like every policy axis. An
   * expired call settles with `error.code: "tool_timeout"` and its `context.signal` is aborted. Not a
   * counter axis: it never ends the run.
   */
  readonly maxToolTimeMs?: number | null;
  /**
   * How long `session.close()` waits for background tasks before aborting the rest (plan 146 Task 7).
   * Default 5,000 ms; `0` aborts immediately. Agent-wide only: it applies to a session, not a run, so a
   * per-run value is ignored and it is not a counter axis.
   */
  readonly backgroundSettleMs?: number;
  /**
   * Hold every `message.delta` of a turn until the turn's usage has been charged (plan 228 Task 2).
   * Default `false`: deltas are delivered live whatever caps are set, and a turn that breaches a cap has
   * already shown its deltas before `turn.completed{error}` and `run.failed`. `true` at the agent or the
   * run layer wins, so no output of a breaching turn reaches a subscriber. Not a counter axis.
   */
  readonly bufferOutput?: boolean;
  /**
   * Byte bound on one saved durable run state: a suspension and a `run_checkpoint` entry (plan 239
   * Task 4). Default 262,144 (`DEFAULT_MAX_AGENT_RUN_STATE_BYTES`); at most `AgentConfig.ceilings.runStateBytes`.
   * Layers narrow by min; `null` is rejected. An oversize state fails the save. Not a counter axis.
   */
  readonly maxRunStateBytes?: number;
}

/** Fully resolved limits after `resolveRunLimits`: every policy axis is a finite cap or `null` (disabled). */
export interface ResolvedRunLimits {
  readonly maxTurns: number | null;
  readonly maxProviderAttempts: number | null;
  readonly maxToolRounds: number | null;
  readonly maxToolCalls: number | null;
  readonly maxRepeatedToolRounds: number | null;
  readonly maxWallTimeMs: number | null;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxTotalTokens: number | null;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
  /** `run.end` continuation cap; not a run-limit counter axis. */
  readonly maxContinuations: number | null;
  /** Per-call tool time cap; `null` when no layer sets one. Not a run-limit counter axis. */
  readonly maxToolTimeMs: number | null;
  /** Hold a turn's deltas until its usage is charged; `true` when either layer sets it. Not a counter axis. */
  readonly bufferOutput: boolean;
  /** Byte bound on one saved durable run state. Not a counter axis. */
  readonly maxRunStateBytes: number;
}

/** Counter-backed limit axes; `maxContinuations` caps a clean stop instead of a breach. */
export type RunLimitName = Exclude<
  keyof Required<RunLimits>,
  "maxContinuations" | "maxToolTimeMs" | "backgroundSettleMs" | "bufferOutput" | "maxRunStateBytes"
>;

export interface RunLimitCounters {
  readonly turns: number;
  readonly providerAttempts: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  /** Consecutive repeated tool rounds (the stall axis). Absent in counters saved before plan 239 Task 9. */
  readonly repeatedToolRounds?: number;
  readonly wallTimeMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
}

/** Session-wide limit axes (plan 239 Task 8). Each is optional and `null`-able; session narrows agent by `min`. */
export type SessionLimitName = "maxCost" | "maxTotalTokens" | "maxRuns" | "deadline";

/** Host-authored budget spanning every run of one session, persisted in the store across restarts. */
export interface SessionLimits {
  readonly maxCost?: { readonly amount: number; readonly currency: string } | null;
  readonly maxTotalTokens?: number | null;
  readonly maxRuns?: number | null;
  /** ISO 8601 instant after which new runs are refused and active runs fail on `deadline`. */
  readonly deadline?: string | null;
}

/** Resolved session limits: every axis is a finite cap/instant or `null` (disabled). */
export interface ResolvedSessionLimits {
  readonly maxCost: { readonly amount: number; readonly currency: string } | null;
  readonly maxTotalTokens: number | null;
  readonly maxRuns: number | null;
  readonly deadline: string | null;
}

/** Cumulative counters held for one session across runs. */
export interface SessionLimitCounters {
  readonly runs: number;
  readonly totalTokens: number;
  readonly cost: number;
  readonly currency?: string;
}

/** Remaining budget on each session-limit axis (`null` when the axis is unset or disabled). */
export interface SessionLimitRemaining {
  readonly runs: number | null;
  readonly totalTokens: number | null;
  readonly cost: number | null;
  readonly currency?: string;
  readonly deadlineMs: number | null;
}

/** Snapshot returned by `session.limits()`. */
export interface SessionLimitsStatus {
  readonly limits: ResolvedSessionLimits;
  readonly counters: SessionLimitCounters;
  readonly remaining: SessionLimitRemaining;
  readonly exhausted: boolean;
  readonly breach?: RunLimitBreach;
}

export interface RunLimitBreach {
  readonly limit: RunLimitName | SessionLimitName;
  /** Present on session-wide limit breaches (`"session"`); absent on per-run limits. */
  readonly scope?: "run" | "session";
  readonly maximum: number;
  readonly observed: number;
  readonly currency?: string;
}

/** One dispatched host tool call, bounded to id + name + argument hash (plan 087 T2). */
export interface ToolCallSummary {
  readonly id: string;
  readonly name: string;
  /** `sha256:<64 hex>` over the canonicalized arguments; raw arguments never enter events. */
  readonly argHash: string;
  /**
   * `sha256:<64 hex>` over the canonicalized result (content, value, error; never the call id), set once
   * the call's round settles (plan 239 Task 9). Absent for a call whose round did not settle.
   */
  readonly resultHash?: string;
}

/** One run-limit axis and how close it came to its cap: `used / cap` in [0, 1] (plan 087 T2). */
export interface BudgetAxisUsage {
  readonly axis: RunLimitName;
  readonly usedRatio: number;
}

/** Run counters at exhaustion (plan 087 T2): the axes a host reads first when attributing a death. */
export interface BudgetConsumedCounters {
  readonly turns: number;
  readonly inputTokens: number;
  readonly providerAttempts: number;
  readonly requestBytes: number;
}

export type GuardrailStage = "tool_input" | "tool_output";
/** Record stages also cover the retired input/output stages: frozen event payloads (`guardrail_decision`,
 *  `steer_rejected`) still carry records, and a `run.input` drop is recorded as an `input` block. */
export type GuardrailRecordStage = GuardrailStage | "input" | "output";
export type GuardrailAction = "allow" | "block" | "tripwire" | "interrupt";

export type GuardrailValue<S extends GuardrailStage> = S extends "tool_input" ? ToolCallContent : ToolResult;

export interface GuardrailContext<S extends GuardrailStage> {
  readonly stage: S;
  readonly value: GuardrailValue<S>;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface GuardrailDecision {
  readonly action: GuardrailAction;
  readonly reason?: string;
  /** Public data only; Prism JSON-normalizes, bounds, and redacts it before emission. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Guardrail<S extends GuardrailStage = GuardrailStage> {
  readonly name: string;
  readonly stage: S;
  /** Host-authored stable identity for durable definitions; unused by ordinary runs. */
  readonly revision?: string;
  evaluate(context: GuardrailContext<S>): GuardrailDecision | Promise<GuardrailDecision>;
}

export interface GuardrailRecord {
  readonly guardrail: string;
  readonly stage: GuardrailRecordStage;
  readonly action: GuardrailAction;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
