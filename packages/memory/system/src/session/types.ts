import type { SessionEntry } from "@arnilo/prism";

export const OBSERVATIONS_RECORDED = "memory.session.observations.recorded";
/** A working-memory pass (plan 218 Task 2): the items it added and the WM items it superseded by name. */
export const WM_RECORDED = "memory.session.wm.recorded";
export const OBSERVATIONS_DROPPED = "memory.session.observations.dropped";
export const TASK_STATE_RECORDED = "memory.session.task_state.recorded";
/** Habituation (plan 217 Task 3): an identical event repeated; the record carries the event's new absolute count. */
export const OBSERVATIONS_REPEATED = "memory.session.observations.repeated";
/** An event boundary (plan 217 Task 3): an outcome, a task-state change, or a user turn after an idle gap. */
export const BOUNDARY_RECORDED = "memory.session.boundary.recorded";
/**
 * A tombstone (plan 217 Task 4): an STM record whose surface was removed (by plan 218's WM). It leaves the context
 * block and the active set, and `recall` still finds it by id with its reason. Chunk referrers are the remover's call.
 */
export const OBSERVATIONS_TOMBSTONED = "memory.session.observations.tombstoned";
/** Longest tombstone reason the ledger accepts, in characters. */
export const MAX_TOMBSTONE_REASON_LENGTH = 200;
export const FOLDED_MEMORY = "memory.session.folded";
/** Context pin and compaction marker records the package appends beside the worker records. */
export const CONTEXT_PINNED = "memory.session.context.pinned";
export const SESSION_COMPACTED = "memory.session.compacted";

/** The record-type prefix the observational package wrote before the 2026-11-08 rename. */
export const RETIRED_LEDGER_TYPE_PREFIX = "om.";
/** The whole-log reflector's record type, retired with it by plan 218 Task 2 (WM items replace reflections). */
export const RETIRED_REFLECTIONS_RECORDED = "memory.session.reflections.recorded";

/**
 * A ledger record or folded-memory entry written under a retired `om.*` type. No reader is kept for
 * them: the experimental line allows the break, and the error names the way out.
 */
export class MemorySessionLedgerError extends Error {
  readonly code = "retired_ledger_type";
  constructor(readonly recordType: string) {
    super(
      recordType === RETIRED_REFLECTIONS_RECORDED || recordType === `${FOLDED_MEMORY}@1`
        ? `Session memory: ledger record type "${recordType}" was retired with the whole-log reflector (plan 218); ` +
            "working-memory items replace reflections. Export the session with memory:session:view before upgrading, or start a new session."
        : `Session memory: ledger record type "${recordType.slice(0, 64)}" was retired with @arnilo/prism-memory-observational. ` +
            "Export the session with that package's om:view before upgrading, or start a new session; records now use memory.session.* types.",
    );
    this.name = "MemorySessionLedgerError";
  }
}

/** Throws {@link MemorySessionLedgerError} when `value` is a record (or folded memory) with a retired type. */
export function assertNotRetiredLedgerRecord(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const type = (value as { readonly type?: unknown }).type;
  if (typeof type === "string" && (type.startsWith(RETIRED_LEDGER_TYPE_PREFIX) || type === RETIRED_REFLECTIONS_RECORDED))
    throw new MemorySessionLedgerError(type);
  if (type === FOLDED_MEMORY && (value as { readonly version?: unknown }).version === 1)
    throw new MemorySessionLedgerError(`${FOLDED_MEMORY}@1`);
}

export type MemoryId = string;
export type MemoryRelevance = "low" | "medium" | "high" | "critical";
export type CoverageTier = "none" | "partial" | "full";

/** What a short-term memory event records (plan 217 Task 1): what happened, not a derived fact. */
export type MemoryEventKind = "request" | "action" | "result" | "change" | "decision" | "outcome" | "error" | "statement";
export const memoryEventKindValues: readonly MemoryEventKind[] = [
  "request",
  "action",
  "result",
  "change",
  "decision",
  "outcome",
  "error",
  "statement",
];

/**
 * Whose content a record is (plan 218 Task 4.1), derived from the roles of the entries it cites, never set by a model.
 * `mixed` is user and assistant content in one record; tool output beside one side counts as that side.
 */
export type MemoryAttribution = "user" | "assistant" | "tool" | "mixed";
export const memoryAttributionValues: readonly MemoryAttribution[] = ["user", "assistant", "tool", "mixed"];

/** A reference to one verbatim chunk in the chunk store; the text itself never lives on the branch. */
export interface MemoryChunkRef {
  readonly id: string;
  readonly sourceEntryId: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * One short-term memory event (the type keeps its 0.13 name until plans 218–219 replace the
 * consumers). `description` is one self-contained line a later model can judge usefulness from.
 */
export interface MemoryObservation {
  readonly id: MemoryId;
  readonly kind: MemoryEventKind;
  readonly description: string;
  readonly chunkRefs?: readonly MemoryChunkRef[];
  /** Identical repeats collapsed into this event (habituation, Task 3). Absent means 1. */
  readonly count?: number;
  /** Time of the latest repeat. Absent means `observedAt ?? timestamp`. */
  readonly lastAt?: string;
  readonly timestamp: string;
  readonly observedAt?: string;
  readonly referencedAt?: string;
  readonly relevance: MemoryRelevance;
  readonly sourceEntryIds: readonly string[];
  /** Derived from the cited entries' roles (Task 4.1). Absent on records written before it. */
  readonly attribution?: MemoryAttribution;
  readonly tokenCount: number;
}

export interface MemoryTaskState {
  readonly id: MemoryId;
  readonly goal: string;
  readonly openQuestions?: readonly string[];
  readonly decisions?: readonly string[];
  readonly nextSteps?: readonly string[];
  readonly sourceEntryIds: readonly string[];
}

export interface TaskStateRecordedData {
  readonly type: typeof TASK_STATE_RECORDED;
  readonly taskState: MemoryTaskState;
}

/** What a working-memory item is (plan 218 Task 2): a kept STM event, a summary of several, or a derived fact. */
export type MemoryWmItemKind = "event" | "summary" | "fact";
export const memoryWmItemKindValues: readonly MemoryWmItemKind[] = ["event", "summary", "fact"];

/**
 * One working-memory item. `citedIds` are the STM records (and, for a `fact`, the WM items) it rests on; `chunkRefs`
 * are the chunks it holds a `wm` referrer for, inherited from what it cites and what it supersedes. `text` is one line.
 */
export interface MemoryWmItem {
  readonly id: MemoryId;
  readonly kind: MemoryWmItemKind;
  readonly text: string;
  readonly relevance: MemoryRelevance;
  readonly citedIds: readonly MemoryId[];
  readonly chunkRefs?: readonly MemoryChunkRef[];
  /** WM items this one replaced by name (`summarize` and `derive` only). */
  readonly supersedes?: readonly MemoryId[];
  /** Why a `keep` kept the record. */
  readonly reason?: string;
  /**
   * The scope step the WM model said needs this item later (plan 218 Task 3). Marked, the item is protected: the
   * records it cites are never discarded and Rehearsal keeps it.
   */
  readonly neededLater?: string;
  readonly observedFrom?: string;
  readonly observedTo?: string;
  /**
   * Derived from what the item rests on (Task 4.1): `assistant` when it rests only on assistant proposals, `mixed` when
   * on both user and assistant content. Absent when a source has none, or rests only on assistant actions.
   */
  readonly attribution?: MemoryAttribution;
  readonly tokenCount: number;
}

export interface ObservationsRecordedData {
  readonly type: typeof OBSERVATIONS_RECORDED;
  readonly observations: readonly unknown[];
  readonly coversUpToId?: string;
}

/**
 * One WM pass. `processedIds` are the STM records that received a verdict (each is also tombstoned); `boundaries` is
 * how many boundary markers the ledger held when the pass ran, so a later marker is new to WM. A pass that recorded no
 * item and processed no record (or failed) is an empty attempt: the next one waits for `wm.triggerTokens` of new records.
 */
export interface WmRecordedData {
  readonly type: typeof WM_RECORDED;
  readonly items: readonly unknown[];
  readonly supersededItemIds?: readonly string[];
  readonly processedIds?: readonly string[];
  readonly boundaries?: number;
  /**
   * The pass's compression (plan 218 Task 3): `processedTokens` are the surface tokens of the records it gave a verdict,
   * `itemTokens` those of the items it wrote, `targetTokens` is `wm.targetRatio` × the batch's tokens.
   */
  readonly compression?: WmCompression;
  /** Present when the batch's protected records alone exceed the target: the pass discarded no more to meet it. */
  readonly budgetUnmet?: WmBudgetUnmet;
  /** Present on the first WM pass after a scope change (plan 218 Task 4): what it re-judged. */
  readonly rejudge?: WmRejudge;
}

/**
 * Re-judgment after a scope change (plan 218 Task 4). `scopeHash` is the scope it answered (absent after a clear),
 * `offered` the discarded records it was sent, `kept` the ids it kept back into WM, and `chunkDropped` the discarded
 * records it could not offer because every chunk they cited was deleted.
 */
export interface WmRejudge {
  readonly scopeHash?: string;
  readonly offered: number;
  readonly kept: readonly string[];
  readonly chunkDropped: readonly string[];
}

export interface WmCompression {
  readonly processedTokens: number;
  readonly itemTokens: number;
  readonly targetTokens: number;
}

/** `budget_unmet` (plan 218 Task 3): the protected share of a WM batch alone exceeds `wm.targetRatio`'s target. */
export interface WmBudgetUnmet {
  readonly protectedTokens: number;
  readonly targetTokens: number;
}

export interface ObservationsDroppedData {
  readonly reason?: "superseded";
  readonly supersededBy?: MemoryId;
  readonly type: typeof OBSERVATIONS_DROPPED;
  readonly observationIds: readonly string[];
  readonly coversUpToId?: string;
}

/**
 * An identical event seen again inside the habituation window. `count` is absolute (the event's total after this
 * repeat), so folding the same repeat twice, or beside a folded copy that already carries it, cannot over-count.
 */
export interface ObservationsRepeatedData {
  readonly type: typeof OBSERVATIONS_REPEATED;
  readonly observationId: MemoryId;
  readonly count: number;
  readonly lastAt?: string;
  readonly sourceEntryIds: readonly string[];
}

export type MemoryBoundaryReason = "outcome" | "task_state" | "idle_gap";
export const memoryBoundaryReasonValues: readonly MemoryBoundaryReason[] = ["outcome", "task_state", "idle_gap"];

/**
 * An event boundary marker. `entryId` is the branch entry at the boundary (the outcome's last source entry, the
 * task state's last source entry, or the user message after the gap); `(reason, entryId)` identifies it.
 */
export interface MemoryBoundary {
  readonly reason: MemoryBoundaryReason;
  readonly entryId: string;
  /** The outcome event or task state the boundary came from. Absent for `idle_gap`. */
  readonly recordId?: MemoryId;
  /** Minutes since the previous entry, for `idle_gap`. */
  readonly gapMinutes?: number;
  readonly at: string;
}

export interface BoundaryRecordedData extends MemoryBoundary {
  readonly type: typeof BOUNDARY_RECORDED;
}

/** Why and when a record's surface was removed. */
export interface MemoryTombstone {
  readonly reason: string;
  readonly at: string;
}

export interface ObservationsTombstonedData extends MemoryTombstone {
  readonly type: typeof OBSERVATIONS_TOMBSTONED;
  readonly observationIds: readonly string[];
}

export interface FoldedMemoryDetails {
  readonly type: typeof FOLDED_MEMORY;
  /** 2 since plan 218 Task 2 (`wmItems` replaced `reflections`); a version 1 payload fails as a retired type. */
  readonly version: 2;
  readonly fullFold: boolean;
  readonly observations: readonly unknown[];
  readonly wmItems: readonly unknown[];
  readonly droppedObservationIds?: readonly string[];
}

export const relevanceValues = ["low", "medium", "high", "critical"] as const;
export const coverageTierValues = ["none", "partial", "full"] as const;

export function isMemoryId(value: unknown): value is MemoryId {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value);
}

/** An absent attribution is valid: records written before Task 4.1 carry none. */
function isAttribution(value: unknown): boolean {
  return value === undefined || (memoryAttributionValues as readonly unknown[]).includes(value);
}

export function isMemoryObservation(value: unknown): value is MemoryObservation {
  if (!isRecord(value)) return false;
  return (
    isMemoryId(value.id) &&
    isEventKind(value.kind) &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    !value.description.includes("\n") &&
    (value.chunkRefs === undefined || (Array.isArray(value.chunkRefs) && value.chunkRefs.every(isChunkRef))) &&
    (value.count === undefined || (Number.isInteger(value.count) && (value.count as number) >= 1)) &&
    (value.lastAt === undefined || isIsoTime(value.lastAt)) &&
    typeof value.timestamp === "string" &&
    (value.observedAt === undefined || isIsoTime(value.observedAt)) &&
    (value.referencedAt === undefined || isIsoDate(value.referencedAt)) &&
    isRelevance(value.relevance) &&
    isStringArray(value.sourceEntryIds) &&
    isAttribution(value.attribution) &&
    isNonNegativeNumber(value.tokenCount)
  );
}

export function isMemoryWmItem(value: unknown): value is MemoryWmItem {
  if (!isRecord(value)) return false;
  return (
    isMemoryId(value.id) &&
    typeof value.kind === "string" &&
    (memoryWmItemKindValues as readonly string[]).includes(value.kind) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    !value.text.includes("\n") &&
    isRelevance(value.relevance) &&
    isStringArray(value.citedIds) &&
    value.citedIds.length > 0 &&
    value.citedIds.every(isMemoryId) &&
    (value.chunkRefs === undefined || (Array.isArray(value.chunkRefs) && value.chunkRefs.every(isChunkRef))) &&
    (value.supersedes === undefined || (isStringArray(value.supersedes) && value.supersedes.every(isMemoryId))) &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.neededLater === undefined || (typeof value.neededLater === "string" && value.neededLater.length > 0)) &&
    (value.observedFrom === undefined || isIsoTime(value.observedFrom)) &&
    (value.observedTo === undefined || isIsoTime(value.observedTo)) &&
    isAttribution(value.attribution) &&
    isNonNegativeNumber(value.tokenCount)
  );
}

export function isObservationsRecordedData(value: unknown): value is ObservationsRecordedData {
  return (
    isRecord(value) &&
    value.type === OBSERVATIONS_RECORDED &&
    Array.isArray(value.observations) &&
    (value.coversUpToId === undefined || typeof value.coversUpToId === "string")
  );
}

export function isWmRecordedData(value: unknown): value is WmRecordedData {
  return (
    isRecord(value) &&
    value.type === WM_RECORDED &&
    Array.isArray(value.items) &&
    (value.supersededItemIds === undefined || (isStringArray(value.supersededItemIds) && value.supersededItemIds.every(isMemoryId))) &&
    (value.processedIds === undefined || (isStringArray(value.processedIds) && value.processedIds.every(isMemoryId))) &&
    (value.boundaries === undefined || (Number.isSafeInteger(value.boundaries) && (value.boundaries as number) >= 0)) &&
    (value.compression === undefined || isTokenRecord(value.compression, ["processedTokens", "itemTokens", "targetTokens"])) &&
    (value.budgetUnmet === undefined || isTokenRecord(value.budgetUnmet, ["protectedTokens", "targetTokens"])) &&
    (value.rejudge === undefined || isWmRejudge(value.rejudge))
  );
}

function isWmRejudge(value: unknown): value is WmRejudge {
  return (
    isRecord(value) &&
    (value.scopeHash === undefined || typeof value.scopeHash === "string") &&
    Number.isSafeInteger(value.offered) &&
    (value.offered as number) >= 0 &&
    isStringArray(value.kept) &&
    value.kept.every(isMemoryId) &&
    isStringArray(value.chunkDropped) &&
    value.chunkDropped.every(isMemoryId)
  );
}

function isTokenRecord(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0);
}

export function isObservationsDroppedData(value: unknown): value is ObservationsDroppedData {
  return (
    isRecord(value) &&
    value.type === OBSERVATIONS_DROPPED &&
    isStringArray(value.observationIds) &&
    value.observationIds.every(isMemoryId) &&
    (value.reason === undefined || value.reason === "superseded") &&
    (value.supersededBy === undefined || isMemoryId(value.supersededBy)) &&
    (value.coversUpToId === undefined || typeof value.coversUpToId === "string")
  );
}

export function isObservationsRepeatedData(value: unknown): value is ObservationsRepeatedData {
  return (
    isRecord(value) &&
    value.type === OBSERVATIONS_REPEATED &&
    isMemoryId(value.observationId) &&
    Number.isInteger(value.count) &&
    (value.count as number) >= 2 &&
    (value.lastAt === undefined || isIsoTime(value.lastAt)) &&
    isStringArray(value.sourceEntryIds)
  );
}

export function isBoundaryRecordedData(value: unknown): value is BoundaryRecordedData {
  return (
    isRecord(value) &&
    value.type === BOUNDARY_RECORDED &&
    (memoryBoundaryReasonValues as readonly unknown[]).includes(value.reason) &&
    typeof value.entryId === "string" &&
    value.entryId.length > 0 &&
    (value.recordId === undefined || isMemoryId(value.recordId)) &&
    (value.gapMinutes === undefined || isNonNegativeNumber(value.gapMinutes)) &&
    isIsoTime(value.at)
  );
}

export function isObservationsTombstonedData(value: unknown): value is ObservationsTombstonedData {
  return (
    isRecord(value) &&
    value.type === OBSERVATIONS_TOMBSTONED &&
    isStringArray(value.observationIds) &&
    value.observationIds.length > 0 &&
    value.observationIds.every(isMemoryId) &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    value.reason.length <= MAX_TOMBSTONE_REASON_LENGTH &&
    isIsoTime(value.at)
  );
}

export function isFoldedMemoryDetails(value: unknown): value is FoldedMemoryDetails {
  return (
    isRecord(value) &&
    value.type === FOLDED_MEMORY &&
    value.version === 2 &&
    typeof value.fullFold === "boolean" &&
    Array.isArray(value.observations) &&
    Array.isArray(value.wmItems) &&
    (value.droppedObservationIds === undefined || isStringArray(value.droppedObservationIds))
  );
}

export function foldedMemoryFromEntry(entry: SessionEntry): FoldedMemoryDetails | undefined {
  const data = isRecord(entry.data) ? entry.data.memory : undefined;
  assertNotRetiredLedgerRecord(data);
  return isFoldedMemoryDetails(data) ? data : undefined;
}

function isEventKind(value: unknown): value is MemoryEventKind {
  return typeof value === "string" && (memoryEventKindValues as readonly string[]).includes(value);
}

function isChunkRef(value: unknown): value is MemoryChunkRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sourceEntryId === "string" &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    isNonNegativeNumber(value.bytes)
  );
}

function isRelevance(value: unknown): value is MemoryRelevance {
  return typeof value === "string" && (relevanceValues as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function isIsoTime(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && isIsoDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
  );
}

export function isTaskStateRecordedData(value: unknown): value is TaskStateRecordedData {
  if (!isRecord(value) || value.type !== TASK_STATE_RECORDED || !isRecord(value.taskState)) return false;
  const state = value.taskState;
  return (
    isMemoryId(state.id) &&
    typeof state.goal === "string" &&
    state.goal.length > 0 &&
    isStringArray(state.sourceEntryIds) &&
    state.sourceEntryIds.length > 0 &&
    [state.openQuestions, state.decisions, state.nextSteps].every((items) => items === undefined || isStringArray(items))
  );
}
