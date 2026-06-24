import type { SessionEntry } from "@arnilo/prism";
import { activeObservations, foldObservationalMemoryLedger, type ObservationalMemoryLedger } from "./ledger.js";
import { FOLDED_MEMORY, foldedMemoryFromEntry, isMemoryObservation, isMemoryReflection, type FoldedMemoryDetails, type MemoryObservation, type MemoryReflection } from "./types.js";

export interface ObservationalMemoryProjection {
  readonly full: ObservationalMemoryLedger;
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly folded?: FoldedMemoryDetails;
}

export function buildObservationalMemoryProjection(entries: readonly SessionEntry[], firstKeptEntryId?: string): ObservationalMemoryProjection {
  const boundary = firstKeptEntryId ? entries.findIndex((entry) => entry.id === firstKeptEntryId) : -1;
  const visibleEntries = boundary >= 0 ? entries.slice(0, boundary) : entries;
  const latestFolded = boundary < 0 ? latestFoldedMemory(entries) : undefined;
  const full = foldObservationalMemoryLedger(entries);
  const visible = latestFolded ? foldFromDetails(latestFolded) : foldObservationalMemoryLedger(visibleEntries);
  return {
    full,
    observations: activeObservations(visible),
    reflections: visible.reflections,
    droppedObservationIds: visible.droppedObservationIds,
    folded: latestFolded,
  };
}

export function createFoldedMemoryDetails(projection: Pick<ObservationalMemoryProjection, "observations" | "reflections" | "droppedObservationIds">, fullFold = false): FoldedMemoryDetails {
  return {
    type: FOLDED_MEMORY,
    version: 1,
    fullFold,
    observations: projection.observations,
    reflections: projection.reflections,
    droppedObservationIds: projection.droppedObservationIds,
  };
}

function latestFoldedMemory(entries: readonly SessionEntry[]): FoldedMemoryDetails | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const folded = foldedMemoryFromEntry(entries[index]!);
    if (folded) return folded;
  }
  return undefined;
}

function foldFromDetails(details: FoldedMemoryDetails): ObservationalMemoryLedger {
  return {
    observations: details.observations.filter(isMemoryObservation),
    reflections: details.reflections.filter(isMemoryReflection),
    droppedObservationIds: (details.droppedObservationIds ?? []).filter((id): id is string => typeof id === "string"),
  };
}
