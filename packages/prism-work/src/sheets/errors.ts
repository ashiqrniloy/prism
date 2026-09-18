/**
 * Base error class for all sheets and CSV operations.
 */
export class SheetsError extends Error {
  readonly code: string;

  constructor(message: string, code = "ERR_PRISM_SHEETS") {
    super(message);
    this.name = "SheetsError";
    this.code = code;
  }
}

/**
 * Thrown when an input buffer or structural element exceeds configured limits/caps.
 */
export class SheetsCapError extends SheetsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_SHEETS_CAP");
    this.name = "SheetsCapError";
  }
}

/**
 * Thrown when options or configurations violate validation constraints.
 */
export class SheetsValidationError extends SheetsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_SHEETS_VALIDATION");
    this.name = "SheetsValidationError";
  }
}

/**
 * Thrown when an input format is unsupported (e.g. non-ZIP header on XLSX, unsupported encoding).
 */
export class SheetsFormatError extends SheetsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT");
    this.name = "SheetsFormatError";
  }
}

/**
 * Thrown when parsing corrupted, malformed, or unrecoverable XML/CSV data fails.
 */
export class SheetsParseError extends SheetsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_SHEETS_PARSE_FAILED");
    this.name = "SheetsParseError";
  }
}
