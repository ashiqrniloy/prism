import type {
  AgentIdentity,
  AgentRunLifecycle,
  CommandDefinition,
  Guardrails,
  JsonObject,
  MediaHostnameResolver,
  OwnershipScope,
  PermissionPolicy,
  RunLimits,
  SecretRedactor,
  ToolDefinition,
  ToolEffectDeclaration,
  ToolEffectStore,
  ToolExecutionContext,
  ToolResult,
  ToolValidator,
} from "@arnilo/prism";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpClientAuthOptions } from "./auth.js";

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
  /** Optional OAuth client integration (RFC 9728 discovery, PKCE, refresh, RFC 8707 binding). */
  readonly auth?: McpClientAuthOptions;
}

export type McpTransportConfig = McpStdioTransport | McpStreamableHttpTransport;

export interface PrismMcpAuthorizationInput {
  readonly kind: "tool" | "command" | "resource" | "prompt";
  readonly name: string;
  readonly arguments: JsonObject;
  readonly authInfo?: AuthInfo;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
}

export interface PrismMcpAuthorization {
  readonly allowed: true;
  readonly ownership?: OwnershipScope;
  /** Host-verified identity; when set must project onto ownership without widening. */
  readonly identity?: AgentIdentity;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type PrismMcpAuthorizer = (
  input: PrismMcpAuthorizationInput,
) => false | PrismMcpAuthorization | Promise<false | PrismMcpAuthorization>;

/** Explicit durable agent lifecycle capability. Omit it to register no status/resume tools. */
export interface PrismMcpAgentRunExposure {
  readonly lifecycle: AgentRunLifecycle;
}

export interface PrismMcpResource {
  readonly name: string;
  readonly uri: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly read: (input: {
    readonly uri: string;
    readonly authorization: PrismMcpAuthorization;
    readonly signal: AbortSignal;
  }) => unknown | Promise<unknown>;
}

export interface PrismMcpPrompt {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  /** Keep schemas shallow: MCP prompt arguments are strings. */
  readonly arguments?: Readonly<Record<string, { readonly description?: string; readonly required?: boolean }>>;
  readonly get: (input: {
    readonly arguments: Readonly<Record<string, string>>;
    readonly authorization: PrismMcpAuthorization;
    readonly signal: AbortSignal;
  }) => unknown | Promise<unknown>;
}

export interface CreatePrismMcpServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly commands?: readonly CommandDefinition[];
  readonly resources?: readonly PrismMcpResource[];
  readonly prompts?: readonly PrismMcpPrompt[];
  /** Explicit durable agent lifecycle capabilities keyed by host-selected agent id. */
  readonly agentRuns?: Readonly<Record<string, PrismMcpAgentRunExposure>>;
  readonly authorize: PrismMcpAuthorizer;
  readonly permission?: PermissionPolicy;
  readonly validate?: ToolValidator;
  readonly redactor?: SecretRedactor;
  /** Optional core recovery store for registered Prism tool dispatch. */
  readonly effectStore?: ToolEffectStore;
  /** Applied only to registered Prism tools; commands remain host callbacks. */
  readonly guardrails?: Guardrails;
  /** Per MCP tool-call ceilings. */
  readonly limits?: RunLimits;
  readonly maxResultBytes?: number;
  readonly maxConcurrentCalls?: number;
  readonly callTimeoutMs?: number;
}

export interface PrismMcpRequestIdentity {
  /** Stable non-secret principal identifier derived from validated host auth. */
  readonly id: string;
  readonly ownership?: OwnershipScope;
}

/** RFC 9728 OAuth 2.0 protected-resource metadata advertised by a Prism MCP server. */
export interface McpProtectedResource {
  /** Authorization server URL(s) clients must use (RFC 8414 discovery target). */
  readonly authorizationServers: readonly string[];
  /** RFC 8707 resource indicator; usually the MCP server's own URL. */
  readonly resource?: string;
  /** Scope values the server may require. */
  readonly scopesSupported?: readonly string[];
}

export interface CreatePrismMcpWebHandlerOptions {
  readonly resolveAuthInfo?: (request: Request) => AuthInfo | undefined | Promise<AuthInfo | undefined>;
  /** Required for stateful sessions; binds every session request to one validated host principal. */
  readonly resolveIdentity?: (
    request: Request,
    authInfo: AuthInfo | undefined,
  ) => PrismMcpRequestIdentity | false | Promise<PrismMcpRequestIdentity | false>;
  /** When set, serves RFC 9728 protected-resource metadata and challenges unauthenticated requests. */
  readonly protectedResource?: McpProtectedResource;
  readonly sessionIdGenerator?: () => string;
  readonly maxSessions?: number;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
}

export type PrismMcpWebHandler = (request: Request) => Promise<Response>;

export type AttachMcpToolBridgeOptions = Omit<ConnectMcpToolsOptions, "transport">;

export interface McpUiResourceMetadata {
  readonly csp?: Readonly<{
    readonly connectDomains?: readonly string[];
    readonly resourceDomains?: readonly string[];
    readonly frameDomains?: readonly string[];
    readonly baseUriDomains?: readonly string[];
  }>;
  readonly permissions?: Readonly<{
    readonly camera?: true;
    readonly microphone?: true;
    readonly geolocation?: true;
    readonly clipboardWrite?: true;
  }>;
  /** Advisory only. Hosts select sandbox origins; this value never controls one. */
  readonly domain?: string;
  readonly prefersBorder?: boolean;
}

export interface McpAppTool {
  readonly name: string;
  readonly prismName: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly resourceUri?: string;
  readonly visibility: readonly ("model" | "app")[];
}

export interface McpAppResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType: "text/html;profile=mcp-app";
  readonly html: string;
  readonly ui?: McpUiResourceMetadata;
}

export interface McpAppsBridge {
  readonly serverId: string;
  readonly negotiated: true;
  /** Includes app-only tools. `McpToolBridge.tools` contains model-visible tools only. */
  readonly tools: readonly McpAppTool[];
  listResources(): Promise<readonly Omit<McpAppResource, "html">[]>;
  readResource(uri: string): Promise<McpAppResource>;
  /** App calls remain host-approved; this method performs no retries or effect recovery. */
  callTool(name: string, args: JsonObject, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface McpToolEffectPolicyInput {
  /** Exact host-configured server/tool selector; remote descriptions and annotations are excluded. */
  readonly serverId: string;
  readonly remoteName: string;
}

/** Host review classifies remote tools. Omission is deliberately nonrecoverable. */
export type McpToolEffectPolicy = (input: McpToolEffectPolicyInput) => ToolEffectDeclaration | undefined;

export interface ConnectMcpToolsOptions {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  readonly namePrefix?: string;
  /** Host-owned remote tool policy; unclassified tools remain external and unsupported. */
  readonly effect?: McpToolEffectPolicy;
  /** Explicitly negotiate `io.modelcontextprotocol/ui`; false/omitted preserves normal MCP behavior. */
  readonly mcpApps?: boolean;
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

export interface McpRoot {
  readonly uri: string;
  readonly name?: string;
}
export interface PrismMcpSamplingRequest {
  readonly params: unknown;
  readonly signal: AbortSignal;
}
export interface PrismMcpElicitationRequest {
  readonly params: unknown;
  readonly signal: AbortSignal;
}
/** Host callback may return this marker; accepted elicitation fails closed without it. Marker is removed before protocol output. */
export interface PrismMcpElicitationResult extends Readonly<Record<string, unknown>> {
  readonly action: "accept" | "decline" | "cancel";
  readonly humanInteraction?: true;
}

export interface ConnectMcpCapabilitiesOptions extends ConnectMcpToolsOptions {
  readonly roots?: () => readonly McpRoot[] | Promise<readonly McpRoot[]>;
  readonly sampling?: (request: PrismMcpSamplingRequest) => unknown | Promise<unknown>;
  readonly elicitation?: (request: PrismMcpElicitationRequest) => unknown | Promise<unknown>;
  readonly maxCapabilityBytes?: number;
}

export interface McpCapabilityBridge extends McpToolBridge {
  readonly serverVersion?: Readonly<{ name: string; version: string }>;
  readonly serverCapabilities: Readonly<Record<string, unknown>>;
  listResources(): Promise<readonly unknown[]>;
  readResource(uri: string): Promise<unknown>;
  listPrompts(): Promise<readonly unknown[]>;
  getPrompt(name: string, args?: Readonly<Record<string, string>>): Promise<unknown>;
}

export interface McpToolBridge {
  readonly tools: readonly ToolDefinition[];
  /** Present only when `mcpApps: true` negotiated the MCP Apps extension. */
  readonly apps?: McpAppsBridge;
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export class McpUnsupportedCapabilityError extends Error {
  readonly code = "ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY";
  constructor(readonly capability: string) {
    super(`Unsupported MCP capability: ${capability}`);
    this.name = "McpUnsupportedCapabilityError";
  }
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
