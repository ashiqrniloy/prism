export class MemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

/**
 * Named validation codes beyond the default `validation`: a retired kind or store layout fails with one of these
 * so a host can tell a migration error from a malformed input.
 */
export type MemoryValidationCode = "validation" | "working_memory_retired" | "episode_kind_not_available";

export class MemoryValidationError extends MemoryError {
  constructor(message: string, code: MemoryValidationCode = "validation") {
    super(code, message);
    this.name = "MemoryValidationError";
  }
}

export class MemoryConflictError extends MemoryError {
  constructor(message: string) {
    super("conflict", message);
    this.name = "MemoryConflictError";
  }
}

export class MemoryScopeError extends MemoryError {
  constructor(message: string) {
    super("scope", message);
    this.name = "MemoryScopeError";
  }
}

export class MemoryLimitError extends MemoryError {
  constructor(message: string) {
    super("limit", message);
    this.name = "MemoryLimitError";
  }
}

export class MemoryAbortError extends MemoryError {
  constructor(message = "Memory operation aborted") {
    super("aborted", message);
    this.name = "MemoryAbortError";
  }
}
