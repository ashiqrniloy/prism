export type ProcessDriverErrorCode =
  | "vendor_request_unhandled"
  | "vendor_request_failed"
  | "vendor_limit"
  | "adapter_invalid"
  | "vendor_process_exited";

export class ProcessDriverError extends Error {
  constructor(
    readonly code: ProcessDriverErrorCode,
    message: string,
    readonly deferUntil?: string,
  ) {
    super(`${code}: ${message}${deferUntil ? ` (deferUntil: ${deferUntil})` : ""}`);
    this.name = "ProcessDriverError";
  }
}
