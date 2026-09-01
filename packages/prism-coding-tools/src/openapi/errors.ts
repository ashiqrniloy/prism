export type OpenApiToolErrorCode =
  | "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS"
  | "ERR_PRISM_OPENAPI_OPERATION_UNKNOWN"
  | "ERR_PRISM_OPENAPI_SERVER_DRIFT"
  | "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS"
  | "ERR_PRISM_OPENAPI_RESPONSE_BOUNDS"
  | "ERR_PRISM_OPENAPI_RETRY_EXHAUSTED";

export class OpenApiToolError extends Error {
  readonly code: OpenApiToolErrorCode;
  constructor(code: OpenApiToolErrorCode, message: string) {
    super(message);
    this.name = "OpenApiToolError";
    this.code = code;
  }
}
