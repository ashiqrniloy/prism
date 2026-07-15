import type { ToolDefinition } from "@arnilo/prism";

export interface McpStdioTransport {
  readonly type: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly stderr?: "inherit" | "pipe" | "ignore" | "overlapped";
}

export interface McpStreamableHttpTransport {
  readonly type: "streamable-http";
  readonly url: string;
  readonly requestInit?: RequestInit;
  readonly sessionId?: string;
}

export type McpTransportConfig = McpStdioTransport | McpStreamableHttpTransport;

export type AttachMcpToolBridgeOptions = Omit<ConnectMcpToolsOptions, "transport">;

export interface ConnectMcpToolsOptions {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  readonly namePrefix?: string;
  readonly listCacheTtlMs?: number;
  readonly callTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly signal?: AbortSignal;
}

export interface McpToolBridge {
  readonly tools: readonly ToolDefinition[];
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export class McpBridgeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpBridgeError";
  }
}

export class McpToolNameCollisionError extends McpBridgeError {
  constructor(
    public readonly prefixedName: string,
    public readonly remoteName: string,
  ) {
    super(`MCP tool name collision: ${prefixedName} (remote tool ${remoteName})`);
    this.name = "McpToolNameCollisionError";
  }
}

export class McpBridgeClosedError extends McpBridgeError {
  constructor() {
    super("MCP bridge is closed");
    this.name = "McpBridgeClosedError";
  }
}
