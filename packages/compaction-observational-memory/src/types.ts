import type { SessionEntry } from "prism";

export const OBSERVATIONS_RECORDED = "om.observations.recorded";
export const REFLECTIONS_RECORDED = "om.reflections.recorded";
export const OBSERVATIONS_DROPPED = "om.observations.dropped";
export const FOLDED_MEMORY = "om.folded";

export type MemoryId = string;
export type MemoryRelevance = "low" | "medium" | "high" | "critical";
export type CoverageTier = "none" | "partial" | "full";

export interface MemoryObservation {
  readonly id: MemoryId;
  readonly content: string;
  readonly timestamp: string;
  readonly relevance: MemoryRelevance;
  readonly sourceEntryIds: readonly string[];
  readonly tokenCount: number;
}

export interface MemoryReflection {
  readonly id: MemoryId;
  readonly content: string;
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
  readonly coversUpToId?: string;
}

export interface ObservationsDroppedData {
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
  return isMemoryId(value.id)
    && typeof value.content === "string"
    && value.content.length > 0
    && !value.content.includes("\n")
    && typeof value.timestamp === "string"
    && isRelevance(value.relevance)
    && isStringArray(value.sourceEntryIds)
    && isNonNegativeNumber(value.tokenCount);
}

export function isMemoryReflection(value: unknown): value is MemoryReflection {
  if (!isRecord(value)) return false;
  return isMemoryId(value.id)
    && typeof value.content === "string"
    && value.content.length > 0
    && !value.content.includes("\n")
    && isStringArray(value.supportingObservationIds)
    && value.supportingObservationIds.every(isMemoryId)
    && isNonNegativeNumber(value.tokenCount);
}

export function isObservationsRecordedData(value: unknown): value is ObservationsRecordedData {
  return isRecord(value)
    && value.type === OBSERVATIONS_RECORDED
    && Array.isArray(value.observations)
    && (value.coversUpToId === undefined || typeof value.coversUpToId === "string");
}

export function isReflectionsRecordedData(value: unknown): value is ReflectionsRecordedData {
  return isRecord(value)
    && value.type === REFLECTIONS_RECORDED
    && Array.isArray(value.reflections)
    && (value.coversUpToId === undefined || typeof value.coversUpToId === "string");
}

export function isObservationsDroppedData(value: unknown): value is ObservationsDroppedData {
  return isRecord(value)
    && value.type === OBSERVATIONS_DROPPED
    && isStringArray(value.observationIds)
    && value.observationIds.every(isMemoryId)
    && (value.coversUpToId === undefined || typeof value.coversUpToId === "string");
}

export function isFoldedMemoryDetails(value: unknown): value is FoldedMemoryDetails {
  return isRecord(value)
    && value.type === FOLDED_MEMORY
    && value.version === 1
    && typeof value.fullFold === "boolean"
    && Array.isArray(value.observations)
    && Array.isArray(value.reflections)
    && (value.droppedObservationIds === undefined || isStringArray(value.droppedObservationIds));
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
