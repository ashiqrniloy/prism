// The fabric's public library surface (plan 188.11 Task 5). Prompts, tuning constants, scoring and
// eviction helpers, and the lifecycle/directory/core builders stay inside the package; importers
// that need them (tests, `scripts/memory-bench`) use a relative source path. The root barrel in
// `index.ts` adds the package definition, `memoryFabric`, the config surface and `createMemory`.

export type { ResolvedMemoryFabricStore, ResolvedMergeConfig, ResolvedWidenConfig } from "./config.js";
export type { ConsolidationExtractionReason } from "./consolidation/extract.js";
export type { PromotionWeights } from "./consolidation/score.js";
export { createMemoryFabric } from "./create.js";
export type { FabricRulesScope } from "./delivery/rules.js";
export type { ResolvedFabricCuesOptions } from "./delivery/cues.js";
export type { MemoryFabricDirectoryConfig, ResolvedFabricDirectoryOptions } from "./directory.js";
export {
  type ArchiveConfig,
  type CapacityLimits,
  type MemoryNoteDecay,
  type MemoryNoteStatus,
  type MemoryNoteUseEvent,
  type RecordUsesOptions,
  SCOPE_CLOCK_COUNTER,
  type StorageWeights,
  type StrengthWeights,
} from "./lifecycle/index.js";
export {
  type ExportMemoryOkfOptions,
  type ExportMemoryOkfResult,
  exportMemoryOkf,
  type ImportMemoryOkfOptions,
  type ImportMemoryOkfResult,
  importMemoryOkf,
  type MemoryOkfStores,
} from "./okf-bundle.js";
export type { ConceptCascadeReport } from "./ontology/cascade.js";
export {
  type ConceptDoc,
  type ConceptItem,
  conceptSources,
  MAX_CLAIM_CHARS,
  parseConceptBody,
  renderConceptBody,
} from "./ontology/codec.js";
export { ConceptFormatError, ConceptRequiresOntologyError } from "./ontology/errors.js";
export { createConceptDeletionHandler, MEMORY_FABRIC_CONCEPT_HANDLER_SERVICE } from "./ontology/handler.js";
export type { FabricSubjects, SubjectListing, SubjectScopeListing } from "./ontology/index.js";
export {
  type ApplyConceptEditsOptions,
  type ApplyConceptEditsResult,
  type ConceptEdit,
  type ConceptWriter,
  createFabricOntology,
  type FabricOntology,
  type FabricOntologyPort,
  MEMORY_FABRIC_SERVICE,
  type OntologyDirtyEntry,
  type OntologyNoteView,
  type OntologyPendingOptions,
  type OntologyPendingPage,
  type OntologySourceInput,
  type OntologySourceResult,
  type OntologySubject,
} from "./ontology/port.js";
export type { MemoryRetractEvent, MemoryRetractReason } from "./ontology/retract.js";
export type { FabricConsolidationReport, MemoryFabricPromoteConfig, ResolvedPromoteConfig } from "./promote.js";
export type { ScopePriors } from "./scope/recall.js";
export {
  CONCEPT_RELATIONS,
  type ConceptDirtyReason,
  type ConceptRelation,
  type ConceptType,
  type CreateMemoryFabricOptions,
  encodeMemoryNoteMetadata,
  type FabricScopeLevel,
  type MemoryDecisionStatus,
  type MemoryFabric,
  type MemoryFabricConsolidateOptions,
  type MemoryFabricConsolidateResult,
  type MemoryFabricConsolidateSource,
  type MemoryFabricConsolidationOptions,
  type MemoryFabricConversationHit,
  type MemoryFabricConversationSearchOptions,
  type MemoryFabricConversationSearchResult,
  type MemoryFabricEvolutionOptions,
  type MemoryFabricExplainEntry,
  type MemoryFabricForgetInput,
  type MemoryFabricForgetResult,
  type MemoryFabricLinkerOptions,
  type MemoryFabricMaintainOptions,
  type MemoryFabricMaintenanceReport,
  type MemoryFabricObservationSource,
  type MemoryFabricRecallOptions,
  type MemoryFabricRecallResult,
  type MemoryFabricRememberInput,
  type MemoryFabricScopeBinding,
  type MemoryFabricScopeBudget,
  type MemoryFabricScopeOpenInput,
  type MemoryFabricToolsOptions,
  type MemoryFabricWriteOptions,
  type MemoryNote,
  type MemoryNoteDate,
  type MemoryNoteDatePrecision,
  type MemoryNoteHit,
  type MemoryNoteKind,
  type MemoryNoteLink,
  type MemoryNoteMetadata,
  type MemoryNotePromotion,
  type MemoryNotePromotionStamp,
  type MemoryNoteProvenance,
  type MemoryNoteScope,
  parseMemoryNoteMetadata,
} from "./types.js";
