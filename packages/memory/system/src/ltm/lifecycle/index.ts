/**
 * The one note lifecycle (plan 188.4 Task 1): status, use events, evidence, and the retirement of
 * the second lifecycle the scoped ledger used to keep.
 *
 * A note earns its place by being used across separate sessions. A citation of an id the session
 * was shown is a use; a retrieval that nobody cites is not. Outcome tags count helpful evidence, and
 * a user correction that cites the note counts harmful evidence and reopens it for reconsolidation.
 */
import type { JsonObject } from "@arnilo/prism";
import { type Memory, MemoryValidationError, type MemoryVectorRecord } from "@arnilo/prism-memory-core";
import type { FabricNoteCensus } from "../promote.js";
import { encodeMemoryNoteMetadata, MEMORY_NOTE_METADATA_KEY, type MemoryNoteMetadata, parseMemoryNoteMetadata } from "../types.js";
import { appendCoReadEvent, appendUseEvent, MAX_CO_READ_WITH, type MemoryNoteUseEvent } from "./events.js";
import { type MemoryNoteStatus, normalizeNoteStatus } from "./status.js";

export type { ArchiveConfig, ArchiveDecisionOptions } from "./archive.js";
export {
  ARCHIVE_SEARCH_COVERAGE,
  DEFAULT_ARCHIVE_CONFIG,
  MAX_ARCHIVE_BELOW,
  MAX_ARCHIVED_HITS,
  MAX_GRACE_SESSIONS,
  shouldArchive,
} from "./archive.js";
export type { CapacityLimits, CapacityNote, CapacityUsage, ExchangeCapacityLimits } from "./capacity.js";
export {
  capacityForLevel,
  capacityUsage,
  DEFAULT_CAPACITY,
  DEFAULT_EXCHANGE_CAPACITY,
  evictionOrder,
  exchangeDemotionOrder,
  MAX_FABRIC_CAPACITY_NOTES,
  MAX_FABRIC_CAPACITY_TOKENS,
  overCapacity,
} from "./capacity.js";
export {
  createScopeClock,
  readScopeClockState,
  SCOPE_CLOCK_COUNTER,
  type ScopeClock,
  type ScopeClockSessionState,
  type ScopeClockTick,
} from "./clock.js";
export {
  appendCoReadEvent,
  appendUseEvent,
  MAX_CO_READ_EVENTS,
  MAX_CO_READ_WITH,
  MAX_USE_EVENTS,
  type MemoryNoteCoReadEvent,
  type MemoryNoteUseEvent,
  readCoReadEvents,
  readUseEvents,
} from "./events.js";
export type { InspectNoteInput, LifecycleDecisionView, LifecycleNoteView } from "./inspect.js";
export { describeNote, inspectNote } from "./inspect.js";
export type { DuplicateGroup } from "./merge.js";
export { DEFAULT_DUPLICATE_DICE, duplicateGroups, MAX_DUPLICATE_DICE, MIN_DUPLICATE_DICE, mergedMetadata } from "./merge.js";
export type { ActiveNoteOptions, MemoryNoteStatus } from "./status.js";
export { isActiveNote, isMemoryNoteStatus, normalizeNoteStatus } from "./status.js";
export {
  DEFAULT_DECAY,
  DEFAULT_STORAGE_WEIGHTS,
  DEFAULT_STRENGTH_WEIGHTS,
  logistic,
  MAX_STORAGE_WEIGHT,
  MAX_STRENGTH_WEIGHT,
  type MemoryNoteDecay,
  noteImportance,
  retrievalStrength,
  type StorageWeights,
  type StrengthPriorOptions,
  type StrengthWeights,
  storageStrength,
  strengthPrior,
} from "./strength.js";

/** Distinct sessions a candidate must be used in before it is verified. */
export const DEFAULT_VERIFY_AFTER_SESSIONS = 2;
/** The hard cap keeps a misconfigured threshold from making a candidate unverifiable. */
export const HARD_VERIFY_AFTER_SESSIONS = 100;

const MAX_EXPORT_PAGES = 10_000;

/** What one use-recording call needs; the scope clock arrives with plan 188.4 Task 2. */
export interface ArchiveNoteOptions {
  readonly now?: number;
  /** The survivor's id when a capacity merge archived this note. */
  readonly mergedInto?: string;
  /** Audit-log verb; merges and evictions name themselves. */
  readonly auditVerb?: string;
  readonly signal?: AbortSignal;
}

export interface RecordUsesOptions {
  /** Scope-session ordinal written into the use log. */
  readonly clock?: number;
  readonly verifyAfterSessions?: number;
  readonly now?: number;
  readonly signal?: AbortSignal;
}

/** One answering turn's cited set: the ids and the session's turn index. */
export interface CoReadSet {
  readonly ids: readonly string[];
  readonly turn: number;
}

export interface RecordCoReadOptions {
  /** Scope-session ordinal written into the event. */
  readonly clock?: number;
  readonly signal?: AbortSignal;
}

/** Evidence a finished turn carries: outcome tags and the notes a user correction cited. */
export interface LifecycleEvidence {
  readonly helpful?: readonly string[];
  readonly harmful?: readonly string[];
}

export interface FabricLifecycle {
  /** Confirm a candidate. False when the note is missing, blocked, or not a candidate. */
  verify(id: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  /**
   * Record at most one use per session per note, and verify a candidate that reaches
   * `verifyAfterSessions` distinct sessions with no harmful evidence. Returns the ids it verified.
   */
  recordUses(sessionKey: string, ids: readonly string[], options?: RecordUsesOptions): Promise<readonly string[]>;
  /**
   * Record the answering turns that cited two or more notes together (plan 207 Task 4). Each note keeps the other
   * ids and the turn index, never text. Only readable notes take part.
   * Metadata-only, no model call.
   */
  recordCoReads(events: readonly CoReadSet[], options?: RecordCoReadOptions): Promise<number>;
  /** Add the diagnostic retrieval counts; never touches status or either strength. */
  recordRetrievals(counts: Readonly<Record<string, number>>, options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Count helpful evidence, and harmful evidence that reopens a verified note for reconsolidation. */
  recordEvidence(
    evidence: LifecycleEvidence,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly helpful: number; readonly harmful: number }>;
  /**
   * Archive one note: status `archived`, `archivedAt`, and the status to revive to. Never sets
   * `validTo`. `mergedInto` records the survivor when a capacity merge archived it.
   */
  archive(id: string, options?: ArchiveNoteOptions): Promise<boolean>;
  /**
   * Supersede one note: `validTo` set, status `retired`, logged. Narrowing does this when enough
   * projects contradict a wider note; archive never sets `validTo`.
   */
  supersede(id: string, options?: { readonly now?: number; readonly signal?: AbortSignal }): Promise<boolean>;
  /** Replace the note's lifecycle metadata with `next` (the survivor of a capacity merge). */
  mergeMetadata(id: string, next: MemoryNoteMetadata, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  /** Pin or unpin a note: a pinned note is never archived or evicted. */
  pin(id: string, pinned?: boolean, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  census(signal?: AbortSignal): Promise<FabricNoteCensus>;
  retireNote(id: string, validTo: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
  handleSupersededReflections(
    supersededReflectionIds: ReadonlySet<string>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly supersededNotes: Map<string, MemoryVectorRecord>; readonly reconsolidated: string[] }>;
  reconsolidating(options?: { readonly signal?: AbortSignal }): Promise<readonly MemoryVectorRecord[]>;
}

async function* exportedRecords(memory: Memory, signal?: AbortSignal): AsyncGenerator<MemoryVectorRecord> {
  const threadId = memory.scope.threadId;
  if (!threadId) throw new MemoryValidationError("threadId");
  const identity = { tenantId: memory.scope.tenantId, resourceId: memory.scope.resourceId, threadId };
  let cursor: string | undefined;
  for (let n = 0; n < MAX_EXPORT_PAGES; n++) {
    const page = await memory.exportMemory({ identity, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) });
    yield* page.entries;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

/** The fabric fields of a note with `patch` applied; an explicit `undefined` removes a field. */
function evolve(note: MemoryNoteMetadata, patch: Readonly<Record<string, unknown>>): JsonObject {
  const merged: Record<string, unknown> = { ...note, ...patch };
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  const { v: _v, status: _status, generated: _generated, ...fields } = merged;
  return encodeMemoryNoteMetadata(fields as Omit<MemoryNoteMetadata, "v">);
}

/** Metadata-only lifecycle changes: they never re-embed, so verification and archiving cost no model call. */
export function createFabricLifecycle(memory: Memory): FabricLifecycle {
  const statusOf = (record: MemoryVectorRecord): MemoryNoteStatus | undefined =>
    parseMemoryNoteMetadata(record.metadata) === undefined
      ? undefined
      : normalizeNoteStatus(record.metadata?.status as string | undefined, "verified");

  /** One patch per note: `next` returns undefined to leave the row alone. */
  async function patch(
    record: MemoryVectorRecord,
    next:
      | ((
          note: MemoryNoteMetadata,
        ) => { readonly fabric: JsonObject; readonly status?: MemoryNoteStatus; readonly auditVerb?: string } | undefined)
      | undefined,
    options: { readonly signal?: AbortSignal },
  ): Promise<boolean> {
    if (next === undefined) return false;
    const note = parseMemoryNoteMetadata(record.metadata);
    if (note === undefined) return false;
    const change = next(note);
    if (change === undefined) return false;
    // A note with no stored status stays that way: `undefined` means verified, never a new key.
    const status = change.status ?? (record.metadata?.status as string | undefined);
    return memory.patchMetadata(
      record.id,
      (metadata) => ({
        ...metadata,
        ...(status === undefined ? {} : { status }),
        ...(change.auditVerb === undefined ? {} : { auditVerb: change.auditVerb }),
        [MEMORY_NOTE_METADATA_KEY]: change.fabric,
      }),
      options,
    );
  }

  async function verify(id: string, options: { readonly signal?: AbortSignal } = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record || statusOf(record) !== "candidate") return false;
    return patch(
      record,
      (note) => ({
        fabric: evolve(note, {
          reconsolidate: undefined,
          ...(note.kind === "decision" ? { decisionStatus: "active" as const } : {}),
        }),
        status: "verified",
      }),
      options,
    );
  }

  async function recordUses(sessionKey: string, ids: readonly string[], options: RecordUsesOptions = {}): Promise<readonly string[]> {
    if (ids.length === 0 || sessionKey.length === 0) return [];
    const threshold = options.verifyAfterSessions ?? DEFAULT_VERIFY_AFTER_SESSIONS;
    const at = new Date(options.now ?? Date.now()).toISOString();
    const clock = options.clock ?? 0;
    const verified: string[] = [];
    for (const record of await memory.get([...new Set(ids)], options)) {
      const status = statusOf(record);
      if (status !== "candidate" && status !== "verified" && status !== "archived") continue;
      // Citing an archived note is what revives it: the citation is evidence it was needed after all.
      const revived = status === "archived" ? (parseMemoryNoteMetadata(record.metadata)?.archivedFrom ?? "verified") : undefined;
      let promotes = false;
      const changed = await patch(
        record,
        (note) => {
          // One use per session per note: the session key is the dedupe that survives a restart.
          if (note.lastSession === sessionKey) return undefined;
          const useSessions = (note.useSessions ?? 0) + 1;
          promotes = status === "candidate" && useSessions >= threshold && (note.harmful ?? 0) === 0;
          return {
            fabric: evolve(note, {
              uses: appendUseEvent(note.uses ?? [], { s: clock, at } satisfies MemoryNoteUseEvent),
              useSessions,
              lastSession: sessionKey,
              ...(promotes && note.kind === "decision" ? { decisionStatus: "active" as const } : {}),
              ...(revived === undefined ? {} : { archivedAt: undefined, archivedFrom: undefined }),
            }),
            status: promotes ? "verified" : (revived ?? status),
            ...(revived === undefined ? {} : { auditVerb: "revived" }),
          };
        },
        options,
      );
      if (changed && promotes) verified.push(record.id);
    }
    return verified;
  }

  async function recordCoReads(events: readonly CoReadSet[], options: RecordCoReadOptions = {}): Promise<number> {
    let recorded = 0;
    for (const event of events) {
      const ids = [...new Set(event.ids)];
      if (ids.length < 2) continue;
      const records = await memory.get(ids, options);
      // An unreadable note takes no part: the signal is evidence read together.
      const evidence = records.filter((record) => parseMemoryNoteMetadata(record.metadata)?.kind !== undefined);
      if (evidence.length < 2) continue;
      for (const record of evidence) {
        const others = evidence
          .filter((other) => other.id !== record.id)
          .map((other) => other.id)
          .slice(0, MAX_CO_READ_WITH);
        const changed = await patch(
          record,
          (note) => ({
            fabric: evolve(note, {
              coRead: appendCoReadEvent(note.coRead ?? [], { s: options.clock ?? 0, t: event.turn, with: others }),
            }),
          }),
          options,
        );
        if (changed) recorded += 1;
      }
    }
    return recorded;
  }

  async function recordRetrievals(
    counts: Readonly<Record<string, number>>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    for (const [id, count] of Object.entries(counts)) {
      if (!Number.isSafeInteger(count) || count <= 0) continue;
      const [record] = await memory.get([id], options);
      if (!record) continue;
      await patch(record, (note) => ({ fabric: evolve(note, { retrievals: (note.retrievals ?? 0) + count }) }), options);
    }
  }

  async function recordEvidence(
    evidence: LifecycleEvidence,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly helpful: number; readonly harmful: number }> {
    const helpfulIds = [...new Set(evidence.helpful ?? [])];
    const harmfulIds = [...new Set(evidence.harmful ?? [])];
    const ids = [...new Set([...helpfulIds, ...harmfulIds])];
    let helpful = 0;
    let harmful = 0;
    if (ids.length === 0) return { helpful, harmful };
    for (const record of await memory.get(ids, options)) {
      const isHelpful = helpfulIds.includes(record.id);
      const isHarmful = harmfulIds.includes(record.id);
      const changed = await patch(
        record,
        (note) => ({
          fabric: evolve(note, {
            ...(isHelpful ? { helpful: (note.helpful ?? 0) + 1 } : {}),
            ...(isHarmful ? { harmful: (note.harmful ?? 0) + 1, reconsolidate: true } : {}),
          }),
          // A corrected verified note returns to candidate; helpful evidence never lifts harmful.
          ...(isHarmful && statusOf(record) === "verified" ? { status: "candidate" as const } : {}),
        }),
        options,
      );
      if (!changed) continue;
      if (isHelpful) helpful += 1;
      if (isHarmful) harmful += 1;
    }
    return { helpful, harmful };
  }

  async function archive(id: string, options: ArchiveNoteOptions = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record) return false;
    const status = statusOf(record);
    if (status !== "candidate" && status !== "verified") return false;
    const archivedAt = new Date(options.now ?? Date.now()).toISOString();
    // `validTo` stays unset: archive is a rest state, and supersession/expiry own that field.
    return patch(
      record,
      (note) => ({
        fabric: evolve(note, {
          archivedAt,
          archivedFrom: status,
          ...(options.mergedInto === undefined ? {} : { mergedInto: options.mergedInto }),
        }),
        status: "archived",
        ...(options.auditVerb === undefined ? {} : { auditVerb: options.auditVerb }),
      }),
      options,
    );
  }

  async function supersede(id: string, options: { readonly now?: number; readonly signal?: AbortSignal } = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record) return false;
    const status = statusOf(record);
    if (status !== "candidate" && status !== "verified") return false;
    const validTo = new Date(options.now ?? Date.now()).toISOString();
    return patch(
      record,
      (note) => ({ fabric: evolve(note, { validTo }), status: "retired", auditVerb: "superseded-by-contradiction" }),
      options,
    );
  }

  async function mergeMetadata(id: string, next: MemoryNoteMetadata, options: { readonly signal?: AbortSignal } = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record) return false;
    return patch(record, () => ({ fabric: evolve(next, {}), auditVerb: "merged" }), options);
  }

  async function pin(id: string, pinned = true, options: { readonly signal?: AbortSignal } = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record) return false;
    return patch(record, (note) => ({ fabric: evolve(note, { pinned: pinned ? true : undefined }) }), options);
  }

  async function census(signal?: AbortSignal): Promise<FabricNoteCensus> {
    const counts = { candidate: 0, verified: 0, archived: 0, reconsolidate: 0 };
    for await (const record of exportedRecords(memory, signal)) {
      const note = parseMemoryNoteMetadata(record.metadata);
      if (note?.reconsolidate === true) counts.reconsolidate += 1;
      const status = statusOf(record);
      if (status === "candidate" || status === "verified" || status === "archived") counts[status] += 1;
    }
    return {
      candidate: counts.candidate,
      verified: counts.verified,
      archived: counts.archived,
      ...(counts.reconsolidate > 0 ? { reconsolidate: counts.reconsolidate } : {}),
    };
  }

  async function retireNote(id: string, validTo: string, options: { readonly signal?: AbortSignal } = {}): Promise<boolean> {
    const [record] = await memory.get([id], options);
    if (!record) return false;
    const note = parseMemoryNoteMetadata(record.metadata);
    if (!note) return false;
    return memory.patchMetadata(
      id,
      (metadata) => ({
        ...metadata,
        auditVerb: "superseded-by-om",
        [MEMORY_NOTE_METADATA_KEY]: evolve(note, { validTo }),
      }),
      options,
    );
  }

  async function handleSupersededReflections(
    supersededReflectionIds: ReadonlySet<string>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly supersededNotes: Map<string, MemoryVectorRecord>; readonly reconsolidated: string[] }> {
    const supersededNotes = new Map<string, MemoryVectorRecord>();
    const reconsolidated: string[] = [];
    if (supersededReflectionIds.size === 0) return { supersededNotes, reconsolidated };
    const invalidations = memory.listInvalidated ? await memory.listInvalidated({ signal: options.signal }) : [];
    const correctedIds = new Set(invalidations.filter((entry) => entry.reason === "corrected").map((entry) => entry.id));
    for await (const record of exportedRecords(memory, options.signal)) {
      const note = parseMemoryNoteMetadata(record.metadata);
      if (!note?.promotedFrom?.reflectionId) continue;
      if (!supersededReflectionIds.has(note.promotedFrom.reflectionId)) continue;
      const isVerified = statusOf(record) === "verified";
      if (isVerified && correctedIds.has(record.id)) {
        await patch(record, (current) => ({ fabric: evolve(current, { reconsolidate: true }) }), options);
        reconsolidated.push(record.id);
      } else {
        supersededNotes.set(note.promotedFrom.reflectionId, record);
      }
    }
    return { supersededNotes, reconsolidated };
  }

  /** Notes a superseded reflection reopened and that still wait for their re-extraction. */
  async function reconsolidating(options: { readonly signal?: AbortSignal } = {}): Promise<readonly MemoryVectorRecord[]> {
    const found: MemoryVectorRecord[] = [];
    for await (const record of exportedRecords(memory, options.signal)) {
      const note = parseMemoryNoteMetadata(record.metadata);
      const status = statusOf(record);
      if (note?.reconsolidate !== true || note.validTo !== undefined || status === "archived" || status === "retired") continue;
      found.push(record);
    }
    return found;
  }

  return {
    verify,
    recordUses,
    recordCoReads,
    recordRetrievals,
    recordEvidence,
    archive,
    supersede,
    mergeMetadata,
    pin,
    census,
    retireNote,
    handleSupersededReflections,
    reconsolidating,
  };
}
