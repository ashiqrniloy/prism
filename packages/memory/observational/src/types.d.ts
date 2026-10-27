import type { SessionEntry } from "@arnilo/prism";
export declare const OBSERVATIONS_RECORDED = "om.observations.recorded";
export declare const REFLECTIONS_RECORDED = "om.reflections.recorded";
export declare const OBSERVATIONS_DROPPED = "om.observations.dropped";
export declare const TASK_STATE_RECORDED = "om.task_state.recorded";
export declare const FOLDED_MEMORY = "om.folded";
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
export declare const relevanceValues: readonly ["low", "medium", "high", "critical"];
export declare const coverageTierValues: readonly ["none", "partial", "full"];
export declare function isMemoryId(value: unknown): value is MemoryId;
export declare function isMemoryObservation(value: unknown): value is MemoryObservation;
export declare function isMemoryReflection(value: unknown): value is MemoryReflection;
export declare function isObservationsRecordedData(value: unknown): value is ObservationsRecordedData;
export declare function isReflectionsRecordedData(value: unknown): value is ReflectionsRecordedData;
export declare function isObservationsDroppedData(value: unknown): value is ObservationsDroppedData;
export declare function isFoldedMemoryDetails(value: unknown): value is FoldedMemoryDetails;
export declare function foldedMemoryFromEntry(entry: SessionEntry): FoldedMemoryDetails | undefined;
export declare function isIsoDate(value: unknown): value is string;
export declare function isTaskStateRecordedData(value: unknown): value is TaskStateRecordedData;
