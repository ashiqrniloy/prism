import type { EventOrigin, JsonObject, JsonValue, OwnershipScope, SecretRedactor, ToolCapabilityKind, ToolDefinition } from "@arnilo/prism";
import type { CallbackBroker, McpEndpoint } from "@arnilo/prism/driver-kit";
import type { McpProtectedResource } from "@arnilo/prism-extensions/mcp";
import type { AuthInfo, CallToolResult, ServerEventBus, ServerNotifier, Transport } from "@modelcontextprotocol/server";

/** What `serveMcp`'s `authorize` callback receives before any session is opened. */
export interface PrismMcpAuthorizationInput {
  readonly kind: "tool" | "prompt";
  readonly name: string;
  readonly arguments: JsonObject;
  readonly authInfo?: AuthInfo;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
}

/**
 * A host decision. `ownership` is carried through unchanged; identity is the agent's own
 * governance concern (governance hooks), not this transport's.
 */
export interface PrismMcpAuthorization {
  readonly allowed: true;
  readonly ownership?: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type PrismMcpAuthorizer = (
  input: PrismMcpAuthorizationInput,
) => false | PrismMcpAuthorization | Promise<false | PrismMcpAuthorization>;

/** Options for {@linkcode serveMcp}. Exactly one transport must be selected. */
export interface ServeMcpOptions {
  /** Serve the process's stdio. */
  readonly stdio?: true;
  /** Serve a caller-owned transport (in-process tests, embedded hosts). */
  readonly transport?: Transport;
  /** Serve a web-standard Streamable HTTP handler built by {@linkcode createPrismMcpWebHandler}. */
  readonly http?: CreatePrismMcpWebHandlerOptions;
  /**
   * Allow/deny every tool and prompt before a session is opened. Absent allows
   * the peer (a local stdio process); a throwing callback denies.
   */
  readonly authorize?: PrismMcpAuthorizer;
  /** Tool name. Default `prompt`. */
  readonly toolName?: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
  /** Masks secrets in tool results and errors. */
  readonly redactor?: SecretRedactor;
  /** Byte ceiling on one `prompt` argument. Default 64 KiB, hard cap 1 MiB. */
  readonly maxPromptBytes?: number;
  /** Byte ceiling on one tool/prompt result. Default 1 MiB, hard cap 8 MiB. */
  readonly maxResultBytes?: number;
}

/** Handle returned by {@linkcode serveMcp}. */
export interface ServeMcpHandle {
  /** Resolves when the connection ends or {@linkcode ServeMcpHandle.close} is called. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
  /** Web-standard handler; present only for `{ http }`. */
  readonly handler?: (request: Request) => Promise<Response>;
}

export interface PrismMcpRequestIdentity {
  /** Stable non-secret principal identifier derived from validated host auth. */
  readonly id: string;
  readonly ownership?: OwnershipScope;
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
  /** Bring your own transport instead of the process's stdio. */
  readonly transport?: Transport;
  /** Ceiling on concurrently open `subscriptions/listen` streams on the connection (SDK default 1024). */
  readonly maxSubscriptions?: number;
}

/** Handle returned by {@linkcode servePrismMcpStdio}. */
export interface PrismMcpStdioHandle {
  close(): Promise<void>;
}

/** A static MCP resource `serveTools` serves. Host-supplied text, served as-is. */
export interface ServeToolsResource {
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string;
  /** Served verbatim. Never put a secret here: `resources/read` returns it to the client unchanged. */
  readonly text: string;
}

/** Bounds for {@linkcode serveTools}. */
export interface ServeToolsLimits {
  /** In-flight `tools/call` ceiling. Default 8, hard cap 64. A call over the cap is a JSON-RPC error, never queued. */
  readonly maxConcurrentCalls?: number;
  /** Byte ceiling on one tool result. Default 1 MiB, hard cap 8 MiB. */
  readonly resultBytes?: number;
}

/** How the driver's binary reaches the served tools. */
export type ServeToolsTransport = "loopback-http" | "stdio-relay";

/** The neutral permission-tool input, after decoding. */
export interface PermissionRequest {
  readonly toolName: string;
  readonly input: JsonObject;
  /** Defaults to a fresh random id. */
  readonly toolCallId?: string;
}

/** The neutral permission-tool decision, the JSON text of a neutral `tools/call` result. */
export interface PermissionDecision {
  readonly behavior: "allow" | "deny";
  /** Present on an allow when `rewrite` is set and the gate rewrote the arguments. */
  readonly updatedInput?: JsonObject;
  /** Present on a deny: why the call was not allowed. */
  readonly message?: string;
}

/**
 * Maps a vendor's permission-prompt shape to and from the neutral one. `decode` receives the raw
 * `tools/call` arguments; `encode` returns the whole MCP result. This is the only vendor-shape hook
 * in the package — none ships. A throwing `decode` or `encode` denies in the neutral shape.
 */
export interface PermissionCodec {
  decode(args: JsonValue): PermissionRequest;
  encode(decision: PermissionDecision): CallToolResult;
}

/** The optional permission-prompt tool {@linkcode serveTools} serves beside the allow list. */
export interface ServeToolsPermissionTool {
  /** Served as `prefix + name`; must not collide with an allow-listed tool. */
  readonly name: string;
  /** The effects `run.ask` gates on. Default `() => ALL_TOOL_EFFECTS`, as `effectsTable` treats an unknown name. */
  readonly effects?: (toolName: string) => readonly ToolCapabilityKind[];
  /** Pass `rewrite: true` to `run.ask`, so a gate rewrite becomes `updatedInput`. Default `false`. */
  readonly rewrite?: boolean;
  readonly codec?: PermissionCodec;
}

/** Options for {@linkcode serveTools}. */
export interface ServeToolsOptions {
  /** The run's callback broker. `serveTools` mounts its handler on `route("mcp")` and unregisters it on close. */
  readonly broker: CallbackBroker;
  /** The tool definitions to resolve the allow list against (no run-time registry read exists). */
  readonly tools: readonly ToolDefinition[];
  /** Tool names to serve. Every other tool is invisible; a call naming one is a JSON-RPC error. */
  readonly allow: readonly string[];
  readonly transport: ServeToolsTransport;
  /** The bridge origin every served call is attributed to. */
  readonly origin: EventOrigin;
  /** Prepended to each served tool name in `tools/list` and `tools/call`. */
  readonly prefix?: string;
  /** Also serve a permission-prompt tool backed by `run.ask`. Each decision is one `prism.permissions` entry. */
  readonly permissionTool?: ServeToolsPermissionTool;
  readonly resources?: readonly ServeToolsResource[];
  readonly limits?: ServeToolsLimits;
  /** Required for `stdio-relay`: the binary to spawn. `relay mcp --run <dir>` is appended. */
  readonly relay?: { readonly command: readonly string[] };
  /** Bearer-token environment variable name. Default `PRISM_MCP_TOKEN`. */
  readonly headerEnv?: string;
}

/** Handle returned by {@linkcode serveTools}. */
export interface ServeToolsHandle {
  /** Map this into the driver's own MCP configuration; never carries the token. */
  readonly endpoint: McpEndpoint;
  /** The child's environment: the bearer token under `headerEnv` for `loopback-http`, empty for `stdio-relay`. */
  readonly env: Readonly<Record<string, string>>;
  /** The served tool names, prefixed: the allow list in order, then the permission tool when one is served. */
  readonly tools: readonly string[];
  /** Idempotent: unregisters the route, closes the web handler, and drops the abort listener. */
  close(): Promise<void>;
}
