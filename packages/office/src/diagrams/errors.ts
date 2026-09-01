export type DiagramsErrorCode =
  | "ERR_PRISM_DIAGRAMS"
  | "ERR_PRISM_DIAGRAMS_ORIGIN_INVALID"
  | "ERR_PRISM_DIAGRAMS_PROTOCOL"
  | "ERR_PRISM_DIAGRAMS_XXE"
  | "ERR_PRISM_DIAGRAMS_XML_MALFORMED"
  | "ERR_PRISM_DIAGRAMS_XML_CAP"
  | "ERR_PRISM_DIAGRAMS_XML_INVALID_MODEL"
  | "ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT"
  | "ERR_PRISM_DIAGRAMS_TIMEOUT";

export class DiagramsError extends Error {
  readonly code: DiagramsErrorCode;

  constructor(code: DiagramsErrorCode, message: string) {
    super(message);
    this.name = "DiagramsError";
    this.code = code;
  }
}

export class DiagramsOriginError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_ORIGIN_INVALID", message);
    this.name = "DiagramsOriginError";
  }
}

export class DiagramsProtocolError extends DiagramsError {
  constructor(message: string, code: DiagramsErrorCode = "ERR_PRISM_DIAGRAMS_PROTOCOL") {
    super(code, message);
    this.name = "DiagramsProtocolError";
  }
}

export class DiagramsXxeError extends DiagramsError {
  constructor(message = "XML contains forbidden DOCTYPE or ENTITY declaration") {
    super("ERR_PRISM_DIAGRAMS_XXE", message);
    this.name = "DiagramsXxeError";
  }
}

export class DiagramsCapError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_XML_CAP", message);
    this.name = "DiagramsCapError";
  }
}

export class DiagramsXmlMalformedError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_XML_MALFORMED", message);
    this.name = "DiagramsXmlMalformedError";
  }
}

export class DiagramsModelInvalidError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_XML_INVALID_MODEL", message);
    this.name = "DiagramsModelInvalidError";
  }
}

export class DiagramsFormatError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT", message);
    this.name = "DiagramsFormatError";
  }
}

export class DiagramsTimeoutError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_TIMEOUT", message);
    this.name = "DiagramsTimeoutError";
  }
}
