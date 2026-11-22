/** A2A 1.0 JSON-RPC error codes (spec §5.4) plus the standard JSON-RPC 2.0 codes. */
export const A2A_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Implementation-defined (JSON-RPC server-error range): a bound on concurrent tasks or contexts was hit. */
  overloaded: -32000,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  invalidAgentResponse: -32006,
  extendedAgentCardNotConfigured: -32007,
  extensionSupportRequired: -32008,
  versionNotSupported: -32009,
} as const;

export type A2AErrorName = keyof typeof A2A_ERROR_CODES;

/** A protocol error answered as a JSON-RPC `error`. The message is fixed text, never caller or secret data. */
export class A2AError extends Error {
  readonly code: number;
  readonly errorName: A2AErrorName;
  /** HTTP status of the response that carries this error. JSON-RPC errors ride a 200 unless the transport itself failed. */
  readonly status: number;

  constructor(name: A2AErrorName, message: string, status = 200) {
    super(message);
    this.name = "A2AError";
    this.errorName = name;
    this.code = A2A_ERROR_CODES[name];
    this.status = status;
  }
}

/** Invalid `serveA2A` / `connectA2A` options, thrown at construction. */
export class A2AConfigError extends Error {
  readonly code = "ERR_PRISM_A2A_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "A2AConfigError";
  }
}

/** The `A2AErrorName` for a wire error code; an unknown code reads as `internalError`. */
export function a2aErrorNameOf(code: unknown): A2AErrorName {
  for (const [name, value] of Object.entries(A2A_ERROR_CODES)) if (value === code) return name as A2AErrorName;
  return "internalError";
}

export type A2AClientErrorCode =
  /** A proxy member with no A2A equivalent (`commands`, `reload`, `models`, `fork`, …). */
  | "a2a_unsupported"
  /** The peer's Agent Card is malformed, or its endpoint is on an origin the host did not allow. */
  | "a2a_invalid_card"
  /** The URL failed the SSRF checks, the connection failed, or a byte or time bound was hit. */
  | "a2a_transport"
  /** The peer answered something that is not A2A 1.0. */
  | "a2a_invalid_response"
  /** The session already has a run in progress. */
  | "a2a_busy"
  /** `resume` on a session with no task waiting for decisions in this process. */
  | "a2a_no_pending_task";

/** A `connectA2A` proxy failure. The message is fixed or bounded text and never holds the token. */
export class A2AClientError extends Error {
  readonly code: A2AClientErrorCode;
  constructor(code: A2AClientErrorCode, message: string) {
    super(message);
    this.name = "A2AClientError";
    this.code = code;
  }
}

export const A2A_LITERAL_SECRET_CODE = "ERR_PRISM_A2A_LITERAL_SECRET";

/** A credential option held a literal secret instead of an `env:` / `keyring:` ref. */
export class A2ALiteralSecretError extends Error {
  readonly code = A2A_LITERAL_SECRET_CODE;
  constructor(field: string) {
    super(`${field} must be an env: or keyring: reference, not a literal secret`);
    this.name = "A2ALiteralSecretError";
  }
}
