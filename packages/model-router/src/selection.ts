import type { ModelConfig } from "@arnilo/prism";
import type { CostLatencySelectionOptions, ModelRouterSelectionPolicy } from "./types.js";

/**
 * Reference cost/latency selection policy (0.1.7, plan 019 Task 3).
 *
 * Ranks candidates by unit price first (`ModelCost.input` + `output` +
 * `cacheRead`, normalized by the cost unit), then breaks cost ties by recent
 * measured latency (in-memory EMA fed through the router's `recordOutcome`
 * with a host-supplied `latencyMs`). Models without valid cost metadata rank
 * after all priced models, preserving their relative input order. Cold start
 * (no latency samples) is pure cost order.
 */

const DEFAULT_LATENCY_WEIGHT = 0.5;
const DEFAULT_MAX_KEY_LENGTH = 512;
const EMA_KEY_SEPARATOR = "\u0000";

function costUnitDivisor(unit: string | undefined): number {
  return unit && /(?:1m|million)/i.test(unit) ? 1_000_000 : 1;
}

/** Normalized per-token unit price; undefined when any present field is invalid. */
function unitPrice(model: ModelConfig): number | undefined {
  const cost = model.cost;
  if (!cost) return undefined;
  let total = 0;
  for (const field of ["input", "output", "cacheRead"] as const) {
    const value = cost[field];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) return undefined;
    total += value;
  }
  return total / costUnitDivisor(cost.unit);
}

export function createCostLatencySelection(options: CostLatencySelectionOptions = {}): ModelRouterSelectionPolicy {
  const weight = options.latencyWeight ?? DEFAULT_LATENCY_WEIGHT;
  if (!(Number.isFinite(weight) && weight >= 0 && weight <= 1)) {
    throw new TypeError("costLatencySelection latencyWeight must be a number in [0, 1]");
  }
  const maxKeyLength = options.maxKeyLength ?? DEFAULT_MAX_KEY_LENGTH;
  if (!Number.isSafeInteger(maxKeyLength) || maxKeyLength < 1) {
    throw new TypeError("costLatencySelection maxKeyLength must be a positive safe integer");
  }
  // ponytail: per-provider/model in-memory EMA, bounded by candidate keys and
  // lost on process restart; durable latency statistics are demand-gated (0.2.0
  // candidate) and would require a ModelRouterStateStore contract change.
  const latencyEma = new Map<string, { ema: number; seen: number }>();

  function emaKey(provider: string, model: string): string {
    const p = provider.slice(0, maxKeyLength);
    const m = model.slice(0, maxKeyLength);
    return `${p}${EMA_KEY_SEPARATOR}${m}`;
  }

  return {
    name: "cost-latency",
    rank(candidates) {
      const ranked = candidates
        .map((candidate, index) => ({ candidate, index, price: unitPrice(candidate) }))
        .sort((a, b) => {
          // Unknown costs rank after all priced models, input order preserved.
          if (a.price === undefined && b.price === undefined) return a.index - b.index;
          if (a.price === undefined) return 1;
          if (b.price === undefined) return -1;
          if (a.price !== b.price) return a.price - b.price;
          const latencyA = latencyEma.get(emaKey(a.candidate.provider, a.candidate.model))?.ema;
          const latencyB = latencyEma.get(emaKey(b.candidate.provider, b.candidate.model))?.ema;
          if (latencyA !== undefined && latencyB !== undefined && latencyA !== latencyB) return latencyA - latencyB;
          if (latencyA === undefined && latencyB !== undefined) return 1;
          if (latencyA !== undefined && latencyB === undefined) return -1;
          return a.index - b.index;
        })
        .map((entry) => entry.candidate);
      return ranked;
    },
    observe(outcome) {
      if (!outcome.success || outcome.latencyMs === undefined) return;
      if (!(Number.isFinite(outcome.latencyMs) && outcome.latencyMs >= 0)) return;
      const key = emaKey(outcome.provider, outcome.model);
      const prior = latencyEma.get(key);
      const ema = prior ? weight * outcome.latencyMs + (1 - weight) * prior.ema : outcome.latencyMs;
      latencyEma.set(key, { ema, seen: (prior?.seen ?? 0) + 1 });
    },
  };
}
