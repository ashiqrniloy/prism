import { isDurableOrUserStatement } from "./attribution.js";
import type { MemorySystemEviction } from "./config.js";
import type { MemoryObservation, MemoryWmItem } from "./types.js";
import { FOLDED_MEMORY } from "./types.js";

export const HARD_MAX_RENDERED_MEMORY_BYTES = 256 * 1024;
export const HARD_MAX_FOLDED_PAYLOAD_BYTES = 512 * 1024;

const relevanceRank: Record<MemoryObservation["relevance"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

type EvictionCompare = (left: MemoryObservation, right: MemoryObservation) => number;

const timeOf = (item: MemoryObservation): number => {
  const time = Date.parse(item.observedAt ?? item.timestamp);
  return Number.isFinite(time) ? time : 0;
};

/**
 * The order records are left out in when the pool is over its bound, first to go first (`context.eviction`).
 * - `relevance`: lowest relevance first, then smallest, whatever the age or the speaker.
 * - `protect-user` (plan 218.5 Task 3, a candidate until its verdict): every record that is not durable or a user
 *   statement goes before any that is; within each side, lowest relevance first, then oldest. Ties keep ledger order.
 */
const EVICTION_ORDER: Record<MemorySystemEviction, EvictionCompare> = {
  relevance: (left, right) => relevanceRank[left.relevance] - relevanceRank[right.relevance] || left.tokenCount - right.tokenCount,
  "protect-user": (left, right) =>
    Number(isDurableOrUserStatement(left)) - Number(isDurableOrUserStatement(right)) ||
    relevanceRank[left.relevance] - relevanceRank[right.relevance] ||
    timeOf(left) - timeOf(right),
};

export interface BoundedMemoryPayload {
  readonly observations: readonly MemoryObservation[];
  readonly wmItems: readonly MemoryWmItem[];
  readonly droppedObservationIds: readonly string[];
  readonly fullFold: boolean;
}

export function boundMemoryPayload(
  observations: readonly MemoryObservation[],
  wmItems: readonly MemoryWmItem[],
  droppedObservationIds: readonly string[],
  maxObservationTokens: number,
  maxPayloadBytes: number,
  eviction: MemorySystemEviction = "relevance",
): BoundedMemoryPayload {
  let kept = [...observations];
  let totalTokens = kept.reduce((sum, item) => sum + item.tokenCount, 0);
  let fullFold = totalTokens > maxObservationTokens;
  const sorted = [...kept].sort(EVICTION_ORDER[eviction]);
  while (
    kept.length &&
    (totalTokens > maxObservationTokens ||
      foldedByteLength({ observations: kept, wmItems, droppedObservationIds, fullFold }) > maxPayloadBytes)
  ) {
    const drop = sorted.shift();
    if (!drop) break;
    kept = kept.filter((item) => item.id !== drop.id);
    totalTokens -= drop.tokenCount;
    fullFold = true;
  }
  if (foldedByteLength({ observations: kept, wmItems, droppedObservationIds, fullFold }) > maxPayloadBytes) {
    throw new Error(`Observational memory folded payload exceeds ${maxPayloadBytes} bytes`);
  }
  return { observations: kept, wmItems, droppedObservationIds, fullFold };
}

function foldedByteLength(payload: BoundedMemoryPayload): number {
  return Buffer.byteLength(
    JSON.stringify({
      type: FOLDED_MEMORY,
      version: 2,
      fullFold: payload.fullFold,
      observations: payload.observations,
      wmItems: payload.wmItems,
      droppedObservationIds: payload.droppedObservationIds,
    }),
    "utf8",
  );
}
