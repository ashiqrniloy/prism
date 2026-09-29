/**
 * Agent SDK error family. All SDK config/assembly errors use this class
 * with code `ERR_PRISM_AGENT_SDK_CONFIG`.
 *
 * Error messages are bounded — they name the offending key/tool name
 * but never echo arbitrary config values.
 */
export class AgentSdkConfigError extends Error {
  readonly code = "ERR_PRISM_AGENT_SDK_CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentSdkConfigError";
  }
}

/**
 * Runtime MCP connect/reconnect failure. Messages are redacted and bounded by the
 * plane before construction; the class never carries transport credentials.
 */
export class McpConnectError extends Error {
  readonly code = "ERR_PRISM_MCP_CONNECT" as const;

  constructor(
    readonly serverId: string,
    message: string,
  ) {
    super(message);
    this.name = "McpConnectError";
  }
}
