/** Defaults for memory operations. The host's value is the cap (plan 239): a limit is validated, never clamped. */

import { MemoryLimitError } from "./errors.js";

export const DEFAULT_TOP_K = 5;

export const DEFAULT_MESSAGE_RANGE = 0;

export const DEFAULT_EMBED_BATCH_SIZE = 32;

export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

export const DEFAULT_MAX_INJECTED_TOKENS = 2_000;

export const DEFAULT_MAX_VECTOR_DIMENSIONS = 4_096;

export const DEFAULT_MAX_ENTRY_TEXT_CHARS = 16_384;

/** Retention sweeps delete in bounded batches (no full-corpus scan per run). */
export const DEFAULT_MEMORY_RETENTION_BATCH = 500;

export const DEFAULT_MEMORY_EXPORT_PAGE_SIZE = 100;
export const DEFAULT_MAX_MEMORY_EXPORT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MEMORY_EXPORT_MS = 10_000;

export const DEFAULT_MEMORY_REBUILD_BATCH = 32;
export const DEFAULT_MEMORY_REBUILD_MS = 10_000;

export interface MemoryLimits {
  readonly topK: number;
  readonly messageRange: number;
  readonly embedBatchSize: number;
  readonly maxPayloadBytes: number;
  readonly maxInjectedTokens: number;
  readonly maxVectorDimensions: number;
  readonly maxEntryTextChars: number;
  readonly exportPageSize: number;
  readonly maxExportBytes: number;
  readonly exportMs: number;
  readonly rebuildBatchSize: number;
  readonly rebuildMs: number;
}

export interface MemoryLimitsInput {
  readonly topK?: number;
  readonly messageRange?: number;
  readonly embedBatchSize?: number;
  readonly maxPayloadBytes?: number;
  readonly maxInjectedTokens?: number;
  readonly maxVectorDimensions?: number;
  readonly maxEntryTextChars?: number;
  readonly exportPageSize?: number;
  readonly maxExportBytes?: number;
  readonly exportMs?: number;
  readonly rebuildBatchSize?: number;
  readonly rebuildMs?: number;
}

function nonNegativeInt(value: number | undefined, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new MemoryLimitError(`${label} must be a non-negative integer`);
  }
  return resolved;
}

export function resolveMemoryLimits(input: MemoryLimitsInput = {}): MemoryLimits {
  return {
    topK: nonNegativeInt(input.topK, DEFAULT_TOP_K, "topK"),
    messageRange: nonNegativeInt(input.messageRange, DEFAULT_MESSAGE_RANGE, "messageRange"),
    embedBatchSize: nonNegativeInt(input.embedBatchSize, DEFAULT_EMBED_BATCH_SIZE, "embedBatchSize"),
    maxPayloadBytes: nonNegativeInt(input.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "maxPayloadBytes"),
    maxInjectedTokens: nonNegativeInt(input.maxInjectedTokens, DEFAULT_MAX_INJECTED_TOKENS, "maxInjectedTokens"),
    maxVectorDimensions: nonNegativeInt(input.maxVectorDimensions, DEFAULT_MAX_VECTOR_DIMENSIONS, "maxVectorDimensions"),
    maxEntryTextChars: nonNegativeInt(input.maxEntryTextChars, DEFAULT_MAX_ENTRY_TEXT_CHARS, "maxEntryTextChars"),
    exportPageSize: nonNegativeInt(input.exportPageSize, DEFAULT_MEMORY_EXPORT_PAGE_SIZE, "exportPageSize"),
    maxExportBytes: nonNegativeInt(input.maxExportBytes, DEFAULT_MAX_MEMORY_EXPORT_BYTES, "maxExportBytes"),
    exportMs: nonNegativeInt(input.exportMs, DEFAULT_MEMORY_EXPORT_MS, "exportMs"),
    rebuildBatchSize: nonNegativeInt(input.rebuildBatchSize, DEFAULT_MEMORY_REBUILD_BATCH, "rebuildBatchSize"),
    rebuildMs: nonNegativeInt(input.rebuildMs, DEFAULT_MEMORY_REBUILD_MS, "rebuildMs"),
  };
}

/** Rough token estimate used only for injection budgets (chars/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
