export type AgUiErrorCode = "ERR_PRISM_AG_UI_LIMIT" | "ERR_PRISM_AG_UI_EVENT" | "ERR_PRISM_AG_UI_INPUT" | "ERR_PRISM_AG_UI_FORBIDDEN" | "ERR_PRISM_AG_UI_REPLAY";

export class AgUiError extends Error {
  readonly code: AgUiErrorCode;

  constructor(code: AgUiErrorCode, message: string) {
    super(truncate(message, 1_024));
    this.name = "AgUiError";
    this.code = code;
  }
}

function truncate(value: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) return value.slice(0, end) + "…";
    bytes += size;
    end += char.length;
  }
  return value;
}
