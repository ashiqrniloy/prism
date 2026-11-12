import type { SessionEntry } from "@arnilo/prism";
import {
  activeObservations,
  activeWmItems,
  foldObservationalMemoryLedger,
  type ObservationalMemoryLedger,
  observationBlockedByInvalidation,
  wmItemBlockedByInvalidation,
} from "./ledger.js";
import {
  FOLDED_MEMORY,
  type FoldedMemoryDetails,
  foldedMemoryFromEntry,
  isMemoryObservation,
  isMemoryWmItem,
  type MemoryObservation,
  type MemoryTaskState,
  type MemoryWmItem,
} from "./types.js";

export interface ObservationalMemoryProjection {
  readonly taskState?: MemoryTaskState;
  readonly full: ObservationalMemoryLedger;
  readonly observations: readonly MemoryObservation[];
  readonly wmItems: readonly MemoryWmItem[];
  readonly droppedObservationIds: readonly string[];
  readonly folded?: FoldedMemoryDetails;
}

export function buildObservationalMemoryProjection(
  entries: readonly SessionEntry[],
  firstKeptEntryId?: string,
  options?: { readonly invalidatedIds?: readonly string[] },
): ObservationalMemoryProjection {
  const boundary = firstKeptEntryId ? entries.findIndex((entry) => entry.id === firstKeptEntryId) : -1;
  const visibleEntries = boundary >= 0 ? entries.slice(0, boundary) : entries;
  const latestFolded = boundary < 0 ? latestFoldedMemory(entries) : undefined;
  const full = foldObservationalMemoryLedger(entries);
  const visible = latestFolded ? foldFromDetails(latestFolded) : foldObservationalMemoryLedger(visibleEntries);
  const invalidated = new Set(options?.invalidatedIds ?? []);
  const extraDropped = full.observations
    .filter((observation) => observationBlockedByInvalidation(observation, invalidated))
    .map((observation) => observation.id);
  const droppedObservationIds = Object.freeze([...new Set([...visible.droppedObservationIds, ...extraDropped])]);
  for (const id of extraDropped) invalidated.add(id);
  return {
    full,
    ...(full.taskState ? { taskState: full.taskState } : {}),
    observations: activeObservations({ ...visible, droppedObservationIds }),
    wmItems: activeWmItems(visible).filter((item) => !wmItemBlockedByInvalidation(item, invalidated)),
    droppedObservationIds,
    folded: latestFolded,
  };
}

export function createFoldedMemoryDetails(
  projection: Pick<ObservationalMemoryProjection, "observations" | "wmItems" | "droppedObservationIds">,
  fullFold = false,
): FoldedMemoryDetails {
  return {
    type: FOLDED_MEMORY,
    version: 2,
    fullFold,
    observations: projection.observations,
    wmItems: projection.wmItems,
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
    wmItems: details.wmItems.filter(isMemoryWmItem),
    droppedObservationIds: (details.droppedObservationIds ?? []).filter((id): id is string => typeof id === "string"),
  };
}
