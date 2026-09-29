import { type AgentLoopOptions, type AgentLoopStrategy, HARD_RUN_LIMITS, type RunLimits, type TurnPolicyOptions } from "@arnilo/prism";
import { PrismCodeConfigError } from "./errors.js";

// ---------------------------------------------------------------------------
// Prism Code Run Limits Defaults
// ---------------------------------------------------------------------------

/**
 * Default run limits for Prism Code across TUI, headless, and ACP:
 * Every policy axis is unbounded (`null`), and byte envelopes are set to
 * process-safety hard ceilings (64 MiB).
 */
export const PRISM_CODE_DEFAULT_LIMITS: RunLimits = Object.freeze({
  maxTurns: null,
  maxProviderAttempts: null,
  maxToolRounds: null,
  maxToolCalls: null,
  maxWallTimeMs: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxTotalTokens: null,
  maxStopContinuations: null,
  maxRequestBytes: HARD_RUN_LIMITS.maxRequestBytes,
  maxResponseBytes: HARD_RUN_LIMITS.maxResponseBytes,
});

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface PrismCodeMaxCostConfig {
  readonly amount: number;
  readonly currency?: string;
}

export interface PrismCodeLimitsConfig {
  readonly maxTurns?: number | null;
  readonly maxProviderAttempts?: number | null;
  readonly maxToolRounds?: number | null;
  readonly maxToolCalls?: number | null;
  readonly maxWallTimeMs?: number | null;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxInputTokens?: number | null;
  readonly maxOutputTokens?: number | null;
  readonly maxTotalTokens?: number | null;
  readonly maxStopContinuations?: number | null;
  readonly maxCost?: PrismCodeMaxCostConfig | number;
}

export type PrismCodeLoopConfig =
  | string
  | {
      readonly strategy?: string;
      readonly toolConcurrency?: number;
      /** Default true: a run continues while `todo_write` items stay open (plan 137 Task 7). */
      readonly continueOnOpenTodos?: boolean;
      readonly [key: string]: unknown;
    }
  | AgentLoopStrategy;

// ---------------------------------------------------------------------------
// Validation Helpers & Known Keys
// ---------------------------------------------------------------------------

export const KNOWN_LIMITS_KEYS = new Set([
  "maxTurns",
  "maxProviderAttempts",
  "maxToolRounds",
  "maxToolCalls",
  "maxWallTimeMs",
  "maxRequestBytes",
  "maxResponseBytes",
  "maxInputTokens",
  "maxOutputTokens",
  "maxTotalTokens",
  "maxStopContinuations",
  "maxCost",
]);

const KNOWN_LOOP_KEYS = new Set(["strategy", "toolConcurrency", "continueOnOpenTodos"]);
const KNOWN_MAX_COST_KEYS = new Set(["amount", "currency"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(source: string, message: string): never {
  throw new PrismCodeConfigError(`${source}: ${message}`);
}

function rejectUnknown(record: Record<string, unknown>, known: ReadonlySet<string>, source: string): void {
  const unknown = Object.keys(record).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    fail(source, `unknown key(s): ${unknown.join(", ")}`);
  }
}

function validateMaxCost(val: unknown, source: string): PrismCodeMaxCostConfig {
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) {
      fail(source, "must be a non-negative number");
    }
    return { amount: val, currency: "USD" };
  }
  if (isRecord(val)) {
    rejectUnknown(val, KNOWN_MAX_COST_KEYS, source);
    const amount = val.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      fail(`${source}.amount`, "must be a non-negative number");
    }
    let currency = "USD";
    if (val.currency !== undefined) {
      if (typeof val.currency !== "string" || !val.currency.trim()) {
        fail(`${source}.currency`, "must be a non-empty string");
      }
      currency = val.currency.trim();
    }
    return { amount, currency };
  }
  fail(source, "must be a number or { amount, currency } object");
}

export function validatePrismCodeLimits(raw: unknown, source = "limits"): PrismCodeLimitsConfig {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) fail(source, "limits must be an object");
  rejectUnknown(raw, KNOWN_LIMITS_KEYS, source);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val === undefined) continue;

    if (key === "maxCost") {
      result.maxCost = validateMaxCost(val, `${source}.maxCost`);
      continue;
    }

    if (key === "maxRequestBytes" || key === "maxResponseBytes") {
      if (typeof val !== "number" || !Number.isSafeInteger(val) || val < 1 || val > HARD_RUN_LIMITS[key]) {
        fail(`${source}.${key}`, `must be a positive integer at most ${HARD_RUN_LIMITS[key]}`);
      }
      result[key] = val;
      continue;
    }

    if (key === "maxStopContinuations") {
      if (val !== null && (typeof val !== "number" || !Number.isSafeInteger(val) || val < 0)) {
        fail(`${source}.${key}`, "must be a non-negative integer or null");
      }
      result[key] = val;
      continue;
    }

    // Policy axes: maxTurns, maxProviderAttempts, maxToolRounds, maxToolCalls, maxWallTimeMs, maxInputTokens, maxOutputTokens, maxTotalTokens
    if (val !== null && (typeof val !== "number" || !Number.isSafeInteger(val) || val < 1)) {
      fail(`${source}.${key}`, "must be a positive integer or null to disable");
    }
    result[key] = val;
  }

  return result as PrismCodeLimitsConfig;
}

export function validatePrismCodeLoop(raw: unknown, source = "loop"): PrismCodeLoopConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    if (!raw.trim()) fail(source, "must be a non-empty string");
    return raw.trim();
  }
  if (isRecord(raw)) {
    if (typeof (raw as Record<string, unknown>).run === "function") {
      return raw as unknown as AgentLoopStrategy;
    }
    rejectUnknown(raw, KNOWN_LOOP_KEYS, source);
    let strategy: string | undefined;
    if (raw.strategy !== undefined) {
      if (typeof raw.strategy !== "string" || !raw.strategy.trim()) {
        fail(`${source}.strategy`, "must be a non-empty string");
      }
      strategy = raw.strategy.trim();
    }
    let toolConcurrency: number | undefined;
    if (raw.toolConcurrency !== undefined) {
      if (typeof raw.toolConcurrency !== "number" || !Number.isSafeInteger(raw.toolConcurrency) || raw.toolConcurrency < 1) {
        fail(`${source}.toolConcurrency`, "must be a positive integer");
      }
      toolConcurrency = raw.toolConcurrency;
    }
    let continueOnOpenTodos: boolean | undefined;
    if (raw.continueOnOpenTodos !== undefined) {
      if (typeof raw.continueOnOpenTodos !== "boolean") {
        fail(`${source}.continueOnOpenTodos`, "must be a boolean");
      }
      continueOnOpenTodos = raw.continueOnOpenTodos;
    }
    return {
      strategy: strategy ?? "single-shot",
      ...(toolConcurrency !== undefined ? { toolConcurrency } : {}),
      ...(continueOnOpenTodos !== undefined ? { continueOnOpenTodos } : {}),
    };
  }
  fail(source, "must be a string or object");
}

// ---------------------------------------------------------------------------
// Resolver Functions
// ---------------------------------------------------------------------------

export function resolvePrismCodeLimits(configLimits?: PrismCodeLimitsConfig): RunLimits {
  if (!configLimits) return PRISM_CODE_DEFAULT_LIMITS;

  const result: Record<string, unknown> = { ...PRISM_CODE_DEFAULT_LIMITS };

  for (const [key, val] of Object.entries(configLimits)) {
    if (val !== undefined) {
      if (key === "maxCost") {
        if (typeof val === "number") {
          result.maxCost = { amount: val, currency: "USD" };
        } else if (val && typeof val === "object") {
          result.maxCost = {
            amount: (val as { amount: number }).amount,
            currency: (val as { currency?: string }).currency ?? "USD",
          };
        }
      } else {
        result[key] = val;
      }
    }
  }

  return result as RunLimits;
}

export function resolvePrismCodeLoop(loopConfig?: PrismCodeLoopConfig): AgentLoopStrategy | AgentLoopOptions | undefined {
  if (!loopConfig) return undefined;
  if (typeof loopConfig === "string") {
    return { strategy: loopConfig as "single-shot" };
  }
  if (typeof (loopConfig as Record<string, unknown>).run === "function") {
    return loopConfig as AgentLoopStrategy;
  }
  const obj = loopConfig as { strategy?: string; toolConcurrency?: number };
  return {
    strategy: (obj.strategy as "single-shot") ?? "single-shot",
    ...(obj.toolConcurrency !== undefined ? { toolConcurrency: obj.toolConcurrency } : {}),
  };
}

/**
 * `loop.continueOnOpenTodos` (plan 137 Task 7): register `todo_write` + the completion stop hook.
 * Default true; `false` disables both. String/strategy loop configs never carry the key.
 */
export function resolveContinueOnOpenTodos(loopConfig?: PrismCodeLoopConfig): boolean {
  if (!loopConfig || typeof loopConfig !== "object" || typeof (loopConfig as { run?: unknown }).run === "function") {
    return true;
  }
  return (loopConfig as { continueOnOpenTodos?: unknown }).continueOnOpenTodos !== false;
}

// ---------------------------------------------------------------------------
// Clean Cost Turn Policy
// ---------------------------------------------------------------------------

export function createCostTurnPolicy(maxCost?: { amount: number; currency?: string } | number): TurnPolicyOptions | undefined {
  if (maxCost === undefined || maxCost === null) return undefined;
  const target =
    typeof maxCost === "number" ? { amount: maxCost, currency: "USD" } : { amount: maxCost.amount, currency: maxCost.currency ?? "USD" };

  return {
    stop: (ctx) => {
      if (ctx.usage?.cost !== undefined && ctx.usage.cost >= target.amount) {
        return { action: "stop", reason: "max_cost" };
      }
      return { action: "continue" };
    },
  };
}
