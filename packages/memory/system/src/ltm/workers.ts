import { MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { type ResolvedMemoryWorkerLimits, resolveMemoryWorkerLimits } from "@arnilo/prism-memory-system/core";
import { resolveConsolidationThreshold } from "./consolidate.js";
import type { CreateMemoryFabricOptions } from "./types.js";

export interface MemoryFabricSettings {
  readonly consolidate: boolean;
  readonly threshold: number;
  /** The memory's retrieval mode: `"lexical"` scores notes with term-set Dice, `"hybrid"` with cosine. */
  readonly retrieval: "lexical" | "hybrid";
  readonly workerLimits: ResolvedMemoryWorkerLimits;
}

function resolveFlag(
  value: unknown,
  label: string,
  fallback: boolean,
): { readonly enabled: boolean; readonly config: Record<string, unknown> } {
  if (value === undefined) return { enabled: fallback, config: {} };
  if (typeof value === "boolean") return { enabled: value, config: {} };
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const config = value as Record<string, unknown>;
    const enabled = config.enabled ?? fallback;
    if (typeof enabled !== "boolean") throw new MemoryValidationError(`${label}.enabled must be a boolean`);
    return { enabled, config };
  }
  throw new MemoryValidationError(`${label} must be a boolean or an options object`);
}

/** Create-time settings. Worker caps come from the observational-memory limit helper. */
export function resolveMemoryFabricSettings(options: CreateMemoryFabricOptions): MemoryFabricSettings {
  const workerLimits = resolveMemoryWorkerLimits(options.workerLimits);
  const consolidate = resolveFlag(options.consolidate, "consolidate", true);
  return {
    consolidate: consolidate.enabled,
    threshold: resolveConsolidationThreshold(consolidate.config.threshold),
    retrieval: options.memory.retrieval ?? "hybrid",
    workerLimits,
  };
}
