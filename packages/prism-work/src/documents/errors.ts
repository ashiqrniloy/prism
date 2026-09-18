export class DocumentsError extends Error {
  readonly code: string;

  constructor(message: string, code = "ERR_PRISM_DOCUMENTS") {
    super(message);
    this.name = "DocumentsError";
    this.code = code;
  }
}

export class DocumentsCapError extends DocumentsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_DOCUMENTS_CAP");
    this.name = "DocumentsCapError";
  }
}

export class DocumentsValidationError extends DocumentsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_DOCUMENTS_INVALID_MODEL");
    this.name = "DocumentsValidationError";
  }
}

export class DocumentsFormatError extends DocumentsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT");
    this.name = "DocumentsFormatError";
  }
}

export class DocumentsParseError extends DocumentsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_DOCUMENTS_PARSE_FAILED");
    this.name = "DocumentsParseError";
  }
}

export class DocumentsPatchError extends DocumentsError {
  constructor(message: string) {
    super(message, "ERR_PRISM_DOCUMENTS_UNSAFE_PATH");
    this.name = "DocumentsPatchError";
  }
}
