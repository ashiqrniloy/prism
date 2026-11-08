import { MemoryValidationError } from "@arnilo/prism-memory-core";

/** A concept body or an edit batch failed validation; `reason` is a stable code, never model text. */
export class ConceptFormatError extends MemoryValidationError {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "ConceptFormatError";
    this.reason = reason;
  }
}
