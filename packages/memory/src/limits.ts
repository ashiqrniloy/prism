/** Default and hard caps for memory operations. */

import { MemoryLimitError } from "./errors.js";

export const DEFAULT_TOP_K = 5;
export const HARD_TOP_K_CAP = 32;

export const DEFAULT_MESSAGE_RANGE = 0;
export const HARD_MESSAGE_RANGE_CAP = 4;

export const DEFAULT_EMBED_BATCH_SIZE = 32;
export const HARD_EMBED_BATCH_CAP = 128;

export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
export const HARD_MAX_PAYLOAD_BYTES_CAP = 512 * 1024;

export const DEFAULT_MAX_INJECTED_TOKENS = 2_000;
export const HARD_MAX_INJECTED_TOKENS_CAP = 8_000;

export const DEFAULT_MAX_VECTOR_DIMENSIONS = 4_096;
export const HARD_MAX_VECTOR_DIMENSIONS_CAP = 4_096;

export const DEFAULT_MAX_ENTRY_TEXT_CHARS = 16_384;
export const HARD_MAX_ENTRY_TEXT_CHARS_CAP = 64_384;

export const DEFAULT_MAX_WORKING_MEMORY_BYTES = 32 * 1024;
export const HARD_MAX_WORKING_MEMORY_BYTES_CAP = 256 * 1024;

export interface MemoryLimits {
  readonly topK: number;
  readonly messageRange: number;
  readonly embedBatchSize: number;
  readonly maxPayloadBytes: number;
  readonly maxInjectedTokens: number;
  readonly maxVectorDimensions: number;
  readonly maxEntryTextChars: number;
  readonly maxWorkingMemoryBytes: number;
}

export interface MemoryLimitsInput {
  readonly topK?: number;
  readonly messageRange?: number;
  readonly embedBatchSize?: number;
  readonly maxPayloadBytes?: number;
  readonly maxInjectedTokens?: number;
  readonly maxVectorDimensions?: number;
  readonly maxEntryTextChars?: number;
  readonly maxWorkingMemoryBytes?: number;
}

function clampPositiveInt(value: number | undefined, fallback: number, hardCap: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new MemoryLimitError(`${label} must be a non-negative integer`);
  }
  if (resolved > hardCap) {
    throw new MemoryLimitError(`${label} exceeds hard cap ${hardCap}`);
  }
  return resolved;
}

export function resolveMemoryLimits(input: MemoryLimitsInput = {}): MemoryLimits {
  return {
    topK: clampPositiveInt(input.topK, DEFAULT_TOP_K, HARD_TOP_K_CAP, "topK"),
    messageRange: clampPositiveInt(input.messageRange, DEFAULT_MESSAGE_RANGE, HARD_MESSAGE_RANGE_CAP, "messageRange"),
    embedBatchSize: clampPositiveInt(input.embedBatchSize, DEFAULT_EMBED_BATCH_SIZE, HARD_EMBED_BATCH_CAP, "embedBatchSize"),
    maxPayloadBytes: clampPositiveInt(input.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, HARD_MAX_PAYLOAD_BYTES_CAP, "maxPayloadBytes"),
    maxInjectedTokens: clampPositiveInt(input.maxInjectedTokens, DEFAULT_MAX_INJECTED_TOKENS, HARD_MAX_INJECTED_TOKENS_CAP, "maxInjectedTokens"),
    maxVectorDimensions: clampPositiveInt(
      input.maxVectorDimensions,
      DEFAULT_MAX_VECTOR_DIMENSIONS,
      HARD_MAX_VECTOR_DIMENSIONS_CAP,
      "maxVectorDimensions",
    ),
    maxEntryTextChars: clampPositiveInt(
      input.maxEntryTextChars,
      DEFAULT_MAX_ENTRY_TEXT_CHARS,
      HARD_MAX_ENTRY_TEXT_CHARS_CAP,
      "maxEntryTextChars",
    ),
    maxWorkingMemoryBytes: clampPositiveInt(
      input.maxWorkingMemoryBytes,
      DEFAULT_MAX_WORKING_MEMORY_BYTES,
      HARD_MAX_WORKING_MEMORY_BYTES_CAP,
      "maxWorkingMemoryBytes",
    ),
  };
}

/** Rough token estimate used only for injection budgets (chars/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
