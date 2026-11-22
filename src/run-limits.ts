import { DEFAULT_MAX_AGENT_RUN_STATE_BYTES, HARD_MAX_AGENT_RUN_STATE_BYTES } from "./agent-run-state.js";
import {
  DEFAULT_MAX_PENDING_STEER_BYTES,
  DEFAULT_MAX_PENDING_STEERS,
  DEFAULT_MAX_STICKY_DECISIONS,
  HARD_MAX_PENDING_DECISIONS,
  HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
  SESSION_LIMITS_ENTRY_SCHEMA_VERSION,
  SessionLimitError,
  SessionLimitsUnreadableError,
} from "./contracts.js";
import type {
  AgentCeilings,
  BudgetAxisUsage,
  BudgetConsumedCounters,
  ResolvedRunLimits,
  ResolvedSessionLimits,
  RunLimitBreach,
  RunLimitCounters,
  ResolvedAgentCeilings,
  RunLimitName,
  RunLimits,
  SessionEntry,
  SessionLimitName,
  SessionLimits,
  SessionLimitsEntryData,
  SessionLimitsStatus,
  ToolCallSummary,
  Usage,
} from "./contracts.js";
import { DEFAULT_MAX_BRANCH_PAGES } from "./session-stores.js";
import { MAX_EXTERNAL_STATE_BYTES, MAX_EXTERNAL_STATE_ENTRIES } from "./session/external-state.js";
import { MAX_STATE_LOG_ENTRIES, MAX_STATE_VALUE_BYTES } from "./session/state.js";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES } from "./skill-disclosure.js";
import { MAX_TOOL_CONCURRENCY } from "./tools.js";

/**
 * The unconfigured fence (plan 229 Task 2): sized so an ordinary agent task finishes, while a runaway
 * loop still ends on turns, tool rounds, tool calls, or wall time. The token axes are off by default:
 * `inputTokens` counts cache reads in full, so a cumulative cap grows with turn count rather than spend.
 * Hosts bound spend with `maxCost` or by setting a token axis.
 */
export const DEFAULT_RUN_LIMITS: Readonly<{
  maxTurns: number;
  maxProviderAttempts: number;
  maxToolRounds: number;
  maxToolCalls: number;
  maxRepeatedToolRounds: number;
  maxWallTimeMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxTotalTokens: number | null;
}> = Object.freeze({
  maxTurns: 50,
  maxProviderAttempts: 75,
  // One below `maxTurns`: a runaway tool loop ends with the clean `turn_limit` stop on turn 50 (its
  // calls settled), not a `maxTurns` breach on turn 51.
  maxToolRounds: 49,
  maxToolCalls: 200,
  // The stall axis (plan 239 Task 9): five rounds in a row that repeat a recent round, results included.
  maxRepeatedToolRounds: 5,
  maxWallTimeMs: 900_000,
  maxRequestBytes: 8 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxTotalTokens: null,
});

/** `run.end` continuation cap when no layer configures one. Not a counter axis. */
const DEFAULT_MAX_CONTINUATIONS = 3;

/** How long `session.close()` waits for background tasks when no limit configures it. */
export const DEFAULT_BACKGROUND_SETTLE_MS = 5_000;

/**
 * Bounded settle for `session.close()` (plan 146 Task 7): the agent-wide `backgroundSettleMs`, validated
 * as a non-negative safe integer. A per-run layer cannot set it, since a session outlives a run.
 */
export function resolveBackgroundSettleMs(agent?: RunLimits): number {
  const value = agent?.backgroundSettleMs;
  if (value === undefined) return DEFAULT_BACKGROUND_SETTLE_MS;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("backgroundSettleMs must be a non-negative safe integer");
  return value;
}

/**
 * Process-safety ceilings that exist so a bug cannot OOM the host via JSON.parse of giant
 * provider frames. Product axes (turns, wall time, tokens, …) have no hard cap: hosts set
 * them per workload, and `null` explicitly disables an axis.
 */
export const HARD_RUN_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
});

const CEILING_NAMES = [
  "maxRequestBytes",
  "maxResponseBytes",
  "runStateBytes",
  "pendingDecisions",
  "stickyDecisions",
  "pendingSteers",
  "pendingSteerBytes",
  "snapshotCacheTtlMs",
  "skillInstructionBytes",
  "stateValueBytes",
  "stateLogEntries",
  "externalStateEntries",
  "externalStateBytes",
  "branchReadPages",
  "toolConcurrency",
] as const satisfies readonly (keyof AgentCeilings)[];

/** The shipped ceilings, read at call time so module order never matters. */
function defaultCeilings(): ResolvedAgentCeilings {
  return {
    maxRequestBytes: HARD_RUN_LIMITS.maxRequestBytes,
    maxResponseBytes: HARD_RUN_LIMITS.maxResponseBytes,
    runStateBytes: HARD_MAX_AGENT_RUN_STATE_BYTES,
    pendingDecisions: HARD_MAX_PENDING_DECISIONS,
    stickyDecisions: DEFAULT_MAX_STICKY_DECISIONS,
    pendingSteers: DEFAULT_MAX_PENDING_STEERS,
    pendingSteerBytes: DEFAULT_MAX_PENDING_STEER_BYTES,
    snapshotCacheTtlMs: HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
    skillInstructionBytes: HARD_MAX_SKILL_INSTRUCTION_BYTES,
    stateValueBytes: MAX_STATE_VALUE_BYTES,
    stateLogEntries: MAX_STATE_LOG_ENTRIES,
    externalStateEntries: MAX_EXTERNAL_STATE_ENTRIES,
    externalStateBytes: MAX_EXTERNAL_STATE_BYTES,
    branchReadPages: DEFAULT_MAX_BRANCH_PAGES,
    toolConcurrency: MAX_TOOL_CONCURRENCY,
  };
}

let shippedCeilings: Readonly<ResolvedAgentCeilings> | undefined;

/**
 * Resolve `AgentConfig.ceilings` (plan 239 Task 4): each key a positive safe integer, omitted keys at the
 * shipped default. An unknown key, `null`, or a non-integer throws `TypeError` naming the ceiling. The result
 * is frozen; `createAgent` resolves it once and binds it to the agent, so nothing after creation can raise it.
 */
export function resolveCeilings(ceilings?: AgentCeilings): Readonly<ResolvedAgentCeilings> {
  if (ceilings === undefined) {
    shippedCeilings ??= Object.freeze(defaultCeilings());
    return shippedCeilings;
  }
  if (!ceilings || typeof ceilings !== "object" || Array.isArray(ceilings)) throw new TypeError("ceilings must be an object");
  const known = new Set<string>(CEILING_NAMES);
  for (const key of Object.keys(ceilings)) {
    if (!known.has(key)) throw new TypeError(`ceilings.${key} is not a ceiling; known: ${CEILING_NAMES.join(", ")}`);
  }
  const resolved = defaultCeilings() as { -readonly [K in keyof ResolvedAgentCeilings]: number };
  for (const name of CEILING_NAMES) {
    const value = (ceilings as Record<string, unknown>)[name];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`ceilings.${name} must be a positive safe integer`);
    }
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}

const boundCeilings = new WeakMap<object, Readonly<ResolvedAgentCeilings>>();

/** Kernel-internal: bind an agent's resolved ceilings once, at `createAgent`. */
export function bindAgentCeilings(agent: object, ceilings: Readonly<ResolvedAgentCeilings>): void {
  boundCeilings.set(agent, ceilings);
}

/**
 * Kernel-internal: the ceilings bound to `agent` at `createAgent`. An agent-like object built outside
 * `createAgent` (a test double) resolves its own `config.ceilings` once.
 */
export function ceilingsOf(
  agent: { readonly config?: { readonly ceilings?: AgentCeilings } } | undefined,
): Readonly<ResolvedAgentCeilings> {
  if (!agent) return resolveCeilings();
  let bound = boundCeilings.get(agent);
  if (!bound) {
    bound = resolveCeilings(agent.config?.ceilings);
    boundCeilings.set(agent, bound);
  }
  return bound;
}

type ByteLimit = keyof typeof HARD_RUN_LIMITS;
/** Policy axes: finite cap or `null` (disabled). Never process-integrity-critical. */
type PolicyLimit = Exclude<IntegerLimit, ByteLimit>;
type IntegerLimit = keyof typeof DEFAULT_RUN_LIMITS;
const LIMIT_NAMES = Object.keys(DEFAULT_RUN_LIMITS) as IntegerLimit[];
const POLICY_NAMES: readonly PolicyLimit[] = LIMIT_NAMES.filter(
  (name) => name !== "maxRequestBytes" && name !== "maxResponseBytes",
) as PolicyLimit[];
const COUNTER_FOR: Record<RunLimitName, keyof RunLimitCounters> = {
  maxTurns: "turns",
  maxProviderAttempts: "providerAttempts",
  maxToolRounds: "toolRounds",
  maxToolCalls: "toolCalls",
  maxRepeatedToolRounds: "repeatedToolRounds",
  maxWallTimeMs: "wallTimeMs",
  maxRequestBytes: "requestBytes",
  maxResponseBytes: "responseBytes",
  maxInputTokens: "inputTokens",
  maxOutputTokens: "outputTokens",
  maxTotalTokens: "totalTokens",
  maxCost: "cost",
};

export class RunLimitError extends Error {
  readonly code = "ERR_PRISM_RUN_LIMIT";
  constructor(readonly breach: RunLimitBreach) {
    super(`Run limit exceeded: ${breach.limit}`);
    this.name = "RunLimitError";
  }
}

export interface RunLimitTrackerOptions {
  readonly onExceeded?: (breach: RunLimitBreach) => void;
  /** Durable resumption restores cumulative counters and original wall deadline. */
  readonly snapshot?: RunLimitCounters;
  readonly deadlineAt?: string;
  /** Internal scope (`"run"` default; `"session"` stamps `breach.scope = "session"`). */
  readonly scope?: "run" | "session";
  /** Session-level wall deadline (ISO 8601 instant); arms the timer at `min(maxWallTimeMs, deadline - now)`. */
  readonly sessionDeadlineAt?: string;
  /** Session-scoped tracker to mirror usage charges into (plan 239 Task 8). */
  readonly session?: RunLimitTracker;
  /** Durable resumption restores the stall window: the run's most recent tool-round digests, oldest first. */
  readonly toolRoundDigests?: readonly string[];
}

/** How many previous tool rounds a round is compared with for the stall axis (plan 239 Task 9). */
export const STALL_WINDOW_SIZE = 8;
const ROUND_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Fail-closed check of a persisted stall window: at most {@link STALL_WINDOW_SIZE} `sha256:` digests. */
export function isToolRoundDigestWindow(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= STALL_WINDOW_SIZE &&
    value.every((digest) => typeof digest === "string" && ROUND_DIGEST_PATTERN.test(digest))
  );
}

/** `null` means "no cap" and behaves as +Infinity when narrowing against a finite layer. */
function minCap(a: number | null | undefined, b: number | null | undefined): number | null | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** Validate one host-authored layer. Defaults are applied only after inheritance is resolved. */
export function resolveRunLimits(
  agent?: RunLimits,
  run?: RunLimits,
  ceilings: Readonly<ResolvedAgentCeilings> = resolveCeilings(),
): Readonly<ResolvedRunLimits> {
  const base = agent ? validateLimits(agent, ceilings) : undefined;
  const override = run ? validateLimits(run, ceilings) : undefined;
  const resolved = { ...DEFAULT_RUN_LIMITS } as Record<IntegerLimit, number | null>;
  // A host that lowers a byte ceiling below the shipped default lowers the default with it.
  resolved.maxRequestBytes = Math.min(DEFAULT_RUN_LIMITS.maxRequestBytes, ceilings.maxRequestBytes);
  resolved.maxResponseBytes = Math.min(DEFAULT_RUN_LIMITS.maxResponseBytes, ceilings.maxResponseBytes);
  for (const name of POLICY_NAMES) {
    const narrowed = minCap(base?.[name], override?.[name]);
    resolved[name] = narrowed !== undefined ? narrowed : DEFAULT_RUN_LIMITS[name];
  }
  for (const name of ["maxRequestBytes", "maxResponseBytes"] as const) {
    const baseVal = base?.[name];
    const overrideVal = override?.[name];
    if (baseVal !== undefined && overrideVal !== undefined) {
      resolved[name] = Math.min(baseVal, overrideVal);
    } else if (baseVal !== undefined) {
      resolved[name] = baseVal;
    } else if (overrideVal !== undefined) {
      resolved[name] = overrideVal;
    }
  }
  // A raised/disabled maxTurns must not be silently undercut by the attempts default:
  // generate-then-tool-loop needs at least one attempt per turn (plus retries).
  if (base?.maxProviderAttempts === undefined && override?.maxProviderAttempts === undefined) {
    const turns = resolved.maxTurns;
    resolved.maxProviderAttempts = turns === null ? null : Math.max(DEFAULT_RUN_LIMITS.maxProviderAttempts, turns);
  } else {
    const attempts = resolved.maxProviderAttempts;
    const turns = resolved.maxTurns;
    if (attempts !== null && turns !== null && attempts < turns) resolved.maxProviderAttempts = turns;
  }
  const maxCost = override?.maxCost ?? base?.maxCost;
  // `run.end` continuation cap: no counters-table row — the loop turns it into a
  // clean `hook_limit` stop, not a breach — so it resolves outside the counter-backed axes and
  // keeps the same narrowing-only law (min, `null` = uncapped).
  const continuations = minCap(base?.maxContinuations, override?.maxContinuations);
  // Per-call tool time: same shape and same narrowing, default uncapped. A tool's own `timeoutMs` is
  // clamped to it at dispatch.
  const toolTime = minCap(base?.maxToolTimeMs, override?.maxToolTimeMs);
  const stateBytes = minCap(base?.maxRunStateBytes, override?.maxRunStateBytes);
  return Object.freeze({
    ...resolved,
    maxRunStateBytes: stateBytes ?? Math.min(DEFAULT_MAX_AGENT_RUN_STATE_BYTES, ceilings.runStateBytes),
    maxContinuations: continuations !== undefined ? continuations : DEFAULT_MAX_CONTINUATIONS,
    maxToolTimeMs: toolTime ?? null,
    // Delivery mode, not a cap: `true` at either layer wins (a run cannot unbuffer an agent that buffers).
    bufferOutput: base?.bufferOutput === true || override?.bufferOutput === true,
    ...(maxCost
      ? {
          maxCost:
            base?.maxCost && override?.maxCost
              ? {
                  amount: Math.min(base.maxCost.amount, override.maxCost.amount),
                  currency: base.maxCost.currency === override.maxCost.currency ? base.maxCost.currency : failCurrency(),
                }
              : maxCost,
        }
      : {}),
  }) as Readonly<ResolvedRunLimits>;
}

function failCurrency(): never {
  throw new TypeError("Run limit currencies must match when narrowed");
}

function validateLimits(input: RunLimits, ceilings: Readonly<ResolvedAgentCeilings>): RunLimits {
  for (const name of LIMIT_NAMES) {
    const value = input[name];
    if (value === undefined) continue;
    if (name === "maxRequestBytes" || name === "maxResponseBytes") {
      // Process-safety axes: a giant frame cannot be host-approved away, so `null` is rejected. The bound is
      // the agent's ceiling, which only the host sets (plan 239 Task 4).
      if (value === null || !Number.isSafeInteger(value) || value < 1 || value > ceilings[name])
        throw new TypeError(`${name} must be a positive safe integer at most ceilings.${name} (${ceilings[name]})`);
      continue;
    }
    if (value === null) continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer or null to disable`);
  }
  if (input.maxCost) {
    const { amount, currency } = input.maxCost;
    if (!Number.isFinite(amount) || amount < 0 || !currency.trim())
      throw new TypeError("maxCost requires a finite non-negative amount and currency");
  }
  resolveBackgroundSettleMs(input);
  const continuations = input.maxContinuations;
  if (continuations !== undefined && continuations !== null && (!Number.isSafeInteger(continuations) || continuations < 0)) {
    throw new TypeError("maxContinuations must be a non-negative safe integer or null to disable the cap");
  }
  const toolTime = input.maxToolTimeMs;
  if (toolTime !== undefined && toolTime !== null && (!Number.isSafeInteger(toolTime) || toolTime < 1)) {
    throw new TypeError("maxToolTimeMs must be a positive safe integer or null to disable the cap");
  }
  const stateBytes = input.maxRunStateBytes;
  if (stateBytes !== undefined && (!Number.isSafeInteger(stateBytes) || stateBytes < 1 || stateBytes > ceilings.runStateBytes)) {
    throw new TypeError(`maxRunStateBytes must be a positive safe integer at most ceilings.runStateBytes (${ceilings.runStateBytes})`);
  }
  if (input.bufferOutput !== undefined && typeof input.bufferOutput !== "boolean") {
    throw new TypeError("bufferOutput must be a boolean");
  }
  return input;
}

export class RunLimitTracker {
  readonly limits: Readonly<ResolvedRunLimits>;
  private readonly startedAt = performance.now();
  /** Wall deadline ISO string; absent when the run has no wall limit. */
  readonly deadlineAt: string | undefined;
  private readonly counters: Record<keyof RunLimitCounters, number>;
  private timer?: ReturnType<typeof setTimeout>;
  private exceeded?: RunLimitBreach;
  private costCurrency?: string;
  /** The stall window: digests of the run's last {@link STALL_WINDOW_SIZE} settled tool rounds, oldest first. */
  private readonly roundDigests: string[] = [];

  constructor(
    limits: Readonly<ResolvedRunLimits>,
    private readonly options: RunLimitTrackerOptions = {},
  ) {
    this.limits = limits;
    this.counters = {
      turns: 0,
      providerAttempts: 0,
      toolRounds: 0,
      toolCalls: 0,
      repeatedToolRounds: 0,
      wallTimeMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      ...options.snapshot,
    };
    if (options.toolRoundDigests !== undefined) {
      if (!isToolRoundDigestWindow(options.toolRoundDigests)) throw new TypeError("Run limit tool-round window is malformed");
      this.roundDigests.push(...options.toolRoundDigests);
    }
    for (const [key, value] of Object.entries(this.counters)) {
      if (!Number.isFinite(value) || value < 0 || (key !== "cost" && !Number.isSafeInteger(value))) {
        throw new TypeError("Run limit snapshot must contain finite non-negative counters");
      }
    }
    // A restored durable deadline wins even when the wall limit is now disabled (never drop an existing wall).
    const runDeadline = options.deadlineAt
      ? Date.parse(options.deadlineAt)
      : limits.maxWallTimeMs === null
        ? undefined
        : Date.now() + limits.maxWallTimeMs;
    if (runDeadline !== undefined && !Number.isFinite(runDeadline)) throw new TypeError("Run limit deadlineAt is invalid");
    this.deadlineAt = runDeadline === undefined ? undefined : new Date(runDeadline).toISOString();

    const sessionDeadline = options.sessionDeadlineAt ? Date.parse(options.sessionDeadlineAt) : undefined;
    if (sessionDeadline !== undefined && !Number.isFinite(sessionDeadline)) {
      throw new TypeError("Session limit deadline is invalid");
    }
    const isSessionDeadline = sessionDeadline !== undefined && (runDeadline === undefined || sessionDeadline <= runDeadline);
    const effectiveDeadline = isSessionDeadline ? sessionDeadline : runDeadline;

    if (effectiveDeadline !== undefined) {
      const remaining = Math.max(0, effectiveDeadline - Date.now());
      // Node clamps setTimeout delays above 2^31-1 (~24.8 days) to 1ms, which would breach early;
      // arm capped and re-check the real clock before exceeding.
      const fire = (): void => {
        if (isSessionDeadline) this.exceedSessionDeadline(sessionDeadline!);
        else this.exceed("maxWallTimeMs", limits.maxWallTimeMs ?? 0);
      };
      const arm = (delay: number): void => {
        this.timer = setTimeout(() => {
          const left = effectiveDeadline - Date.now();
          if (left > 0) arm(Math.min(left, 2_147_483_647));
          else fire();
        }, delay);
        this.timer.unref?.();
      };
      arm(Math.min(remaining, 2_147_483_647));
      if (remaining === 0) fire();
    }
  }

  get breach(): RunLimitBreach | undefined {
    return this.exceeded ?? this.options.session?.breach;
  }
  get currency(): string | undefined {
    return this.costCurrency;
  }
  snapshot(): RunLimitCounters {
    const elapsed = Math.ceil(performance.now() - this.startedAt);
    return {
      ...this.counters,
      wallTimeMs: this.limits.maxWallTimeMs === null ? elapsed : Math.min(this.limits.maxWallTimeMs, elapsed),
    };
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The stall window to persist with the run's counters (a copy). */
  get toolRoundDigests(): readonly string[] {
    return [...this.roundDigests];
  }

  /**
   * Charge the stall axis with one settled tool round (plan 239 Task 9). `digest` is the round's
   * `sha256:` digest over its sorted `(name, argHash, resultHash)` set. A digest equal to one of the
   * previous {@link STALL_WINDOW_SIZE} rounds extends the consecutive-repeat count, any other resets it;
   * the run breaches `maxRepeatedToolRounds` when the count reaches the cap.
   */
  recordToolRound(digest: string): void {
    if (!ROUND_DIGEST_PATTERN.test(digest)) throw new TypeError("Tool-round digest must be sha256:<64 hex>");
    const repeated = this.roundDigests.includes(digest);
    this.roundDigests.push(digest);
    if (this.roundDigests.length > STALL_WINDOW_SIZE) this.roundDigests.shift();
    const observed = repeated ? (this.counters.repeatedToolRounds ?? 0) + 1 : 0;
    this.counters.repeatedToolRounds = observed;
    const cap = this.limits.maxRepeatedToolRounds;
    if (cap !== null && observed >= cap) this.exceed("maxRepeatedToolRounds", observed);
  }

  charge(limit: Exclude<RunLimitName, "maxCost" | "maxRepeatedToolRounds">, delta = 1): void {
    if (!Number.isSafeInteger(delta) || delta < 0) throw new TypeError("Run limit delta must be a non-negative safe integer");
    const counter = COUNTER_FOR[limit];
    const observed = this.counters[counter] + delta;
    if (!Number.isSafeInteger(observed)) this.exceed(limit, Number.MAX_SAFE_INTEGER + 1);
    this.counters[counter] = observed;
    const cap = this.limits[limit];
    if (cap === null) return;
    // Byte caps are per-frame (HARD exists so one giant provider frame cannot OOM the host),
    // not run-lifetime sums; every other axis stays cumulative.
    const against = limit === "maxRequestBytes" || limit === "maxResponseBytes" ? delta : observed;
    if (against > cap) this.exceed(limit, against);
  }

  recordUsage(usage: Usage | undefined): void {
    let ownError: unknown;
    try {
      this.recordOwnUsage(usage);
    } catch (error) {
      ownError = error;
    }
    if (this.options.session) {
      if (ownError !== undefined) {
        try {
          this.options.session.recordUsage(usage);
        } catch {
          // Run-level breach already won; still keep session counters updated for the usage consumed.
        }
        throw ownError;
      }
      this.options.session.recordUsage(usage);
    } else if (ownError !== undefined) {
      throw ownError;
    }
  }

  private recordOwnUsage(usage: Usage | undefined): void {
    if (!usage) {
      if (this.limits.maxCost) this.exceed("maxCost", Number.POSITIVE_INFINITY);
      return;
    }
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
      const value = usage[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        throw new TypeError(`Provider usage ${key} must be a non-negative safe integer`);
    }
    const total = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (!Number.isSafeInteger(total)) throw new TypeError("Provider usage totalTokens is invalid");
    this.charge("maxInputTokens", usage.inputTokens ?? 0);
    this.charge("maxOutputTokens", usage.outputTokens ?? 0);
    this.charge("maxTotalTokens", total);
    if (usage.cost !== undefined && (!Number.isFinite(usage.cost) || usage.cost < 0))
      throw new TypeError("Provider usage cost must be finite and non-negative");
    if (!this.limits.maxCost) {
      if (usage.cost !== undefined) {
        this.counters.cost += usage.cost;
        if (usage.currency !== undefined) this.costCurrency ??= usage.currency;
      }
      return;
    }
    if (usage.cost === undefined || usage.currency !== this.limits.maxCost.currency) this.exceed("maxCost", Number.POSITIVE_INFINITY);
    this.costCurrency ??= usage.currency;
    const observed = this.counters.cost + usage.cost!;
    this.counters.cost = observed;
    if (observed > this.limits.maxCost.amount) this.exceed("maxCost", observed);
  }

  private exceedSessionDeadline(deadlineMs: number): void {
    if (!this.exceeded) {
      this.exceeded = {
        limit: "deadline",
        scope: "session",
        maximum: deadlineMs,
        observed: Date.now(),
      };
      this.options.onExceeded?.(this.exceeded);
    }
  }

  private exceed(limit: RunLimitName, observed: number): never | undefined {
    if (!this.exceeded) {
      const maximum = limit === "maxCost" ? (this.limits.maxCost?.amount ?? 0) : (this.limits[limit] ?? 0);
      this.exceeded = {
        limit,
        ...(this.options.scope === "session" ? { scope: "session" as const } : {}),
        maximum,
        observed,
        ...(limit === "maxCost" && this.limits.maxCost ? { currency: this.limits.maxCost.currency } : {}),
      };
      this.options.onExceeded?.(this.exceeded);
    }
    if (limit !== "maxWallTimeMs") throw new RunLimitError(this.exceeded);
  }
}

export function createRunLimitTracker(limits: RunLimits | undefined, options?: RunLimitTrackerOptions): RunLimitTracker {
  return new RunLimitTracker(resolveRunLimits(undefined, limits), options);
}

/** Product axes reported as "how close was everything else" (plan 087 T2). Request/response bytes
 *  stay out: their caps are per-frame, so a run-lifetime ratio would be meaningless. */
const ATTRIBUTION_AXES: readonly { readonly axis: RunLimitName; readonly counter: keyof RunLimitCounters }[] = [
  { axis: "maxTurns", counter: "turns" },
  { axis: "maxProviderAttempts", counter: "providerAttempts" },
  { axis: "maxToolRounds", counter: "toolRounds" },
  { axis: "maxToolCalls", counter: "toolCalls" },
  { axis: "maxWallTimeMs", counter: "wallTimeMs" },
  { axis: "maxInputTokens", counter: "inputTokens" },
  { axis: "maxOutputTokens", counter: "outputTokens" },
  { axis: "maxTotalTokens", counter: "totalTokens" },
  { axis: "maxCost", counter: "cost" },
];
const CLOSEST_AXIS_COUNT = 3;

function axisCap(limits: Readonly<ResolvedRunLimits>, axis: RunLimitName): number | null | undefined {
  if (axis === "maxCost") return limits.maxCost?.amount;
  const value = limits[axis];
  return typeof value === "number" ? value : null;
}

/**
 * Attribution carried by a limit death (plan 087 T2, plan 108 T5): the `budget_exhausted` payload
 * without `limit`, which `RunResult.limit` / `child_failed.limit` already carry.
 */
export interface BudgetExhaustionAttribution {
  readonly consumed: BudgetConsumedCounters;
  readonly closestOtherAxes: readonly BudgetAxisUsage[];
  readonly recentToolCalls: readonly ToolCallSummary[];
}

/**
 * Build the `budget_exhausted` payload (plan 087 T2): which axis fired, the counters a host reads
 * first, the closest other axes, and the last dispatched tool calls (hashes only).
 */
export function describeBudgetExhaustion(
  tracker: RunLimitTracker,
  breach: RunLimitBreach,
  recentToolCalls: readonly ToolCallSummary[],
): BudgetExhaustionAttribution & { readonly limit: RunLimitName | SessionLimitName } {
  const counters = tracker.snapshot();
  const closestOtherAxes = ATTRIBUTION_AXES.filter(({ axis }) => axis !== breach.limit)
    .flatMap(({ axis, counter }) => {
      const cap = axisCap(tracker.limits, axis);
      return typeof cap === "number" && cap > 0 ? [{ axis, cap, used: counters[counter] ?? 0 }] : [];
    })
    .map(({ axis, cap, used }) => ({ axis, usedRatio: Math.round(Math.min(1, used / cap) * 10_000) / 10_000 }))
    .sort((a, b) => b.usedRatio - a.usedRatio)
    .slice(0, CLOSEST_AXIS_COUNT);
  return {
    limit: breach.limit,
    consumed: {
      turns: counters.turns,
      inputTokens: counters.inputTokens,
      providerAttempts: counters.providerAttempts,
      requestBytes: counters.requestBytes,
    },
    closestOtherAxes,
    recentToolCalls: [...recentToolCalls],
  };
}

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const SESSION_LIMIT_KEYS: readonly (keyof SessionLimits)[] = ["maxCost", "maxTotalTokens", "maxRuns", "deadline"];

function validateSessionLimits(input: SessionLimits): SessionLimits {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Session limits must be an object");
  }
  const known = new Set<string>(SESSION_LIMIT_KEYS);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new TypeError(`Unknown session limit "${key}"`);
  }
  for (const key of ["maxTotalTokens", "maxRuns"] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${key} must be a positive safe integer or null to disable`);
    }
  }
  if (input.maxCost !== undefined && input.maxCost !== null) {
    const cost = input.maxCost;
    if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
      throw new TypeError("maxCost must be { amount, currency } or null");
    }
    if (
      typeof cost.amount !== "number" ||
      !Number.isFinite(cost.amount) ||
      cost.amount < 0 ||
      typeof cost.currency !== "string" ||
      !cost.currency.trim()
    ) {
      throw new TypeError("maxCost requires a finite non-negative amount and currency");
    }
  }
  if (input.deadline !== undefined && input.deadline !== null) {
    const deadline = input.deadline;
    if (typeof deadline !== "string" || !ISO_INSTANT_PATTERN.test(deadline) || !Number.isFinite(Date.parse(deadline))) {
      throw new TypeError("deadline must be an ISO 8601 instant string or null");
    }
  }
  return input;
}

/** Validate and narrow `AgentConfig.sessionLimits` and `SessionOptions.limits` by `min` (`null` = uncapped). */
export function resolveSessionLimits(agent?: SessionLimits, session?: SessionLimits): Readonly<ResolvedSessionLimits> {
  const base = agent ? validateSessionLimits(agent) : undefined;
  const override = session ? validateSessionLimits(session) : undefined;
  const maxTotalTokens = minCap(base?.maxTotalTokens, override?.maxTotalTokens) ?? null;
  const maxRuns = minCap(base?.maxRuns, override?.maxRuns) ?? null;
  let maxCost: ResolvedSessionLimits["maxCost"] = null;
  if (base?.maxCost && override?.maxCost) {
    if (base.maxCost.currency !== override.maxCost.currency) {
      throw new TypeError("Session limit currencies must match when narrowed");
    }
    maxCost = Object.freeze({
      amount: Math.min(base.maxCost.amount, override.maxCost.amount),
      currency: base.maxCost.currency,
    });
  } else if (base?.maxCost) {
    maxCost = Object.freeze({ amount: base.maxCost.amount, currency: base.maxCost.currency });
  } else if (override?.maxCost) {
    maxCost = Object.freeze({ amount: override.maxCost.amount, currency: override.maxCost.currency });
  }
  let deadline: string | null = null;
  if (base?.deadline && override?.deadline) {
    const baseMs = Date.parse(base.deadline);
    const overMs = Date.parse(override.deadline);
    deadline = new Date(Math.min(baseMs, overMs)).toISOString();
  } else if (base?.deadline) {
    deadline = new Date(Date.parse(base.deadline)).toISOString();
  } else if (override?.deadline) {
    deadline = new Date(Date.parse(override.deadline)).toISOString();
  }
  return Object.freeze({ maxCost, maxTotalTokens, maxRuns, deadline });
}

export function hasConfiguredSessionLimits(limits: ResolvedSessionLimits): boolean {
  return limits.maxCost !== null || limits.maxTotalTokens !== null || limits.maxRuns !== null || limits.deadline !== null;
}

/** Fail-closed parse of `session_limits` entry data (plan 239 Task 8). */
export function parseSessionLimitsData(value: unknown): SessionLimitsEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionLimitsUnreadableError("Malformed session_limits entry: expected object data");
  }
  const data = value as Partial<SessionLimitsEntryData>;
  if (data.schemaVersion !== SESSION_LIMITS_ENTRY_SCHEMA_VERSION) {
    throw new SessionLimitsUnreadableError(`Unsupported session_limits schemaVersion ${String(data.schemaVersion)}`);
  }
  if (typeof data.runs !== "number" || !Number.isSafeInteger(data.runs) || data.runs < 0) {
    throw new SessionLimitsUnreadableError("Malformed session_limits entry: invalid runs");
  }
  if (typeof data.totalTokens !== "number" || !Number.isSafeInteger(data.totalTokens) || data.totalTokens < 0) {
    throw new SessionLimitsUnreadableError("Malformed session_limits entry: invalid totalTokens");
  }
  if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0) {
    throw new SessionLimitsUnreadableError("Malformed session_limits entry: invalid cost");
  }
  if (data.currency !== undefined && (typeof data.currency !== "string" || !data.currency.trim())) {
    throw new SessionLimitsUnreadableError("Malformed session_limits entry: invalid currency");
  }
  return {
    schemaVersion: SESSION_LIMITS_ENTRY_SCHEMA_VERSION,
    runs: data.runs,
    totalTokens: data.totalTokens,
    cost: data.cost,
    ...(data.currency !== undefined ? { currency: data.currency } : {}),
  };
}

export function parseSessionLimitsEntry(entry: SessionEntry): SessionLimitsEntryData {
  if (entry.kind !== "session_limits") throw new SessionLimitsUnreadableError("Not a session_limits session entry");
  return parseSessionLimitsData(entry.data);
}

/** Restore the newest valid session-limit counters from branch entries; any malformed `session_limits` fails closed. */
export function restoreSessionLimitsFromEntries(entries: readonly SessionEntry[]): SessionLimitsEntryData | undefined {
  let latest: SessionLimitsEntryData | undefined;
  for (const entry of entries) {
    if (entry.kind === "session_limits") {
      latest = parseSessionLimitsEntry(entry);
    } else if (entry.kind === "run_checkpoint" && entry.data && typeof entry.data === "object") {
      const raw = (entry.data as { readonly sessionLimits?: unknown }).sessionLimits;
      if (raw !== undefined) latest = parseSessionLimitsData(raw);
    } else if (entry.kind === "suspended_run" && entry.data && typeof entry.data === "object") {
      const raw = (entry.data as { readonly state?: { readonly sessionLimits?: unknown } }).state?.sessionLimits;
      if (raw !== undefined) latest = parseSessionLimitsData(raw);
    }
  }
  return latest;
}

const ZERO_COUNTERS: RunLimitCounters = Object.freeze({
  turns: 0,
  providerAttempts: 0,
  toolRounds: 0,
  toolCalls: 0,
  repeatedToolRounds: 0,
  wallTimeMs: 0,
  requestBytes: 0,
  responseBytes: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
});

function roundRemainingCost(value: number): number {
  return Math.max(0, Math.round(value * 1e12) / 1e12);
}

/**
 * Session-scoped budget tracker backed by `RunLimitTracker` (plan 239 Task 8).
 * Uses `RunLimitTracker` for all token and cost accounting so there is only one accounting path.
 */
export class SessionLimitTracker {
  readonly limits: Readonly<ResolvedSessionLimits>;
  private tracker: RunLimitTracker;
  private runsCount = 0;
  private currency: string | undefined;
  private activeOnExceeded?: (breach: RunLimitBreach) => void;

  constructor(limits: Readonly<ResolvedSessionLimits>, initial?: SessionLimitsEntryData) {
    this.limits = limits;
    this.tracker = this.buildTracker(initial);
    if (initial) this.restore(initial);
    else this.currency = limits.maxCost?.currency;
  }

  private buildTracker(initial?: SessionLimitsEntryData): RunLimitTracker {
    const resolved: Readonly<ResolvedRunLimits> = Object.freeze({
      maxTurns: null,
      maxProviderAttempts: null,
      maxToolRounds: null,
      maxToolCalls: null,
      maxRepeatedToolRounds: null,
      maxWallTimeMs: null,
      maxRequestBytes: Number.MAX_SAFE_INTEGER,
      maxResponseBytes: Number.MAX_SAFE_INTEGER,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxTotalTokens: this.limits.maxTotalTokens,
      ...(this.limits.maxCost ? { maxCost: this.limits.maxCost } : {}),
      maxContinuations: null,
      maxToolTimeMs: null,
      bufferOutput: false,
      maxRunStateBytes: DEFAULT_MAX_AGENT_RUN_STATE_BYTES,
    });
    return new RunLimitTracker(resolved, {
      scope: "session",
      snapshot: {
        ...ZERO_COUNTERS,
        totalTokens: initial?.totalTokens ?? 0,
        cost: initial?.cost ?? 0,
      },
      onExceeded: (breach) => this.activeOnExceeded?.(breach),
    });
  }

  get runLimitTracker(): RunLimitTracker {
    return this.tracker;
  }

  setRunExceededHandler(handler?: (breach: RunLimitBreach) => void): void {
    this.activeOnExceeded = handler;
  }

  recordUsage(usage: Usage | undefined): void {
    if (usage?.cost !== undefined && usage.currency !== undefined) {
      this.currency ??= usage.currency;
    }
    this.tracker.recordUsage(usage);
  }

  recordRunCompleted(): void {
    this.runsCount += 1;
  }

  restore(data?: SessionLimitsEntryData): void {
    if (data && data.cost > 0 && data.currency && this.limits.maxCost && data.currency !== this.limits.maxCost.currency) {
      throw new TypeError("Session limit currency does not match stored counters");
    }
    this.runsCount = data?.runs ?? 0;
    this.currency = data?.currency ?? this.limits.maxCost?.currency;
    this.tracker.dispose();
    this.tracker = this.buildTracker(data);
  }

  currentBreach(): RunLimitBreach | undefined {
    if (this.tracker.breach) return this.tracker.breach;
    if (this.limits.deadline !== null) {
      const deadlineMs = Date.parse(this.limits.deadline);
      const now = Date.now();
      if (now >= deadlineMs) return { limit: "deadline", scope: "session", maximum: deadlineMs, observed: now };
    }
    if (this.limits.maxRuns !== null && this.runsCount >= this.limits.maxRuns) {
      return { limit: "maxRuns", scope: "session", maximum: this.limits.maxRuns, observed: this.runsCount };
    }
    const snap = this.tracker.snapshot();
    if (this.limits.maxTotalTokens !== null && snap.totalTokens >= this.limits.maxTotalTokens) {
      return { limit: "maxTotalTokens", scope: "session", maximum: this.limits.maxTotalTokens, observed: snap.totalTokens };
    }
    if (this.limits.maxCost !== null && snap.cost >= this.limits.maxCost.amount) {
      return {
        limit: "maxCost",
        scope: "session",
        maximum: this.limits.maxCost.amount,
        observed: snap.cost,
        currency: this.limits.maxCost.currency,
      };
    }
    return undefined;
  }

  checkBeforeRun(): void {
    const breach = this.currentBreach();
    if (breach) throw new SessionLimitError(breach);
  }

  status(): SessionLimitsStatus {
    const snap = this.tracker.snapshot();
    const breach = this.currentBreach();
    const currency = this.currency ?? this.tracker.currency;
    const counters = Object.freeze({
      runs: this.runsCount,
      totalTokens: snap.totalTokens,
      cost: snap.cost,
      ...(currency !== undefined ? { currency } : {}),
    });
    const remaining = Object.freeze({
      runs: this.limits.maxRuns === null ? null : Math.max(0, this.limits.maxRuns - this.runsCount),
      totalTokens: this.limits.maxTotalTokens === null ? null : Math.max(0, this.limits.maxTotalTokens - snap.totalTokens),
      cost: this.limits.maxCost === null ? null : roundRemainingCost(this.limits.maxCost.amount - snap.cost),
      ...(this.limits.maxCost ? { currency: this.limits.maxCost.currency } : {}),
      deadlineMs: this.limits.deadline === null ? null : Math.max(0, Date.parse(this.limits.deadline) - Date.now()),
    });
    return Object.freeze({
      limits: this.limits,
      counters,
      remaining,
      exhausted: breach !== undefined,
      ...(breach ? { breach } : {}),
    });
  }

  toEntryData(): SessionLimitsEntryData {
    const snap = this.tracker.snapshot();
    const currency = this.currency ?? this.tracker.currency;
    return {
      schemaVersion: SESSION_LIMITS_ENTRY_SCHEMA_VERSION,
      runs: this.runsCount,
      totalTokens: snap.totalTokens,
      cost: snap.cost,
      ...(currency !== undefined ? { currency } : {}),
    };
  }
}
