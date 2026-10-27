import type { EvaluationRecord, EvaluationStatus } from "@arnilo/prism";
import { randomUUID } from "node:crypto";
import { errorToErrorInfo, type OwnershipScope, type RunResult, redactSecrets, resolveRedactor, type SecretRedactor } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_EVALUATION_PAGE_SIZE,
  DEFAULT_EXPERIMENT_CONCURRENCY,
  DEFAULT_SAMPLE_RATE,
  HARD_EVALUATION_PAGE_CAP,
  HARD_EXPERIMENT_CONCURRENCY_CAP,
} from "./limits.js";
import type { EvaluationSampling, EvaluationSamplingMetadata, ScoreResult } from "./types.js";

export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function assertFiniteUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new EvalError(`${label} must be a finite number in [0, 1]`, "ERR_PRISM_EVAL_BOUNDS");
  }
  return value;
}

export function resolveSampling(
  result: RunResult,
  sampling: EvaluationSampling | undefined,
): { readonly probability: number; readonly metadata?: EvaluationSamplingMetadata } {
  if (sampling === undefined) return { probability: DEFAULT_SAMPLE_RATE };
  if (!sampling || typeof sampling !== "object" || Array.isArray(sampling)) {
    throw new EvalError("sampling must be an object", "ERR_PRISM_EVAL_BOUNDS");
  }
  const rate = sampling.rate === undefined ? DEFAULT_SAMPLE_RATE : assertFiniteUnitInterval(sampling.rate, "sampling.rate");
  if (sampling.strata !== undefined && typeof sampling.strata !== "function") {
    throw new EvalError("sampling.strata must be a function", "ERR_PRISM_EVAL_BOUNDS");
  }
  if (sampling.always !== undefined && typeof sampling.always !== "function") {
    throw new EvalError("sampling.always must be a function", "ERR_PRISM_EVAL_BOUNDS");
  }
  if (sampling.rates !== undefined) {
    if (!sampling.rates || typeof sampling.rates !== "object" || Array.isArray(sampling.rates)) {
      throw new EvalError("sampling.rates must be an object", "ERR_PRISM_EVAL_BOUNDS");
    }
    for (const [key, value] of Object.entries(sampling.rates)) {
      if (!key.trim()) throw new EvalError("sampling.rates keys must be nonempty strings", "ERR_PRISM_EVAL_BOUNDS");
      assertFiniteUnitInterval(value, `sampling.rates.${key}`);
    }
  }
  const stratum = sampling.strata ? sampling.strata(result) : "default";
  if (typeof stratum !== "string" || !stratum.trim()) {
    throw new EvalError("sampling.strata must return a nonempty string", "ERR_PRISM_EVAL_BOUNDS");
  }
  const always = sampling.always ? Boolean(sampling.always(result)) : false;
  const probability = always
    ? 1
    : sampling.rates !== undefined && Object.hasOwn(sampling.rates, stratum)
      ? sampling.rates[stratum]!
      : rate;
  return {
    probability,
    ...(probability > 0 ? { metadata: { stratum, probability } } : {}),
  };
}

export function normalizeConcurrency(concurrency: number | undefined): number {
  const value = concurrency ?? DEFAULT_EXPERIMENT_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1) {
    throw new EvalError("concurrency must be an integer >= 1", "ERR_PRISM_EVAL_BOUNDS");
  }
  return Math.min(value, HARD_EXPERIMENT_CONCURRENCY_CAP);
}

export function normalizePageLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_EVALUATION_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new EvalError("limit must be an integer >= 1", "ERR_PRISM_EVAL_BOUNDS");
  }
  return Math.min(value, HARD_EVALUATION_PAGE_CAP);
}

export function validateScoreResult(result: ScoreResult): ScoreResult {
  assertFiniteUnitInterval(result.score, "score");
  return result;
}

/**
 * FNV-1a over `itemId` + `trialIndex`, seeded with `seed`: one 32-bit hash per trial, so a
 * `(seed, itemId, trialIndex)` stream does not depend on the order trials are scheduled in.
 */
export function hash32(seed: number, itemId: string, trialIndex: number): number {
  let hash = (2166136261 ^ (seed | 0)) >>> 0;
  const text = `${itemId}\u0000${trialIndex}`;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shouldSample(rate: number, random: () => number = Math.random): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return random() < rate;
}

export function redactEvaluationRecord(
  record: EvaluationRecord,
  redactor?: SecretRedactor,
  secrets?: readonly (string | undefined)[],
): EvaluationRecord {
  const active = resolveRedactor(redactor, secrets);
  if (!active && (!secrets || secrets.every((secret) => !secret))) return record;
  const redact = <T>(value: T): T => (active ? active.redact(value) : redactSecrets(value, secrets ?? []));
  return {
    ...record,
    reason: record.reason !== undefined ? redact(record.reason) : undefined,
    error: record.error ? redact(record.error) : undefined,
    metadata: record.metadata ? redact(record.metadata) : undefined,
  };
}

export function exactOwnershipMatches(expected: OwnershipScope | undefined, actual: OwnershipScope | undefined): boolean {
  return ownershipMatches(expected, actual) && ownershipMatches(actual, expected);
}

export function ownershipMatches(expected: OwnershipScope | undefined, actual: OwnershipScope | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  if (expected.tenantId !== undefined && expected.tenantId !== actual.tenantId) return false;
  if (expected.accountId !== undefined && expected.accountId !== actual.accountId) return false;
  if (expected.userId !== undefined && expected.userId !== actual.userId) return false;
  return true;
}

export function statusMatches(expected: EvaluationStatus | readonly EvaluationStatus[] | undefined, actual: EvaluationStatus): boolean {
  if (!expected) return true;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

export function toErrorInfo(error: unknown) {
  return errorToErrorInfo(error);
}

/**
 * Run `worker` over `items` with bounded concurrency. Without `settle` the first abort or worker
 * error rejects and discards finished work; with it every item settles — the failure (or the abort
 * reason for items that never started) is passed to `settle` to fill that slot.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  settle?: (item: T, index: number, error: unknown) => R,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (signal?.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "aborted"));
        if (!settle) throw reason;
        // Synchronous fill: no `await` between reading `next` and claiming the rest.
        for (let index = next; index < items.length; index++) results[index] = settle(items[index]!, index, reason);
        next = items.length;
        return;
      }
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        if (!settle) throw error;
        results[index] = settle(items[index]!, index, error);
      }
    }
  });
  await Promise.all(runners);
  return results;
}


/** Sorted object keys, ordered arrays, JSON's undefined rules; reject lossy non-JSON values. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const normalize = (value: unknown): unknown => {
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null || ancestors.has(value)
      || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      || Object.getOwnPropertySymbols(value).length) throw new TypeError("not serializable");
    ancestors.add(value);
    const result = Array.isArray(value) ? value.map(normalize)
      : Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize((value as Record<string, unknown>)[key])]));
    ancestors.delete(value);
    return result;
  };
  const json = JSON.stringify(normalize(value));
  if (json === undefined) throw new TypeError("not serializable");
  return json;
}
