/** Stable browser-package errors. Messages stay bounded and omit storage/secrets. */

export type BrowserErrorCode =
  | "ERR_PRISM_BROWSER"
  | "ERR_PRISM_BROWSER_LIMIT"
  | "ERR_PRISM_BROWSER_STATE"
  | "ERR_PRISM_BROWSER_TARGET"
  | "ERR_PRISM_BROWSER_CLOSED"
  | "ERR_PRISM_BROWSER_INPUT"
  | "ERR_PRISM_BROWSER_NETWORK"
  | "ERR_PRISM_BROWSER_ARTIFACT";

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;

  constructor(code: BrowserErrorCode, message: string) {
    super(truncateMessage(message));
    this.name = "BrowserError";
    this.code = code;
  }
}

const MAX_ERROR_BYTES = 1_024;

function truncateMessage(message: string): string {
  const buf = Buffer.from(message, "utf8");
  if (buf.byteLength <= MAX_ERROR_BYTES) return message;
  return buf.subarray(0, MAX_ERROR_BYTES).toString("utf8") + "…";
}
