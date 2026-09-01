export class RagError extends Error {
  readonly code: string;

  constructor(message: string, code = "ERR_PRISM_RAG") {
    super(message);
    this.name = "RagError";
    this.code = code;
  }
}

export class RagValidationError extends RagError {
  constructor(message: string) {
    super(message, "ERR_PRISM_RAG_VALIDATION");
    this.name = "RagValidationError";
  }
}

export class RagLimitError extends RagError {
  constructor(message: string) {
    super(message, "ERR_PRISM_RAG_LIMIT");
    this.name = "RagLimitError";
  }
}

export class RagScopeError extends RagError {
  constructor(message: string) {
    super(message, "ERR_PRISM_RAG_SCOPE");
    this.name = "RagScopeError";
  }
}

export class RagAbortError extends RagError {
  constructor() {
    super("RAG operation aborted", "ERR_PRISM_RAG_ABORTED");
    this.name = "AbortError";
  }
}
