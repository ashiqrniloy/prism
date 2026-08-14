import type { ModelConfig, Usage } from "./contracts-core.js";
import { cacheHitRate, cacheSavings } from "./cache-helpers.js";

/**
 * Prompt-cache telemetry surface (0.1.7, plan 019 Task 2).
 *
 * Dependency-free aggregator hosts attach to their `usage` `ProviderEvent`
 * stream (or run-ledger usage records) to get per-provider/model cache
 * statistics for tuning the `cache_aware` input layout. Explicit activation:
 * nothing subscribes by import — the host calls `record()`.
 */

/** Single provider/model statistics sample. */
export interface CacheTelemetrySample {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly inputTokens: number;
  /** Cached-input ratio across the sample (`cacheHitRate` math, aggregated). */
  readonly hitRate?: number;
  /** Estimated read-token savings via `cacheSavings` math; present only when
   *  the sample's model carries cost metadata (`ModelCost.input`/`cacheRead`). */
  readonly estimatedSavings?: number;
  readonly currency?: string;
}

/** Mutable internal accumulator; exposed snapshots are {@link CacheTelemetrySample}. */
type MutableSample = {
  -readonly [K in keyof CacheTelemetrySample]: CacheTelemetrySample[K];
};

/** Aggregated report. Samples are sorted by provider then model. */
export interface CacheTelemetryReport {
  readonly samples: readonly CacheTelemetrySample[];
  readonly overflowed: boolean;
  readonly totalRequests: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheWriteTokens: number;
}

export interface CacheTelemetryOptions {
  /** Distinct provider/model keys before excess keys collapse into the
   *  `__overflow__` bucket. Default {@link DEFAULT_CACHE_TELEMETRY_CAP}. */
  readonly maxKeys?: number;
}

export interface CacheTelemetry {
  /** Aggregate one usage record attributed to `model` (or an unknown bucket
   *  when no model is supplied). Rejects non-finite/negative token counts
   *  with {@link CacheTelemetryError}; validates before mutating. */
  record(usage: Usage, model?: ModelConfig): void;
  /** Snapshot of all samples (O(keys)); never throws. */
  report(): CacheTelemetryReport;
  /** Clear all samples (host rotation / long-run reset). */
  reset(): void;
  /** Number of distinct provider/model keys held (excluding the overflow bucket). */
  readonly size: number;
}

/** Cardinality ceiling: keys beyond this collapse into `__overflow__`. */
export const DEFAULT_CACHE_TELEMETRY_CAP = 256;
/** Sample bucket key for provider/model keys beyond the cap. */
export const CACHE_TELEMETRY_OVERFLOW_KEY = "__overflow__";

export class CacheTelemetryError extends Error {
  readonly code = "ERR_PRISM_CACHE_TELEMETRY";
  constructor(message: string) {
    super(message);
    this.name = "CacheTelemetryError";
  }
}

function validateTokens(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CacheTelemetryError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

function sampleFor(
  _usage: Usage,
  model: ModelConfig | undefined,
): {
  readonly provider: string;
  readonly model: string;
} {
  if (model) return { provider: model.provider, model: model.model };
  // Provider-only aggregation: no model supplied, attribute to the unknown bucket.
  return { provider: "unknown", model: "unknown" };
}

export function createCacheTelemetry(options: CacheTelemetryOptions = {}): CacheTelemetry {
  const maxKeys = options.maxKeys ?? DEFAULT_CACHE_TELEMETRY_CAP;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new CacheTelemetryError(`maxKeys must be a positive safe integer, got ${options.maxKeys}`);
  }
  // ponytail: fixed per-provider/model key cap with a single __overflow__ bucket;
  // if real deployments exceed it, upgrade to host-configurable caps or LRU eviction.
  const samples = new Map<string, MutableSample>();
  let overflow = false;
  let overflowSample: MutableSample | undefined;

  function bucket(provider: string, model: string): MutableSample {
    const key = `${provider}\u0000${model}`;
    let sample = samples.get(key);
    if (sample) return sample;
    if (samples.size >= maxKeys) {
      overflow = true;
      if (!overflowSample) {
        overflowSample = {
          provider: CACHE_TELEMETRY_OVERFLOW_KEY,
          model: CACHE_TELEMETRY_OVERFLOW_KEY,
          requests: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokens: 0,
        };
      }
      return overflowSample;
    }
    sample = { provider, model, requests: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0 };
    samples.set(key, sample);
    return sample;
  }

  return {
    record(usage, model) {
      // Validate everything before mutating: a bad record mutates nothing.
      validateTokens("usage.cacheReadTokens", usage.cacheReadTokens);
      validateTokens("usage.cacheWriteTokens", usage.cacheWriteTokens);
      validateTokens("usage.inputTokens", usage.inputTokens);
      const { provider, model: modelName } = sampleFor(usage, model);
      const sample = bucket(provider, modelName);
      sample.requests += 1;
      sample.cacheReadTokens += usage.cacheReadTokens ?? 0;
      sample.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      sample.inputTokens += usage.inputTokens ?? 0;
      sample.hitRate = cacheHitRate({
        cacheReadTokens: sample.cacheReadTokens,
        inputTokens: sample.inputTokens,
      });
      // The __overflow__ bucket aggregates mixed provider/model tokens, so it
      // never carries cost: one model's cost metadata must not be applied to
      // other models' tokens. It reports requests and token totals only.
      if (model?.cost && sample !== overflowSample) {
        // cacheSavings depends only on read tokens + cost metadata, so the
        // aggregate equals the sum of per-call savings; feed it the totals
        // to reuse the exact cache-helpers math rather than reimplementing it.
        const savings = cacheSavings({ cacheReadTokens: sample.cacheReadTokens }, model);
        sample.estimatedSavings = savings;
        sample.currency = model.cost.currency;
      }
    },
    report() {
      const samplesAll = [...samples.values()].sort((a, b) =>
        a.provider === b.provider ? a.model.localeCompare(b.model) : a.provider.localeCompare(b.provider),
      );
      const listed = overflowSample ? [...samplesAll, overflowSample] : samplesAll;
      const totalRequests = listed.reduce((sum, s) => sum + s.requests, 0);
      const totalCacheReadTokens = listed.reduce((sum, s) => sum + s.cacheReadTokens, 0);
      const totalCacheWriteTokens = listed.reduce((sum, s) => sum + s.cacheWriteTokens, 0);
      return { samples: listed, overflowed: overflow, totalRequests, totalCacheReadTokens, totalCacheWriteTokens };
    },
    reset() {
      samples.clear();
      overflow = false;
      overflowSample = undefined;
    },
    get size() {
      return samples.size;
    },
  };
}
