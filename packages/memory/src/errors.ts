export class MemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

export class MemoryValidationError extends MemoryError {
  constructor(message: string) {
    super("validation", message);
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
