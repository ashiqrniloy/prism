import type { SessionEntry } from "@arnilo/prism";

export const OBSERVATIONS_RECORDED = "om.observations.recorded";
export const REFLECTIONS_RECORDED = "om.reflections.recorded";
export const OBSERVATIONS_DROPPED = "om.observations.dropped";
export const TASK_STATE_RECORDED = "om.task_state.recorded";
export const FOLDED_MEMORY = "om.folded";

export type MemoryId = string;
export type MemoryRelevance = "low" | "medium" | "high" | "critical";
export type CoverageTier = "none" | "partial" | "full";

export interface MemoryObservation {
  readonly id: MemoryId;
  readonly content: string;
  readonly timestamp: string;
  readonly observedAt?: string;
  readonly referencedAt?: string;
  readonly relevance: MemoryRelevance;
  readonly sourceEntryIds: readonly string[];
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

export interface MemoryReflection {
  readonly id: MemoryId;
  readonly content: string;
  readonly observedFrom?: string;
  readonly observedTo?: string;
  readonly supportingObservationIds: readonly MemoryId[];
  readonly tokenCount: number;
}

export interface ObservationsRecordedData {
  readonly type: typeof OBSERVATIONS_RECORDED;
  readonly observations: readonly unknown[];
  readonly coversUpToId?: string;
}

export interface ReflectionsRecordedData {
  readonly type: typeof REFLECTIONS_RECORDED;
  readonly reflections: readonly unknown[];
  readonly consumedObservationIds?: readonly string[];
  readonly supersededReflectionIds?: readonly string[];
  readonly coversUpToId?: string;
}

export interface ObservationsDroppedData {
  readonly reason?: "superseded";
  readonly supersededBy?: MemoryId;
  readonly type: typeof OBSERVATIONS_DROPPED;
  readonly observationIds: readonly string[];
  readonly coversUpToId?: string;
}

export interface FoldedMemoryDetails {
  readonly type: typeof FOLDED_MEMORY;
  readonly version: 1;
  readonly fullFold: boolean;
  readonly observations: readonly unknown[];
  readonly reflections: readonly unknown[];
  readonly droppedObservationIds?: readonly string[];
}

export const relevanceValues = ["low", "medium", "high", "critical"] as const;
export const coverageTierValues = ["none", "partial", "full"] as const;

export function isMemoryId(value: unknown): value is MemoryId {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value);
}

export function isMemoryObservation(value: unknown): value is MemoryObservation {
  if (!isRecord(value)) return false;
  return (
    isMemoryId(value.id) &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    !value.content.includes("\n") &&
    typeof value.timestamp === "string" &&
    (value.observedAt === undefined || isIsoTime(value.observedAt)) &&
    (value.referencedAt === undefined || isIsoDate(value.referencedAt)) &&
    isRelevance(value.relevance) &&
    isStringArray(value.sourceEntryIds) &&
    isNonNegativeNumber(value.tokenCount)
  );
}

export function isMemoryReflection(value: unknown): value is MemoryReflection {
  if (!isRecord(value)) return false;
  return (
    isMemoryId(value.id) &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    !value.content.includes("\n") &&
    (value.observedFrom === undefined || isIsoTime(value.observedFrom)) &&
    (value.observedTo === undefined || isIsoTime(value.observedTo)) &&
    isStringArray(value.supportingObservationIds) &&
    value.supportingObservationIds.every(isMemoryId) &&
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

export function isReflectionsRecordedData(value: unknown): value is ReflectionsRecordedData {
  return (
    isRecord(value) &&
    value.type === REFLECTIONS_RECORDED &&
    Array.isArray(value.reflections) &&
    (value.consumedObservationIds === undefined ||
      (isStringArray(value.consumedObservationIds) && value.consumedObservationIds.every(isMemoryId))) &&
    (value.supersededReflectionIds === undefined ||
      (isStringArray(value.supersededReflectionIds) && value.supersededReflectionIds.every(isMemoryId))) &&
    (value.coversUpToId === undefined || typeof value.coversUpToId === "string")
  );
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

export function isFoldedMemoryDetails(value: unknown): value is FoldedMemoryDetails {
  return (
    isRecord(value) &&
    value.type === FOLDED_MEMORY &&
    value.version === 1 &&
    typeof value.fullFold === "boolean" &&
    Array.isArray(value.observations) &&
    Array.isArray(value.reflections) &&
    (value.droppedObservationIds === undefined || isStringArray(value.droppedObservationIds))
  );
}

export function foldedMemoryFromEntry(entry: SessionEntry): FoldedMemoryDetails | undefined {
  const data = isRecord(entry.data) ? entry.data.memory : undefined;
  return isFoldedMemoryDetails(data) ? data : undefined;
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
