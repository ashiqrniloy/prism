export class PromptError extends Error {
  readonly code: string;

  constructor(message: string, code = "ERR_PRISM_PROMPT", options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "PromptError";
    this.code = code;
  }
}

export class PromptValidationError extends PromptError {
  constructor(message: string, code = "ERR_PRISM_PROMPT_VALIDATION") {
    super(message, code);
    this.name = "PromptValidationError";
  }
}

export class PromptLimitError extends PromptError {
  constructor(message: string) {
    super(message, "ERR_PRISM_PROMPT_BOUNDS");
    this.name = "PromptLimitError";
  }
}

export class PromptOwnershipError extends PromptError {
  constructor(message = "prompt ownership is invalid") {
    super(message, "ERR_PRISM_PROMPT_OWNERSHIP");
    this.name = "PromptOwnershipError";
  }
}

export class PromptNotFoundError extends PromptError {
  constructor(message = "prompt version not found") {
    super(message, "ERR_PRISM_PROMPT_NOT_FOUND");
    this.name = "PromptNotFoundError";
  }
}

export class PromptIntegrityError extends PromptError {
  constructor(message = "stored prompt hash does not match body") {
    super(message, "ERR_PRISM_PROMPT_INTEGRITY");
    this.name = "PromptIntegrityError";
  }
}

export class PromptMigrationError extends PromptError {
  constructor(message: string) {
    super(message, "ERR_PRISM_PROMPT_MIGRATION");
    this.name = "PromptMigrationError";
  }
}
