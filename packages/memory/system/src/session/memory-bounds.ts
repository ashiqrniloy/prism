import type { MemoryObservation, MemoryReflection } from "./types.js";
import { FOLDED_MEMORY } from "./types.js";

export const HARD_MAX_RENDERED_MEMORY_BYTES = 256 * 1024;
export const HARD_MAX_FOLDED_PAYLOAD_BYTES = 512 * 1024;

const relevanceRank: Record<MemoryObservation["relevance"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface BoundedMemoryPayload {
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly fullFold: boolean;
}

export function boundMemoryPayload(
  observations: readonly MemoryObservation[],
  reflections: readonly MemoryReflection[],
  droppedObservationIds: readonly string[],
  maxObservationTokens: number,
  maxPayloadBytes: number,
): BoundedMemoryPayload {
  let kept = [...observations];
  let totalTokens = kept.reduce((sum, item) => sum + item.tokenCount, 0);
  let fullFold = totalTokens > maxObservationTokens;
  const sorted = [...kept].sort(
    (left, right) => relevanceRank[left.relevance] - relevanceRank[right.relevance] || left.tokenCount - right.tokenCount,
  );
  while (
    kept.length &&
    (totalTokens > maxObservationTokens ||
      foldedByteLength({ observations: kept, reflections, droppedObservationIds, fullFold }) > maxPayloadBytes)
  ) {
    const drop = sorted.shift();
    if (!drop) break;
    kept = kept.filter((item) => item.id !== drop.id);
    totalTokens -= drop.tokenCount;
    fullFold = true;
  }
  if (foldedByteLength({ observations: kept, reflections, droppedObservationIds, fullFold }) > maxPayloadBytes) {
    throw new Error(`Observational memory folded payload exceeds ${maxPayloadBytes} bytes`);
  }
  return { observations: kept, reflections, droppedObservationIds, fullFold };
}

function foldedByteLength(payload: BoundedMemoryPayload): number {
  return Buffer.byteLength(
    JSON.stringify({
      type: FOLDED_MEMORY,
      version: 1,
      fullFold: payload.fullFold,
      observations: payload.observations,
      reflections: payload.reflections,
      droppedObservationIds: payload.droppedObservationIds,
    }),
    "utf8",
  );
}
