import { type Message, type SessionEntry, sessionEntryForkedFrom } from "@arnilo/prism";
import { recordData } from "./ledger.js";
import { estimateEntryTokens } from "./tokens.js";
import { isMemoryObservation, isObservationsRecordedData, isScopeStepData, isWmRecordedData, type MemoryObservation } from "./types.js";

const OBSERVATION_ELIGIBLE_ROLES = new Set<Message["role"]>(["user", "assistant", "tool"]);

export function isEligibleObservationSourceEntry(entry: SessionEntry): boolean {
  if (entry.kind !== "message" || !entry.message) return false;
  return OBSERVATION_ELIGIBLE_ROLES.has(entry.message.role);
}

/**
 * The branch's entries by id, including the ids a fork's copies had in the sessions they were copied from
 * (`sessionEntryForkedFrom`, plan 218.3 Task 4): ledger records written before a fork cite the parent's ids, and resolve
 * to the fork's copies. An entry the fork did not copy (after its fork point) resolves to nothing.
 */
export function entriesById(entries: readonly SessionEntry[]): ReadonlyMap<string, SessionEntry> {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    for (const id of sessionEntryForkedFrom(entry)) if (!byId.has(id)) byId.set(id, entry);
  }
  return byId;
}

/** The index of the entry `id` names on the branch, through a fork's copies too (`entriesById`); `-1` when absent. */
export function entryIndexOf(entries: readonly SessionEntry[], id: string): number {
  return entries.findIndex((entry) => entry.id === id || sessionEntryForkedFrom(entry).includes(id));
}

export function unscannedEntries(entries: readonly SessionEntry[], latestObservationCoverageId?: string): readonly SessionEntry[] {
  const start = latestObservationCoverageId ? entryIndexOf(entries, latestObservationCoverageId) + 1 : 0;
  return entries.slice(Math.max(0, start));
}

export function eligibleObservationSources(unscanned: readonly SessionEntry[]): readonly SessionEntry[] {
  return unscanned.filter(isEligibleObservationSourceEntry);
}

export function eligibleObservationTokenCount(sources: readonly SessionEntry[]): number {
  return sources.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
}

/**
 * The WM batch (plan 218 Task 2): the oldest STM surface records up to `batchTokens` (at least one record), so the
 * verdicts for one batch fit one `judge` call. The rest stays on the surface for the next pass.
 */
export function wmBatch(surface: readonly MemoryObservation[], batchTokens: number): readonly MemoryObservation[] {
  const ordered = [...surface].sort((a, b) => timeOf(a) - timeOf(b));
  const batch: MemoryObservation[] = [];
  let tokens = 0;
  for (const record of ordered) {
    if (batch.length && tokens + record.tokenCount > batchTokens) break;
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
    if (isWmRecordedData(data)) lastAttempt = data.items.length || data.processedIds?.length || data.supersededItemIds?.length ? -1 : index;
    else if (isScopeStepData(data)) lastAttempt = -1;
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
