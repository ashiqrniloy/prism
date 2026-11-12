import type { Message, SessionEntry } from "@arnilo/prism";
import { recordData } from "./ledger.js";
import { estimateEntryTokens } from "./tokens.js";
import { isMemoryObservation, isObservationsRecordedData, isWmRecordedData, type MemoryObservation } from "./types.js";

const OBSERVATION_ELIGIBLE_ROLES = new Set<Message["role"]>(["user", "assistant", "tool"]);

export function isEligibleObservationSourceEntry(entry: SessionEntry): boolean {
  if (entry.kind !== "message" || !entry.message) return false;
  return OBSERVATION_ELIGIBLE_ROLES.has(entry.message.role);
}

export function unscannedEntries(entries: readonly SessionEntry[], latestObservationCoverageId?: string): readonly SessionEntry[] {
  const start = latestObservationCoverageId ? entries.findIndex((entry) => entry.id === latestObservationCoverageId) + 1 : 0;
  return entries.slice(Math.max(0, start));
}

export function eligibleObservationSources(unscanned: readonly SessionEntry[]): readonly SessionEntry[] {
  return unscanned.filter(isEligibleObservationSourceEntry);
}

export function eligibleObservationTokenCount(sources: readonly SessionEntry[]): number {
  return sources.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
}

/**
 * The WM batch (plan 218 Task 2): the oldest STM surface records up to `batchTokens` (at least one record, at most
 * `maxRecords`), so the verdicts for one batch fit one model's output. The rest stays on the surface for the next pass.
 */
export function wmBatch(surface: readonly MemoryObservation[], batchTokens: number, maxRecords: number): readonly MemoryObservation[] {
  const ordered = [...surface].sort((a, b) => timeOf(a) - timeOf(b));
  const batch: MemoryObservation[] = [];
  let tokens = 0;
  for (const record of ordered) {
    if (batch.length && (tokens + record.tokenCount > batchTokens || batch.length >= maxRecords)) break;
    batch.push(record);
    tokens += record.tokenCount;
  }
  return batch;
}

function timeOf(record: MemoryObservation): number {
  const time = Date.parse(record.observedAt ?? record.timestamp);
  return Number.isFinite(time) ? time : 0;
}

/**
 * Tokens of STM records recorded since the last working-memory attempt that did nothing (a `wm.recorded` record with
 * no item and no processed record: the model gave no verdict, or the pass failed). `undefined` when the last attempt did
 * something or there was none. Plan 217 Task 6 (gate M-1 sitting 2): WM then waits for a fresh trigger's worth of
 * records instead of re-running over the same ones every pass.
 */
export function observationTokensSinceEmptyWmAttempt(sources: readonly unknown[]): number | undefined {
  let lastAttempt = -1;
  for (let index = 0; index < sources.length; index++) {
    const data = recordData(sources[index]!);
    if (isWmRecordedData(data)) lastAttempt = data.items.length || data.processedIds?.length ? -1 : index;
  }
  if (lastAttempt < 0) return undefined;
  let tokens = 0;
  for (let index = lastAttempt + 1; index < sources.length; index++) {
    const data = recordData(sources[index]!);
    if (!isObservationsRecordedData(data)) continue;
    for (const observation of data.observations) if (isMemoryObservation(observation)) tokens += observation.tokenCount;
  }
  return tokens;
}
