/**
 * ACP adapter error codes (Phase 10 freeze, scripts/phase10-freeze-manifest.json
 * errorCodes): INPUT (malformed protocol input), LIMIT (frozen cap exceeded),
 * POLICY (host policy denial), CAPABILITY (client method called without the
 * matching initialize advertisement), MCP (MCP seam failures), RUN (run-level
 * failure surfaced as a `session/prompt` request error, 0.2.8 B2).
 */
export type AcpErrorCode =
  | "ERR_PRISM_ACP_INPUT"
  | "ERR_PRISM_ACP_LIMIT"
  | "ERR_PRISM_ACP_POLICY"
  | "ERR_PRISM_ACP_CAPABILITY"
  | "ERR_PRISM_ACP_MCP"
  | "ERR_PRISM_ACP_RUN";

export class AcpError extends Error {
  readonly code: AcpErrorCode;

  constructor(code: AcpErrorCode, message: string) {
    super(message);
    this.name = "AcpError";
    this.code = code;
  }
}
