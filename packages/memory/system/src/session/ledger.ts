import type { SessionEntry } from "@arnilo/prism";
import {
  assertNotRetiredLedgerRecord,
  type BoundaryRecordedData,
  foldedMemoryFromEntry,
  isBoundaryRecordedData,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsDroppedData,
  isObservationsRecordedData,
  isObservationsRepeatedData,
  isObservationsTombstonedData,
  isReflectionsRecordedData,
  isTaskStateRecordedData,
  type MemoryBoundary,
  type MemoryObservation,
  type MemoryReflection,
  type MemoryTaskState,
  type MemoryTombstone,
  type ObservationsDroppedData,
  type ObservationsRecordedData,
  type ObservationsRepeatedData,
  type ObservationsTombstonedData,
  type ReflectionsRecordedData,
  type TaskStateRecordedData,
} from "./types.js";

export interface ObservationalMemoryLedger {
  readonly taskState?: MemoryTaskState;
  readonly observations: readonly MemoryObservation[];
  readonly reflections: readonly MemoryReflection[];
  readonly droppedObservationIds: readonly string[];
  /** Why each dropped record left: `superseded by <id>`, or `dropped` (rehearsal or compaction). Read by `recall`. */
  readonly dropReasons?: Readonly<Record<string, string>>;
  /** Records whose surface was removed (plan 218's WM), by id. They leave the active set; `recall` still finds them. */
  readonly tombstones?: Readonly<Record<string, MemoryTombstone>>;
  /** Event boundary markers in ledger order, one per `(reason, entryId)` (plan 217 Task 3; plan 218's WM trigger reads them). */
  readonly boundaries?: readonly MemoryBoundary[];
  readonly consumedObservationIds?: readonly string[];
  readonly supersededReflectionIds?: readonly string[];
  readonly latestObservationCoverageId?: string;
  readonly latestReflectionCoverageId?: string;
  readonly latestDropCoverageId?: string;
}

/** The ledger records a pass appends. A package keeps them in its session log. */
export type ObservationalMemoryRecord =
  | TaskStateRecordedData
  | ObservationsRecordedData
  | ObservationsRepeatedData
  | ReflectionsRecordedData
  | ObservationsDroppedData
  | ObservationsTombstonedData
  | BoundaryRecordedData;

/** The key that makes a boundary marker unique: one marker per reason and branch entry. */
export function boundaryKey(boundary: Pick<MemoryBoundary, "reason" | "entryId">): string {
  return `${boundary.reason}:${boundary.entryId}`;
}

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
  const repeats = new Map<string, { count: number; lastAt?: string }>();
  const boundaries = new Map<string, MemoryBoundary>();
  const dropReasons: Record<string, string> = {};
  const tombstones: Record<string, MemoryTombstone> = {};
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
    assertNotRetiredLedgerRecord(data);
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
      for (const id of data.observationIds) {
        dropped.add(id);
        dropReasons[id] ??= data.reason === "superseded" && data.supersededBy ? `superseded by ${data.supersededBy}` : "dropped";
      }
      latestDropCoverageId = data.coversUpToId ?? latestDropCoverageId;
    } else if (isObservationsRepeatedData(data)) {
      const seen = repeats.get(data.observationId);
      repeats.set(data.observationId, {
        count: Math.max(seen?.count ?? 1, data.count),
        lastAt: laterTime(seen?.lastAt, data.lastAt),
      });
    } else if (isObservationsTombstonedData(data)) {
      for (const id of data.observationIds) tombstones[id] ??= { reason: data.reason, at: data.at };
    } else if (isBoundaryRecordedData(data)) {
      const { type: _type, ...boundary } = data;
      if (!boundaries.has(boundaryKey(boundary))) boundaries.set(boundaryKey(boundary), boundary);
    }
  }

  // Habituation: a repeat carries the event's absolute count, so the fold takes the largest one seen.
  for (const [id, repeat] of repeats) {
    const observation = observations.get(id);
    if (!observation) continue;
    const lastAt = laterTime(observation.lastAt ?? observation.observedAt, repeat.lastAt);
    observations.set(id, {
      ...observation,
      count: Math.max(observation.count ?? 1, repeat.count),
      ...(lastAt === undefined ? {} : { lastAt }),
    });
  }

  return {
    observations: [...observations.values()],
    ...(boundaries.size ? { boundaries: [...boundaries.values()] } : {}),
    reflections: [...reflections.values()],
    droppedObservationIds: [...dropped],
    ...(Object.keys(dropReasons).length ? { dropReasons } : {}),
    ...(Object.keys(tombstones).length ? { tombstones } : {}),
    consumedObservationIds: [...consumed],
    supersededReflectionIds: [...superseded],
    ...(taskState ? { taskState } : {}),
    latestObservationCoverageId,
    latestReflectionCoverageId,
    latestDropCoverageId,
  };
}

function laterTime(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
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
  const tombstones = ledger.tombstones ?? {};
  return ledger.observations.filter((observation) => !dropped.has(observation.id) && !Object.hasOwn(tombstones, observation.id));
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
