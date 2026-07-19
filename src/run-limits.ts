import type { RunLimitBreach, RunLimitCounters, RunLimitName, RunLimits, Usage } from "./contracts.js";

export const DEFAULT_RUN_LIMITS: Required<Omit<RunLimits, "maxCost">> = Object.freeze({
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

export const HARD_MAX_RUN_COST = 10_000;

export const HARD_RUN_LIMITS: Required<Omit<RunLimits, "maxCost">> = Object.freeze({
  maxTurns: 64,
  maxProviderAttempts: 256,
  maxToolRounds: 64,
  maxToolCalls: 256,
  maxWallTimeMs: 30 * 60_000,
  maxRequestBytes: 64 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 250_000,
  maxTotalTokens: 1_000_000,
});

type IntegerLimit = Exclude<keyof typeof DEFAULT_RUN_LIMITS, never>;
const LIMIT_NAMES: readonly IntegerLimit[] = Object.keys(DEFAULT_RUN_LIMITS) as IntegerLimit[];
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

/** Validate one host-authored layer. Defaults are applied only after inheritance is resolved. */
export function resolveRunLimits(agent?: RunLimits, run?: RunLimits): Readonly<Required<Omit<RunLimits, "maxCost">> & Pick<RunLimits, "maxCost">> {
  const base = agent ? validateLimits(agent) : undefined;
  const override = run ? validateLimits(run) : undefined;
  const resolved: Record<IntegerLimit, number> = { ...DEFAULT_RUN_LIMITS };
  for (const name of LIMIT_NAMES) {
    if (base?.[name] !== undefined) resolved[name] = base[name]!;
    if (override?.[name] !== undefined) resolved[name] = base ? Math.min(resolved[name], override[name]!) : override[name]!;
  }
  const maxCost = override?.maxCost ?? base?.maxCost;
  return Object.freeze({ ...resolved, ...(maxCost ? { maxCost: base?.maxCost && override?.maxCost ? { amount: Math.min(base.maxCost.amount, override.maxCost.amount), currency: base.maxCost.currency === override.maxCost.currency ? base.maxCost.currency : failCurrency() } : maxCost } : {}) });
}

function failCurrency(): never { throw new TypeError("Run limit currencies must match when narrowed"); }

function validateLimits(input: RunLimits): RunLimits {
  for (const name of LIMIT_NAMES) {
    const value = input[name];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_RUN_LIMITS[name]) {
      throw new TypeError(`${name} must be a positive safe integer at most ${HARD_RUN_LIMITS[name]}`);
    }
  }
  if (input.maxCost) {
    const { amount, currency } = input.maxCost;
    if (!Number.isFinite(amount) || amount < 0 || amount > HARD_MAX_RUN_COST || !currency.trim()) throw new TypeError(`maxCost requires a finite amount from 0 through ${HARD_MAX_RUN_COST} and currency`);
  }
  return input;
}

export class RunLimitTracker {
  readonly limits: Readonly<Required<Omit<RunLimits, "maxCost">> & Pick<RunLimits, "maxCost">>;
  private readonly startedAt = performance.now();
  readonly deadlineAt: string;
  private readonly counters: Record<keyof RunLimitCounters, number>; 
  private timer?: ReturnType<typeof setTimeout>;
  private exceeded?: RunLimitBreach;

  constructor(limits: Readonly<Required<Omit<RunLimits, "maxCost">> & Pick<RunLimits, "maxCost">>, private readonly options: RunLimitTrackerOptions = {}) {
    this.limits = limits;
    this.counters = { turns: 0, providerAttempts: 0, toolRounds: 0, toolCalls: 0, wallTimeMs: 0, requestBytes: 0, responseBytes: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, ...options.snapshot };
    for (const [key, value] of Object.entries(this.counters)) {
      if (!Number.isFinite(value) || value < 0 || (key !== "cost" && !Number.isSafeInteger(value))) {
        throw new TypeError("Run limit snapshot must contain finite non-negative counters");
      }
    }
    const deadline = options.deadlineAt ? Date.parse(options.deadlineAt) : Date.now() + limits.maxWallTimeMs;
    if (!Number.isFinite(deadline)) throw new TypeError("Run limit deadlineAt is invalid");
    this.deadlineAt = new Date(deadline).toISOString();
    const remaining = Math.max(0, deadline - Date.now());
    this.timer = setTimeout(() => this.exceed("maxWallTimeMs", limits.maxWallTimeMs), remaining);
    this.timer.unref?.();
    if (remaining === 0) this.exceed("maxWallTimeMs", limits.maxWallTimeMs);
  }

  get breach(): RunLimitBreach | undefined { return this.exceeded; }
  snapshot(): RunLimitCounters { return { ...this.counters, wallTimeMs: Math.min(this.limits.maxWallTimeMs, Math.ceil(performance.now() - this.startedAt)) }; }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  charge(limit: Exclude<RunLimitName, "maxCost">, delta = 1): void {
    if (!Number.isSafeInteger(delta) || delta < 0) throw new TypeError("Run limit delta must be a non-negative safe integer");
    const counter = COUNTER_FOR[limit];
    const observed = this.counters[counter] + delta;
    if (!Number.isSafeInteger(observed)) this.exceed(limit, Number.MAX_SAFE_INTEGER + 1);
    this.counters[counter] = observed;
    if (observed > this.limits[limit]) this.exceed(limit, observed);
  }

  recordUsage(usage: Usage | undefined): void {
    if (!usage) {
      if (this.limits.maxCost) this.exceed("maxCost", Number.POSITIVE_INFINITY);
      return;
    }
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
      const value = usage[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`Provider usage ${key} must be a non-negative safe integer`);
    }
    const total = usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
    if (!Number.isSafeInteger(total)) throw new TypeError("Provider usage totalTokens is invalid");
    this.charge("maxInputTokens", usage.inputTokens ?? 0);
    this.charge("maxOutputTokens", usage.outputTokens ?? 0);
    this.charge("maxTotalTokens", total);
    if (usage.cost !== undefined && (!Number.isFinite(usage.cost) || usage.cost < 0)) throw new TypeError("Provider usage cost must be finite and non-negative");
    if (!this.limits.maxCost) return;
    if (usage.cost === undefined || usage.currency !== this.limits.maxCost.currency) this.exceed("maxCost", Number.POSITIVE_INFINITY);
    const observed = this.counters.cost + usage.cost!;
    this.counters.cost = observed;
    if (observed > this.limits.maxCost.amount) this.exceed("maxCost", observed);
  }

  private exceed(limit: RunLimitName, observed: number): never | void {
    if (!this.exceeded) {
      const maximum = limit === "maxCost" ? this.limits.maxCost?.amount ?? 0 : this.limits[limit];
      this.exceeded = { limit, maximum, observed, ...(limit === "maxCost" && this.limits.maxCost ? { currency: this.limits.maxCost.currency } : {}) };
      this.options.onExceeded?.(this.exceeded);
    }
    if (limit !== "maxWallTimeMs") throw new RunLimitError(this.exceeded);
  }
}

export function createRunLimitTracker(limits: RunLimits | undefined, options?: RunLimitTrackerOptions): RunLimitTracker {
  return new RunLimitTracker(resolveRunLimits(undefined, limits), options);
}
