import type { ResolvedRunLimits, RunLimitBreach, RunLimitCounters, RunLimitName, RunLimits, Usage } from "./contracts.js";

export const DEFAULT_RUN_LIMITS = Object.freeze({
  maxTurns: 16,
  maxProviderAttempts: 24,
  maxToolRounds: 8,
  maxToolCalls: 32,
  maxWallTimeMs: 120_000,
  maxRequestBytes: 8 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  maxInputTokens: 40_000,
  maxOutputTokens: 10_000,
  maxTotalTokens: 50_000,
});

/**
 * Process-safety ceilings that exist so a bug cannot OOM the host via JSON.parse of giant
 * provider frames. Product axes (turns, wall time, tokens, …) have no hard cap: hosts set
 * them per workload, and `null` explicitly disables an axis.
 */
export const HARD_RUN_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
});

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
export function resolveRunLimits(agent?: RunLimits, run?: RunLimits): Readonly<ResolvedRunLimits> {
  const base = agent ? validateLimits(agent) : undefined;
  const override = run ? validateLimits(run) : undefined;
  const resolved = { ...DEFAULT_RUN_LIMITS } as Record<IntegerLimit, number | null>;
  for (const name of POLICY_NAMES) {
    const narrowed = minCap(base?.[name], override?.[name]);
    resolved[name] = narrowed !== undefined ? narrowed : DEFAULT_RUN_LIMITS[name];
  }
  for (const name of ["maxRequestBytes", "maxResponseBytes"] as const) {
    if (base?.[name] !== undefined) resolved[name] = Math.min(resolved[name] as number, base[name]!);
    if (override?.[name] !== undefined) resolved[name] = Math.min(resolved[name] as number, override[name]!);
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
  return Object.freeze({
    ...resolved,
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

function validateLimits(input: RunLimits): RunLimits {
  for (const name of LIMIT_NAMES) {
    const value = input[name];
    if (value === undefined) continue;
    if (name === "maxRequestBytes" || name === "maxResponseBytes") {
      // Process-safety axes: a giant frame cannot be host-approved away, so `null` is rejected.
      if (value === null || !Number.isSafeInteger(value) || value < 1 || value > HARD_RUN_LIMITS[name])
        throw new TypeError(`${name} must be a positive safe integer at most ${HARD_RUN_LIMITS[name]}`);
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
      wallTimeMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      ...options.snapshot,
    };
    for (const [key, value] of Object.entries(this.counters)) {
      if (!Number.isFinite(value) || value < 0 || (key !== "cost" && !Number.isSafeInteger(value))) {
        throw new TypeError("Run limit snapshot must contain finite non-negative counters");
      }
    }
    // A restored durable deadline wins even when the wall limit is now disabled (never drop an existing wall).
    const deadline = options.deadlineAt
      ? Date.parse(options.deadlineAt)
      : limits.maxWallTimeMs === null
        ? undefined
        : Date.now() + limits.maxWallTimeMs;
    if (deadline === undefined) {
      this.deadlineAt = undefined;
    } else {
      if (!Number.isFinite(deadline)) throw new TypeError("Run limit deadlineAt is invalid");
      this.deadlineAt = new Date(deadline).toISOString();
      const remaining = Math.max(0, deadline - Date.now());
      // Node clamps setTimeout delays above 2^31-1 (~24.8 days) to 1ms, which would breach early;
      // arm capped and re-check the real clock before exceeding.
      const arm = (delay: number): void => {
        this.timer = setTimeout(() => {
          const left = deadline - Date.now();
          if (left > 0) arm(Math.min(left, 2_147_483_647));
          else this.exceed("maxWallTimeMs", limits.maxWallTimeMs ?? 0);
        }, delay);
        this.timer.unref?.();
      };
      arm(Math.min(remaining, 2_147_483_647));
      if (remaining === 0) this.exceed("maxWallTimeMs", limits.maxWallTimeMs ?? 0);
    }
  }

  get breach(): RunLimitBreach | undefined {
    return this.exceeded;
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

  charge(limit: Exclude<RunLimitName, "maxCost">, delta = 1): void {
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
    if (!this.limits.maxCost) return;
    if (usage.cost === undefined || usage.currency !== this.limits.maxCost.currency) this.exceed("maxCost", Number.POSITIVE_INFINITY);
    const observed = this.counters.cost + usage.cost!;
    this.counters.cost = observed;
    if (observed > this.limits.maxCost.amount) this.exceed("maxCost", observed);
  }

  private exceed(limit: RunLimitName, observed: number): never | undefined {
    if (!this.exceeded) {
      const maximum = limit === "maxCost" ? (this.limits.maxCost?.amount ?? 0) : (this.limits[limit] ?? 0);
      this.exceeded = {
        limit,
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
