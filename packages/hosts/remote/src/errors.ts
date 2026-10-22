/** Stable codes carried in JSON-RPC `error.data.code` and on `RemoteError.code`. */
export type RemoteErrorCode =
  | "invalid_frame"
  | "frame_too_large"
  | "method_not_found"
  | "invalid_params"
  | "internal_error"
  | "busy"
  | "not_initialized"
  | "protocol_unsupported"
  | "unauthorized"
  | "forbidden_host"
  | "forbidden_origin"
  | "body_too_large"
  | "remote_unsupported"
  | "disconnected"
  | "session_not_found"
  | "limit"
  | "literal_secret"
  | "unauthenticated_bind";

export class RemoteError extends Error {
  readonly code: RemoteErrorCode;

  constructor(code: RemoteErrorCode, message: string) {
    super(message);
    this.name = "RemoteError";
    this.code = code;
  }
}

const JSON_RPC_CODES: Record<RemoteErrorCode, number> = {
  invalid_frame: -32600,
  frame_too_large: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
  internal_error: -32603,
  busy: -32001,
  not_initialized: -32002,
  protocol_unsupported: -32003,
  unauthorized: -32004,
  forbidden_host: -32005,
  forbidden_origin: -32006,
  body_too_large: -32007,
  remote_unsupported: -32008,
  disconnected: -32009,
  session_not_found: -32010,
  limit: -32011,
  literal_secret: -32012,
  unauthenticated_bind: -32013,
};

export function jsonRpcCodeOf(code: RemoteErrorCode): number {
  return JSON_RPC_CODES[code];
}

export function isRemoteErrorCode(value: unknown): value is RemoteErrorCode {
  return typeof value === "string" && Object.hasOwn(JSON_RPC_CODES, value);
}
