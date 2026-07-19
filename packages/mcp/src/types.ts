import type {
  CommandDefinition,
  JsonObject,
  OwnershipScope,
  PermissionPolicy,
  SecretRedactor,
  ToolDefinition,
  ToolValidator,
  MediaHostnameResolver,
} from "@arnilo/prism";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

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
  /** Exact origins allowed for the initial endpoint and every session/reconnect request. */
  readonly allowedOrigins: readonly string[];
  /** Permit plaintext only when every resolved address is loopback. */
  readonly allowLoopbackHttp?: boolean;
  readonly maxResponseBytes?: number;
  readonly requestInit?: RequestInit;
  readonly sessionId?: string;
  /** Test/host DNS seam; every returned address is still validated and one address is pinned. */
  readonly resolveHostname?: MediaHostnameResolver;
}

export type McpTransportConfig = McpStdioTransport | McpStreamableHttpTransport;

export interface PrismMcpAuthorizationInput {
  readonly kind: "tool" | "command";
  readonly name: string;
  readonly arguments: JsonObject;
  readonly authInfo?: AuthInfo;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
}

export interface PrismMcpAuthorization {
  readonly allowed: true;
  readonly ownership?: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type PrismMcpAuthorizer = (
  input: PrismMcpAuthorizationInput,
) => false | PrismMcpAuthorization | Promise<false | PrismMcpAuthorization>;

export interface CreatePrismMcpServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly commands?: readonly CommandDefinition[];
  readonly authorize: PrismMcpAuthorizer;
  readonly permission?: PermissionPolicy;
  readonly validate?: ToolValidator;
  readonly redactor?: SecretRedactor;
  readonly maxResultBytes?: number;
  readonly maxConcurrentCalls?: number;
  readonly callTimeoutMs?: number;
}

export interface CreatePrismMcpWebHandlerOptions {
  readonly resolveAuthInfo?: (request: Request) => AuthInfo | undefined | Promise<AuthInfo | undefined>;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
}

export type PrismMcpWebHandler = (request: Request) => Promise<Response>;

export type AttachMcpToolBridgeOptions = Omit<ConnectMcpToolsOptions, "transport">;

export interface ConnectMcpToolsOptions {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  readonly namePrefix?: string;
  readonly listCacheTtlMs?: number;
  readonly callTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly maxListPages?: number;
  readonly maxTools?: number;
  readonly maxCursorBytes?: number;
  readonly maxToolNameBytes?: number;
  readonly maxToolDescriptionBytes?: number;
  readonly maxToolSchemaBytes?: number;
  readonly maxTotalToolSchemaBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
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
