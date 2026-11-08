export { WIKI_CONSOLIDATE_COMMAND_NAME } from "./commands/consolidate.js";
export { WIKI_INGEST_COMMAND_NAME } from "./commands/ingest.js";
export { WIKI_LINT_COMMAND_NAME } from "./commands/lint.js";
export { WIKI_STATUS_COMMAND_NAME } from "./commands/status.js";
export type { WikiPassReport } from "./consolidate/pass.js";
export type { WikiTrigger } from "./consolidate/triggers.js";
export {
  definition,
  type WikiConfig,
  type WikiConsolidateConfig,
  type WikiIngestConfig,
  type WikiSearchConfig,
  wiki,
} from "./extension.js";
export type { WikiLintFinding, WikiLintReport, WikiLintRuleId } from "./lint.js";
export type {
  ApplyConceptEditsOptions,
  ApplyConceptEditsResult,
  ConceptEdit,
  OntologyNoteView,
  OntologySubject,
  WikiOntologyPort,
  WikiReconcileReport,
} from "./ontology/port.js";
export { createWikiOntology } from "./ontology/port.js";
export { MEMORY_LTM_SERVICE } from "./ontology/ltm.js";
export type { LtmPort } from "./ontology/ltm.js";
export {
  type ConceptDoc,
  type ConceptItem,
  conceptSources,
  MAX_CLAIM_CHARS,
  parseConceptBody,
  renderConceptBody,
} from "./ontology/codec.js";
export { ConceptFormatError } from "./ontology/errors.js";
export { CONCEPT_RELATIONS, type ConceptRelation, type ConceptType, type WikiScopeLevel } from "./ontology/types.js";
export { createMarkdownWikiStore, createMemoryWikiStore, type WikiConceptRecord, type WikiSourceRecord, type WikiStore } from "./store.js";
export { WIKI_INGEST_TOOL_NAME } from "./tools/ingest.js";
export { WIKI_READ_TOOL, WIKI_SEARCH_TOOL } from "./tools/knowledge.js";
export type { WikiIngestResult, WikiStatusReport, WikiStatusScope } from "./types.js";
