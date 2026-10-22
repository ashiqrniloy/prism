import type { SessionEntry } from "@arnilo/prism";
import {
  isTaskStateRecordedData,
  type MemoryTaskState,
  type TaskStateRecordedData,
  foldedMemoryFromEntry,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsDroppedData,
  isObservationsRecordedData,
  isReflectionsRecordedData,
  type MemoryObservation,
  type MemoryReflection,
  type ObservationsDroppedData,
  type ObservationsRecordedData,
  type ReflectionsRecordedData,
} from "./types.js";

export interface ObservationalMemoryLedger {
  readonly taskState?: MemoryTaskState;
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  readonly consumedObservationIds?: readonly string[];
  readonly supersededReflectionIds?: readonly string[];
  readonly latestObservationCoverageId?: string;
  readonly latestReflectionCoverageId?: string;
  readonly latestDropCoverageId?: string;
}

/** The three ledger records a worker appends. A package keeps them in its session log. */
export type ObservationalMemoryRecord =
  | TaskStateRecordedData
  | ObservationsRecordedData
  | ReflectionsRecordedData
  | ObservationsDroppedData;

/**
 * A branch entry (0.12 attach path, folded memory on a compaction entry) or a bare ledger record (a
 * package's session log). The fold reads both, so one ledger shape serves either storage. Anything
 * else is skipped.
 */
export type ObservationalMemoryLedgerSource = SessionEntry | ObservationalMemoryRecord;

export function foldObservationalMemoryLedger(sources: readonly unknown[]): ObservationalMemoryLedger {
  const observations = new Map<string, MemoryObservation>();
  const reflections = new Map<string, MemoryReflection>();
  const dropped = new Set<string>();
  const consumed = new Set<string>();
  const superseded = new Set<string>();
  let taskState: MemoryTaskState | undefined;
  let latestObservationCoverageId: string | undefined;
  let latestReflectionCoverageId: string | undefined;
  let latestDropCoverageId: string | undefined;

  for (const source of sources) {
    if (isSessionEntry(source)) {
      const folded = foldedMemoryFromEntry(source);
      if (folded) {
        for (const observation of folded.observations)
          if (isMemoryObservation(observation) && !observations.has(observation.id)) observations.set(observation.id, observation);
        for (const reflection of folded.reflections)
          if (isMemoryReflection(reflection) && !reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
        for (const id of folded.droppedObservationIds ?? []) dropped.add(id);
      }
    }
    const data = recordData(source);
    if (isTaskStateRecordedData(data)) {
      taskState = data.taskState;
    } else if (isObservationsRecordedData(data)) {
      for (const observation of data.observations)
        if (isMemoryObservation(observation) && !observations.has(observation.id)) observations.set(observation.id, observation);
      latestObservationCoverageId = data.coversUpToId ?? latestObservationCoverageId;
    } else if (isReflectionsRecordedData(data)) {
      for (const reflection of data.reflections)
        if (isMemoryReflection(reflection) && !reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
      if (data.reflections.some(isMemoryReflection)) {
        for (const id of data.consumedObservationIds ?? []) consumed.add(id);
        for (const id of data.supersededReflectionIds ?? []) superseded.add(id);
        for (const reflection of data.reflections) if (isMemoryReflection(reflection)) superseded.delete(reflection.id);
      }
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
    consumedObservationIds: [...consumed],
    supersededReflectionIds: [...superseded],
    ...(taskState ? { taskState } : {}),
    latestObservationCoverageId,
    latestReflectionCoverageId,
    latestDropCoverageId,
  };
}

/**
 * A session entry carries its payload under `data`; a log record is the payload.
 *
 * A package keeps its ledger in `state.log`, so a branch fold meets those records as `package_state`
 * entries whose payload is `data.value`. Reading the payload is what lets a consumer that only has the
 * branch (the memory fabric, a host's own projection) see the same ledger `SessionLog.entries` returns.
 */
export function recordData(source: unknown): unknown {
  if (!isSessionEntry(source)) return source;
  return isAppendedStateData(source.data) ? source.data.value : source.data;
}

/** True for the `data` of a `package_state` entry written by `SessionLog.append`. */
function isAppendedStateData(data: unknown): data is { readonly value: unknown } {
  if (typeof data !== "object" || data === null) return false;
  return (data as { readonly op?: unknown }).op === "append" && "value" in data;
}

function isSessionEntry(source: unknown): source is SessionEntry {
  if (typeof source !== "object" || source === null) return false;
  return typeof (source as SessionEntry).kind === "string" && typeof (source as SessionEntry).id === "string";
}

export function activeObservations(ledger: ObservationalMemoryLedger): readonly MemoryObservation[] {
  const dropped = new Set([...ledger.droppedObservationIds, ...(ledger.consumedObservationIds ?? [])]);
  return ledger.observations.filter((observation) => !dropped.has(observation.id));
}

/**
 * Union id-keyed ledgers (local + shared branches). Coverage cursors and drop cursors are per branch
 * and are not merged; read-only consumers never use them.
 */
export function mergeObservationalMemoryLedgers(...ledgers: readonly ObservationalMemoryLedger[]): ObservationalMemoryLedger {
  const observations = new Map<string, MemoryObservation>();
  const reflections = new Map<string, MemoryReflection>();
  const dropped = new Set<string>();
  const consumed = new Set<string>();
  const superseded = new Set<string>();
  for (const ledger of ledgers) {
    for (const observation of ledger.observations) if (!observations.has(observation.id)) observations.set(observation.id, observation);
    for (const reflection of ledger.reflections) if (!reflections.has(reflection.id)) reflections.set(reflection.id, reflection);
    for (const id of ledger.droppedObservationIds) dropped.add(id);
    for (const id of ledger.consumedObservationIds ?? []) consumed.add(id);
    for (const id of ledger.supersededReflectionIds ?? []) superseded.add(id);
  }
  return {
    observations: [...observations.values()],
    reflections: [...reflections.values()],
    droppedObservationIds: [...dropped],
    consumedObservationIds: [...consumed],
    supersededReflectionIds: [...superseded],
    ...(ledgers[0]?.taskState ? { taskState: ledgers[0].taskState } : {}),
  };
}

export function observationBlockedByInvalidation(
  observation: Pick<MemoryObservation, "id" | "sourceEntryIds">,
  invalidated: ReadonlySet<string>,
): boolean {
  if (invalidated.has(observation.id)) return true;
  return observation.sourceEntryIds.some((id) => invalidated.has(id));
}

export function reflectionBlockedByInvalidation(
  reflection: Pick<MemoryReflection, "id" | "supportingObservationIds">,
  invalidated: ReadonlySet<string>,
): boolean {
  if (invalidated.has(reflection.id)) return true;
  return reflection.supportingObservationIds.some((id) => invalidated.has(id));
}

export function activeReflections(ledger: ObservationalMemoryLedger): readonly MemoryReflection[] {
  const superseded = new Set(ledger.supersededReflectionIds ?? []);
  return ledger.reflections.filter((reflection) => !superseded.has(reflection.id));
}
