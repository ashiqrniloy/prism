import type { Message, SessionEntry } from "@arnilo/prism";
import { activeObservations, type ObservationalMemoryLedger } from "./ledger.js";
import { estimateEntryTokens } from "./tokens.js";
import { isMemoryObservation, isObservationsRecordedData, isReflectionsRecordedData, type MemoryObservation } from "./types.js";

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

export function observationsUncoveredByReflection(
  entries: readonly SessionEntry[],
  ledger: ObservationalMemoryLedger,
  fullRebuild = false,
): readonly MemoryObservation[] {
  const active = activeObservations(ledger);
  if (fullRebuild) return active;

  let lastReflectionEntryIndex = -1;
  for (let index = 0; index < entries.length; index++) {
    if (isReflectionsRecordedData(entries[index]?.data)) lastReflectionEntryIndex = index;
  }
  if (lastReflectionEntryIndex < 0) return active;

  const uncoveredIds = new Set<string>();
  for (let index = lastReflectionEntryIndex + 1; index < entries.length; index++) {
    const data = entries[index]?.data;
    if (!isObservationsRecordedData(data)) continue;
    for (const observation of data.observations) {
      if (isMemoryObservation(observation)) uncoveredIds.add(observation.id);
    }
  }
  return active.filter((observation) => uncoveredIds.has(observation.id));
}
