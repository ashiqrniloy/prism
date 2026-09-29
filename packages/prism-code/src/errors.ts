/**
 * Custom error types for @arnilo/prism-code.
 */

export class PrismCodeConfigError extends Error {
  readonly code = "ERR_PRISM_CODE_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "PrismCodeConfigError";
  }
}

export class PrismCodeModuleError extends Error {
  readonly code = "ERR_PRISM_CODE_MODULE";
  constructor(message: string) {
    super(message);
    this.name = "PrismCodeModuleError";
  }
}

export class PrismCodeExecutionError extends Error {
  readonly code = "ERR_PRISM_CODE_EXECUTION";
  constructor(message: string) {
    super(message);
    this.name = "PrismCodeExecutionError";
  }
}
