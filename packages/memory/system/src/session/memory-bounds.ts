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

/**
 * What eviction compares (plan 218.5 Task 7: STM records and WM items both count against the pool). `user` is the
 * user's side under `protect-user`: a durable record or a user statement; a WM item is never on it.
 */
interface Evictable {
  readonly relevance: MemoryObservation["relevance"];
  readonly tokenCount: number;
  readonly time: number;
  readonly user: boolean;
}
type EvictionCompare = (left: Evictable, right: Evictable) => number;

const timeOf = (value: string | undefined): number => {
  const time = Date.parse(value ?? "");
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
    Number(left.user) - Number(right.user) || relevanceRank[left.relevance] - relevanceRank[right.relevance] || left.time - right.time,
};

/** A WM item eviction leaves for last: a `fact` or one marked `neededLater` (what later steps read). */
const heldItem = (item: MemoryWmItem): boolean => item.kind === "fact" || item.neededLater !== undefined;

export interface BoundedMemoryPayload {
  readonly observations: readonly MemoryObservation[];
  readonly wmItems: readonly MemoryWmItem[];
  readonly droppedObservationIds: readonly string[];
  readonly fullFold: boolean;
}

/**
 * Bound the block to `maxTokens`. Plan 218.5 Task 7: WM items count against the same pool as the STM records, so a
 * WM arm's block is bounded as STM's is (deterministic WM's one-item-per-record kept growing to 20K rendered tokens in a
 * 150-task session). Over the bound, STM records and WM items are left out together in the eviction order; WM facts and
 * items marked `neededLater` go last. Left-out items stay in the ledger, where `recall` reads them.
 */
export function boundMemoryPayload(
  observations: readonly MemoryObservation[],
  wmItems: readonly MemoryWmItem[],
  droppedObservationIds: readonly string[],
  maxTokens: number,
  maxPayloadBytes: number,
  eviction: MemorySystemEviction = "relevance",
): BoundedMemoryPayload {
  let kept = [...observations];
  let items = [...wmItems];
  let totalTokens = [...kept, ...items].reduce((sum, item) => sum + item.tokenCount, 0);
  let fullFold = totalTokens > maxTokens;
  const order = EVICTION_ORDER[eviction];
  const candidates = [
    ...kept.map((record) => ({
      id: record.id,
      item: false,
      held: false,
      value: {
        relevance: record.relevance,
        tokenCount: record.tokenCount,
        time: timeOf(record.observedAt ?? record.timestamp),
        user: isDurableOrUserStatement(record),
      },
    })),
    ...items.map((item) => ({
      id: item.id,
      item: true,
      held: heldItem(item),
      value: { relevance: item.relevance, tokenCount: item.tokenCount, time: timeOf(item.observedTo), user: false },
    })),
  ].sort((a, b) => Number(a.held) - Number(b.held) || order(a.value, b.value));
  while (
    (kept.length || items.length) &&
    (totalTokens > maxTokens || foldedByteLength({ observations: kept, wmItems: items, droppedObservationIds, fullFold }) > maxPayloadBytes)
  ) {
    const drop = candidates.shift();
    if (!drop) break;
    if (drop.item) items = items.filter((item) => item.id !== drop.id);
    else kept = kept.filter((item) => item.id !== drop.id);
    totalTokens -= drop.value.tokenCount;
    fullFold = true;
  }
  if (foldedByteLength({ observations: kept, wmItems: items, droppedObservationIds, fullFold }) > maxPayloadBytes) {
    throw new Error(`Observational memory folded payload exceeds ${maxPayloadBytes} bytes`);
  }
  return { observations: kept, wmItems: items, droppedObservationIds, fullFold };
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
