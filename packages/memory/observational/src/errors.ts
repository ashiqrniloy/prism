/**
 * Observational memory errors. The worker loop raises these so a caller can tell a limit stop from
 * a provider failure without parsing messages. The 0.12 `MemoryError` in the retired memory family
 * stays there for the family's other modules; this package owns its own.
 */
export class ObservationalMemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ObservationalMemoryError";
    this.code = code;
  }
}

export class ObservationalMemoryLimitError extends ObservationalMemoryError {
  constructor(message: string) {
    super("limit", message);
    this.name = "ObservationalMemoryLimitError";
  }
}
