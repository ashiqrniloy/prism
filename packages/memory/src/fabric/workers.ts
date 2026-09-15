import {
  measureWorkerJson,
  type ResolvedMemoryWorkerLimits,
  resolveMemoryWorkerLimits,
  truncateWorkerText,
} from "../compaction/observational-memory/limits.js";
import { MemoryValidationError } from "../errors.js";
import type { Memory, MemoryVectorHit } from "../types.js";
import { resolveConsolidationThreshold, unionStrings } from "./consolidate.js";
import { DEFAULT_LINKER_TOP_K, HARD_MAX_FABRIC_LINK_TOP_K } from "./links.js";
import { encodeMemoryNoteMetadata, MEMORY_NOTE_METADATA_KEY, type CreateMemoryFabricOptions, type MemoryNoteMetadata } from "./types.js";

export interface MemoryFabricSettings {
  readonly consolidate: boolean;
  readonly threshold: number;
  readonly linker: { readonly enabled: boolean; readonly topK: number };
  readonly evolution: { readonly enabled: boolean; readonly maxPatches: number };
  readonly passive: boolean;
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

function resolveBoundedInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > HARD_MAX_FABRIC_LINK_TOP_K) {
    throw new RangeError(`${label} must be a positive safe integer at most ${HARD_MAX_FABRIC_LINK_TOP_K}`);
  }
  return value as number;
}

/**
 * Create-time settings. Worker caps come from the observational-memory limit helper: `maxPatches`
 * defaults to its per-turn tool-call budget and `maxResultBytes` bounds one patched note payload.
 */
export function resolveMemoryFabricSettings(options: CreateMemoryFabricOptions): MemoryFabricSettings {
  const workerLimits = resolveMemoryWorkerLimits(options.workerLimits);
  const consolidate = resolveFlag(options.consolidate, "consolidate", true);
  const linker = resolveFlag(options.linker, "linker", false);
  const evolution = resolveFlag(options.evolution, "evolution", false);
  if (options.passive !== undefined && typeof options.passive !== "boolean") {
    throw new MemoryValidationError("passive must be a boolean");
  }
  return {
    consolidate: consolidate.enabled,
    threshold: resolveConsolidationThreshold(consolidate.config.threshold),
    linker: {
      enabled: linker.enabled,
      topK: resolveBoundedInt(linker.config.topK, DEFAULT_LINKER_TOP_K, "linker.topK"),
    },
    evolution: {
      enabled: evolution.enabled,
      maxPatches: resolveBoundedInt(evolution.config.maxPatches, workerLimits.maxToolCallsPerTurn, "evolution.maxPatches"),
    },
    passive: options.passive === true,
    workerLimits,
  };
}

export interface MemoryEvolutionNeighbor {
  readonly hit: MemoryVectorHit;
  readonly metadata: MemoryNoteMetadata;
}

const sameList = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean => {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

/**
 * Deterministic evolution worker: patches neighbor **annotations only** — keyword union, plus the
 * new note's context when the neighbor has none. Content, embedding, validity, consent, importance,
 * and `sourceEntryIds` are carried over untouched, and a neighbor that already carries the
 * annotations is not rewritten. No model, no tools, redacted text only.
 */
export async function runFabricEvolutionWorker(input: {
  readonly memory: Memory;
  readonly neighbors: readonly MemoryEvolutionNeighbor[];
  readonly keywords?: readonly string[];
  readonly context?: string;
  readonly limitBytes: number;
  readonly signal?: AbortSignal;
}): Promise<number> {
  let patched = 0;
  for (const neighbor of input.neighbors) {
    const keywords = unionStrings(neighbor.metadata.keywords, input.keywords);
    const context =
      neighbor.metadata.context ?? (input.context === undefined ? undefined : truncateWorkerText(input.context, input.limitBytes));
    const next: MemoryNoteMetadata = {
      ...neighbor.metadata,
      ...(keywords === undefined ? {} : { keywords }),
      ...(context === undefined ? {} : { context }),
    };
    if (sameList(neighbor.metadata.keywords, keywords) && neighbor.metadata.context === context) continue;
    try {
      measureWorkerJson(encodeMemoryNoteMetadata(next), input.limitBytes, "fabric evolution patch");
    } catch {
      continue; // over the worker byte budget: the neighbor keeps its annotations
    }
    await input.memory.remember(
      {
        entries: [
          {
            id: neighbor.hit.id,
            text: neighbor.hit.text,
            createdAt: neighbor.hit.createdAt,
            metadata: {
              ...(neighbor.hit.metadata ?? {}),
              [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata(next),
            },
            ...(neighbor.hit.consent === undefined ? {} : { consent: neighbor.hit.consent }),
            ...(neighbor.hit.importance === undefined ? {} : { importance: neighbor.hit.importance }),
          },
        ],
      },
      { wait: true, ...(input.signal === undefined ? {} : { signal: input.signal }) },
    );
    patched += 1;
  }
  return patched;
}
