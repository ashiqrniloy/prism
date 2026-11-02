import { MemoryValidationError } from "@arnilo/prism-memory-core";

/**
 * A model tool tried to create, edit or delete a `concept` note (plan 207 Task 2). The working agent writes
 * evidence; only the background curator (through the ontology port) or a person edits the ontology.
 */
export class ConceptRequiresOntologyError extends MemoryValidationError {
  override readonly code: string = "concept_requires_ontology";

  constructor(
    message = "concept notes are written only by the ontology curator or a person; the memory tools cannot create, edit or delete one",
  ) {
    super(message);
    this.name = "ConceptRequiresOntologyError";
  }
}

/** A concept body or an edit batch failed validation; `reason` is a stable code, never model text. */
export class ConceptFormatError extends MemoryValidationError {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "ConceptFormatError";
    this.reason = reason;
  }
}
