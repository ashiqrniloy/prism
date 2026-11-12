/**
 * Plan 188.11 Task 5 (moved by plan 216 Task 4): the memory-system root barrel is the stable tier (config, ledger record names and
 * folds, `createMemoryId`) plus long-term memory's stable set (plan 216 Task 5; the helpers the two share are
 * imported in-package, not exported). Workers, prompts, tuning constants, settings, flush, commands and the compactor are package
 * internals, imported by relative path.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  FoldedMemoryDetails,
  MemoryId,
  MemoryObservation,
  MemoryRelevance,
  MemorySystemCompactAt,
  MemorySystemConfig,
  MemorySystemRehearsalPolicy,
  MemorySystemWorkerConfig,
  MemoryTaskState,
  MemoryWmItem,
  ObservationalMemoryContextOptions,
  ObservationalMemoryLedger,
  ObservationsRecordedData,
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallPageDetail,
  RecallPageDirection,
  RecentMessageWindowOptions,
  ResolvedCompactAt,
  ResolvedMemorySystemConfig,
  TaskStateRecordedData,
  WmRecordedData,
} from "../../index.js";
import * as barrel from "../../index.js";
import * as ltmBarrel from "../../ltm/public.js";

type _StableTypes = [
  FoldedMemoryDetails,
  MemoryId,
  MemoryObservation,
  MemorySystemCompactAt,
  MemorySystemConfig,
  MemorySystemRehearsalPolicy,
  MemorySystemWorkerConfig,
  MemoryWmItem,
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
  WmRecordedData,
  ResolvedCompactAt,
  ResolvedMemorySystemConfig,
  TaskStateRecordedData,
];
export type StableTypeCount = _StableTypes["length"];

const STABLE = [
  // The components and the `memory.system` service (plan 216 Task 6).
  "MEMORY_SYSTEM_COMPONENTS",
  "MEMORY_SYSTEM_SERVICE",
  "MemorySystemError",
  "resolveMemorySystemComponents",
  // The chunk store contract and its default (plan 217 Task 2).
  "MEMORY_CHUNK_STORE_SERVICE",
  "SqliteChunkStore",
  "createSqliteChunkStore",
  "MemorySessionLedgerError",
  "OBSERVATIONS_RECORDED",
  // Habituation and boundary record types (plan 217 Task 3).
  "OBSERVATIONS_REPEATED",
  "OBSERVATIONS_TOMBSTONED",
  "BOUNDARY_RECORDED",
  "SCOPE_SET",
  "WM_RECORDED",
  "TASK_STATE_RECORDED",
  "activeObservations",
  "activeWmItems",
  "buildObservationalMemoryContextBlocks",
  "createMemoryId",
  "default",
  "foldObservationalMemoryLedger",
  "memorySystemConfigSchema",
  "resolveMemorySystemConfig",
] as const;

const INTERNAL_NAMES = [
  "DEFAULT_STM_INSTRUCTION",
  "DEFAULT_WM_INSTRUCTION",
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
  "runStm",
  "runWm",
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
  "RunWmOptions",
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

describe("memory-system root exports", () => {
  it("memory_system_root_exports_only_the_stable_sets", () => {
    // The session tiers' stable set plus long-term memory's (checked name by name in `ltm/__tests__/root-exports.test.ts`).
    expect(Object.keys(barrel).sort()).toEqual([...new Set([...STABLE, ...Object.keys(ltmBarrel)])].sort());
  });

  it("memory_system_root_barrel_does_not_name_an_internal", () => {
    const source = readFileSync(fileURLToPath(new URL("../exports.ts", import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const present = INTERNAL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
    expect(present).toEqual([]);
  });
});
