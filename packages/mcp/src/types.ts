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
import type { AuthInfo, CacheHint, ServerEventBus, ServerNotifier } from "@modelcontextprotocol/server";
import type { McpClientAuthOptions } from "./auth.js";

/** MCP methods whose 2026-07-28 results carry server cache hints (SEP-2549). */
export type PrismMcpCacheableMethod =
  | "tools/list"
  | "prompts/list"
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "server/discover";

/** Per-method cache hints the server emits on cacheable modern results. */
export type PrismMcpCacheHints = Partial<Record<PrismMcpCacheableMethod, CacheHint>>;

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
  /** Per-method cache hints emitted on cacheable 2026-07-28 results (SEP-2549); absent keeps SDK defaults (ttlMs: 0, private). */
  readonly cacheHints?: PrismMcpCacheHints;
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
  /** Legacy-only: configures sessionful 2025-era serving beside the modern handler. */
  readonly sessionIdGenerator?: () => string;
  readonly maxSessions?: number;
  /** Exact Host header allowlist; checked before body parsing and auth on every request. */
  readonly allowedHosts?: readonly string[];
  /** Exact Origin allowlist; checked before body parsing and auth on every request. */
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  /** Ceiling on concurrently open modern `subscriptions/listen` streams (SDK default 1024). */
  readonly maxSubscriptions?: number;
  /** SSE keepalive interval in ms for modern subscription streams; 0 disables (SDK default 15000). */
  readonly keepAliveMs?: number;
}

/**
 * Callable web handler with SDK lifecycle/notification properties. The call
 * signature stays source-compatible with pre-2.0 handlers; `fetch` is the
 * same function as the web-standard face, `close` tears down both eras, and
 * `notify`/`bus` publish to open modern `subscriptions/listen` streams.
 */
export type PrismMcpWebHandler = ((request: Request) => Promise<Response>) & {
  readonly fetch: (request: Request) => Promise<Response>;
  close(): Promise<void>;
  readonly notify: ServerNotifier;
  readonly bus: ServerEventBus;
};

/** Options for {@linkcode servePrismMcpStdio} (dual-era stdio serving). */
export interface ServePrismMcpStdioOptions {
  /** `serve` (default) pins a 2025-era instance for a legacy opening; `reject` answers it with the unsupported-protocol-version error. */
  readonly legacy?: "serve" | "reject";
  /** Ceiling on concurrently open `subscriptions/listen` streams on the connection (SDK default 1024). */
  readonly maxSubscriptions?: number;
}

/** Handle returned by {@linkcode servePrismMcpStdio}. */
export interface PrismMcpStdioHandle {
  close(): Promise<void>;
}

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
  /**
   * Client-side protocol-era negotiation for bridge-owned clients.
   *
   * - `"auto"` (default): probe the server with `server/discover` once at connect; definitive
   *   modern evidence selects the 2026-07-28 era, anything unrecognized falls back to the plain
   *   2025 legacy `initialize` handshake. Adds one bounded discovery probe per connection.
   * - `"legacy"`: no probe; byte-identical 2025 connect sequence.
   * - `{ pin: "2026-07-28" }`: modern era at exactly the pinned revision; anything else fails loudly.
   */
  readonly protocolVersion?: McpProtocolNegotiation;
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

/** Protocol-era negotiation selector (see {@linkcode ConnectMcpToolsOptions.protocolVersion}). */
export type McpProtocolNegotiation = "legacy" | "auto" | { readonly pin: string };

/**
 * A host-approved filesystem root. Deprecated with the `roots` capability in MCP 2026-07-28 (SEP-2577).
 * @deprecated Server-to-client `roots/list` is deprecated in MCP 2026-07-28 and remains in the spec for at least twelve months; prefer explicit tool arguments for host-owned state. Kept for existing legacy callers.
 */
export interface McpRoot {
  readonly uri: string;
  readonly name?: string;
}
/** @deprecated Server-to-client sampling is deprecated in MCP 2026-07-28 (SEP-2577); kept for legacy compatibility only. */
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
  /**
   * Host-approved filesystem roots for server-to-client `roots/list`.
   * @deprecated Deprecated in MCP 2026-07-28 (SEP-2577) and retained only for existing legacy callers; prefer explicit tool arguments. Synapta adds nothing on this surface.
   */
  readonly roots?: () => readonly McpRoot[] | Promise<readonly McpRoot[]>;
  /**
   * Host-owned sampling (model/credentials stay with the host) for server-to-client `sampling/createMessage`.
   * @deprecated Deprecated in MCP 2026-07-28 (SEP-2577) and retained only for existing legacy callers; prefer host-side model calls exposed as tools. Synapta adds nothing on this surface.
   */
  readonly sampling?: (request: PrismMcpSamplingRequest) => unknown | Promise<unknown>;
  /** Active capability: form/URL elicitation, fulfilled through SDK MRTR auto-fulfilment on the modern era and direct server-to-client dispatch on legacy. */
  readonly elicitation?: (request: PrismMcpElicitationRequest) => unknown | Promise<unknown>;
  /**
   * Maximum multi-round-trip (MRTR) fulfilment rounds per operation when a modern server answers `input_required`.
   * Defaults to 10 (the SDK's own default); the hard cap is 10, so this option only ever tightens the bound.
   */
  readonly maxMrtrRounds?: number;
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
  /** Negotiated protocol era after connect: `"modern"` (2026-07-28+) or `"legacy"` (2025-era initialize). */
  readonly protocolEra?: "legacy" | "modern";
  /** Negotiated protocol revision (e.g. `"2025-11-25"` legacy, `"2026-07-28"` modern). */
  readonly protocolVersion?: string;
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
