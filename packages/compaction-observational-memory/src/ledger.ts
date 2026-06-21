import type { SessionEntry } from "prism";
import {
  foldedMemoryFromEntry,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsDroppedData,
  isObservationsRecordedData,
  isReflectionsRecordedData,
  type MemoryObservation,
  type MemoryReflection,
} from "./types.js";

export interface ObservationalMemoryLedger {
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly latestObservationCoverageId?: string;
  readonly latestReflectionCoverageId?: string;
  readonly latestDropCoverageId?: string;
}

export function foldObservationalMemoryLedger(entries: readonly SessionEntry[]): ObservationalMemoryLedger {
  const observations = new Map<string, MemoryObservation>();
  const reflections = new Map<string, MemoryReflection>();
  const dropped = new Set<string>();
  let latestObservationCoverageId: string | undefined;
  let latestReflectionCoverageId: string | undefined;
  let latestDropCoverageId: string | undefined;

  for (const entry of entries) {
    const folded = foldedMemoryFromEntry(entry);
    if (folded) {
      for (const observation of folded.observations) if (isMemoryObservation(observation) && !observations.has(observation.id)) observations.set(observation.id, observation);
      for (const reflection of folded.reflections) if (isMemoryReflection(reflection) && !reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
      for (const id of folded.droppedObservationIds ?? []) dropped.add(id);
    }
    const data = entry.data;
    if (isObservationsRecordedData(data)) {
      for (const observation of data.observations) if (isMemoryObservation(observation) && !observations.has(observation.id)) observations.set(observation.id, observation);
      latestObservationCoverageId = data.coversUpToId ?? latestObservationCoverageId;
    } else if (isReflectionsRecordedData(data)) {
      for (const reflection of data.reflections) if (isMemoryReflection(reflection) && !reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
      latestReflectionCoverageId = data.coversUpToId ?? latestReflectionCoverageId;
    } else if (isObservationsDroppedData(data)) {
      for (const id of data.observationIds) dropped.add(id);
      latestDropCoverageId = data.coversUpToId ?? latestDropCoverageId;
    }
  }

  return {
    observations: [...observations.values()],
    reflections: [...reflections.values()],
    droppedObservationIds: [...dropped],
    latestObservationCoverageId,
    latestReflectionCoverageId,
    latestDropCoverageId,
  };
}

export function activeObservations(ledger: ObservationalMemoryLedger): readonly MemoryObservation[] {
  const dropped = new Set(ledger.droppedObservationIds);
  return ledger.observations.filter((observation) => !dropped.has(observation.id));
}
