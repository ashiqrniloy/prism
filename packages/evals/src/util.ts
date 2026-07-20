import { randomUUID } from "node:crypto";
import {
  createSecretRedactor,
  errorToErrorInfo,
  redactSecrets,
  type OwnershipScope,
  type SecretRedactor,
} from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_EVALUATION_PAGE_SIZE,
  DEFAULT_EXPERIMENT_CONCURRENCY,
  DEFAULT_SAMPLE_RATE,
  HARD_EVALUATION_PAGE_CAP,
  HARD_EXPERIMENT_CONCURRENCY_CAP,
} from "./limits.js";
import type { EvaluationRecord, EvaluationStatus, ScoreResult } from "./types.js";

export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function assertFiniteUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new EvalError(`${label} must be a finite number in [0, 1]`, "ERR_PRISM_EVAL_BOUNDS");
  }
  return value;
}

export function normalizeSampleRate(sampleRate: number | undefined): number {
  if (sampleRate === undefined) return DEFAULT_SAMPLE_RATE;
  return assertFiniteUnitInterval(sampleRate, "sampleRate");
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

export function shouldSample(sampleRate: number, random: () => number = Math.random): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return random() < sampleRate;
}

export function resolveRedactor(
  redactor?: SecretRedactor,
  secrets?: readonly (string | undefined)[],
): SecretRedactor | undefined {
  if (redactor) return redactor;
  if (!secrets || secrets.length === 0) return undefined;
  return createSecretRedactor(secrets);
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

export function exactOwnershipMatches(
  expected: OwnershipScope | undefined,
  actual: OwnershipScope | undefined,
): boolean {
  return ownershipMatches(expected, actual) && ownershipMatches(actual, expected);
}

export function ownershipMatches(
  expected: OwnershipScope | undefined,
  actual: OwnershipScope | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  if (expected.tenantId !== undefined && expected.tenantId !== actual.tenantId) return false;
  if (expected.accountId !== undefined && expected.accountId !== actual.accountId) return false;
  if (expected.userId !== undefined && expected.userId !== actual.userId) return false;
  return true;
}

export function statusMatches(
  expected: EvaluationStatus | readonly EvaluationStatus[] | undefined,
  actual: EvaluationStatus,
): boolean {
  if (!expected) return true;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

export function toErrorInfo(error: unknown) {
  return errorToErrorInfo(error);
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "aborted"));
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}
