/**
 * Plan 188.11 Task 5: the observational root barrel is the stable tier (config, ledger record names and
 * folds, `createMemoryId`) plus the shared tier the fabric imports. The shared tier carries no host
 * promise. Workers, prompts, tuning constants, settings, flush, commands and the compactor are package
 * internals, imported by relative path.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as barrel from "../index.js";
import type {
  FoldedMemoryDetails,
  MemoryId,
  MemoryObservation,
  MemoryObservationalCompactAt,
  MemoryObservationalConfig,
  MemoryObservationalDropperPolicy,
  MemoryObservationalWorkerConfig,
  MemoryReflection,
  MemoryRelevance,
  MemoryTaskState,
  ObservationalMemoryContextOptions,
  ObservationalMemoryLedger,
  ObservationsRecordedData,
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallPageDetail,
  RecallPageDirection,
  RecentMessageWindowOptions,
  ReflectionsRecordedData,
  ResolvedCompactAt,
  ResolvedMemoryObservationalConfig,
  TaskStateRecordedData,
} from "../index.js";

type _StableTypes = [
  FoldedMemoryDetails,
  MemoryId,
  MemoryObservation,
  MemoryObservationalCompactAt,
  MemoryObservationalConfig,
  MemoryObservationalDropperPolicy,
  MemoryObservationalWorkerConfig,
  MemoryReflection,
  MemoryRelevance,
  MemoryTaskState,
  ObservationalMemoryContextOptions,
  ObservationalMemoryLedger,
  ObservationsRecordedData,
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallPageDetail,
  RecallPageDirection,
  RecentMessageWindowOptions,
  ReflectionsRecordedData,
  ResolvedCompactAt,
  ResolvedMemoryObservationalConfig,
  TaskStateRecordedData,
];
export type StableTypeCount = _StableTypes["length"];

const STABLE = [
  "OBSERVATIONS_RECORDED",
  "REFLECTIONS_RECORDED",
  "TASK_STATE_RECORDED",
  "activeObservations",
  "activeReflections",
  "buildObservationalMemoryContextBlocks",
  "createMemoryId",
  "default",
  "foldObservationalMemoryLedger",
  "memoryObservationalConfigSchema",
  "resolveMemoryObservationalConfig",
] as const;

/** Memory-package shared helpers: used by the fabric, with no host promise. */
const SHARED = [
  "HARD_MAX_RECALL_PAGE_LIMIT",
  "estimateMessageTokens",
  "estimateTextTokens",
  "foldedMemoryFromEntry",
  "isEligibleObservationSourceEntry",
  "isMemoryId",
  "isMemoryObservation",
  "isMemoryReflection",
  "isObservationsRecordedData",
  "isReflectionsRecordedData",
  "isTaskStateRecordedData",
  "recallObservationalMemoryBranchPage",
  "recordData",
  "resolveRecallPageLimit",
  "serializeSessionEntry",
] as const;

const INTERNAL_NAMES = [
  "DEFAULT_OBSERVER_INSTRUCTION",
  "DEFAULT_REFLECTOR_INSTRUCTION",
  "DEFAULT_DROPPER_INSTRUCTION",
  "DEFAULT_COMPACT_AT_RATIO",
  "FOLDED_MEMORY",
  "OBSERVATIONS_DROPPED",
  "OBSERVATIONS_POOL_TARGET_TOKENS",
  "ObservationalMemoryError",
  "ObservationalMemoryLimitError",
  "measureWorkerJson",
  "resolveMemoryWorkerLimits",
  "runMemoryWorkerLoop",
  "truncateWorkerText",
  "assertNoRemovedFlatKeys",
  "createObservationalCompactor",
  "createObservationalFlush",
  "createObservationalMemoryCommands",
  "createObservationalMemoryCompactor",
  "createObservationalRecallTool",
  "defaultObservationalMemorySettings",
  "dropObservationsToTarget",
  "ledgerOf",
  "mergeObservationalMemoryLedgers",
  "readObservationalMemoryState",
  "recallObservationalMemory",
  "renderObservationalMemory",
  "resolveCompactAtThreshold",
  "resolveObservationalMemorySettings",
  "runDropper",
  "runObserver",
  "runReflector",
  "serializeSourceEntries",
  "ObservationalMemorySettings",
  "ObservationalMemorySettingsInput",
  "ObservationalMemoryContextSettings",
  "ObservationalMemoryContextSettingsInput",
  "ObservationalMemoryDropperPolicy",
  "ObservationalMemoryDropperSettings",
  "ObservationalMemoryDropperSettingsInput",
  "ObservationalMemoryObservationSettings",
  "ObservationalMemoryObservationSettingsInput",
  "ObservationalMemoryReflectionSettings",
  "ObservationalMemoryReflectionSettingsInput",
  "ObservationalMemoryRetrievalSettings",
  "ObservationalMemoryRetrievalSettingsInput",
  "RunDropperOptions",
  "RunObserverOptions",
  "RunReflectorOptions",
  "ObservationalFlush",
  "ObservationalFlushDeps",
  "ObservationalFlushResult",
  "ObservationalFlushStatus",
  "ObservationalWorkerKind",
  "RecallKind",
  "RecallMemoryOptions",
  "RecallToolOptions",
  "MemoryCommandDeps",
  "MemoryBlockOptions",
  "BoundedMemoryPayload",
  "CoverageTier",
  "ObservationsDroppedData",
  "RenderObservationalMemoryOptions",
  "ObservationalMemoryProjection",
  "ObservationalMemoryRecord",
  "ObservationalMemoryState",
  "ObservationalMemoryLedgerSource",
  "MemoryRecallResult",
  "ObservationalCompactorOptions",
  "ObservationalMemoryCompactorOptions",
] as const;

describe("memory-observational root exports", () => {
  it("observational_root_exports_only_the_stable_and_shared_sets", () => {
    expect(Object.keys(barrel).sort()).toEqual([...STABLE, ...SHARED].sort());
  });

  it("observational_root_barrel_does_not_name_an_internal", () => {
    const source = readFileSync(fileURLToPath(new URL("../exports.ts", import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const present = INTERNAL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
    expect(present).toEqual([]);
  });
});
