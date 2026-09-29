import type { ExecutionPolicy, JsonObject, ToolDefinition } from "@arnilo/prism";
import {
  type ConnectMcpToolsOptions,
  connectMcpTools,
  type McpClientAuthOptions,
  type McpToolBridge,
  type McpTransportConfig,
} from "@arnilo/prism-mcp";
import { AgentSdkConfigError, McpConnectError } from "../errors.js";

export const AMBIGUOUS_PATH_PATTERN = /%2[eEfF]|%5[cC]|\\|\.\./;
export const MAX_URL_LENGTH = 2048;
/** Default per-server connect budget. A hanging server never blocks startup past this. */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 15_000;
const MAX_MCP_CONNECT_TIMEOUT_MS = 600_000;
const MAX_MCP_ERROR_LENGTH = 512;

export interface ParsedAllowDestination {
  readonly kind: "stdio" | "url";
  readonly origin?: string;
  readonly path?: string;
}

export function parseAllowDestination(entry: string): ParsedAllowDestination | null {
  if (entry === "stdio") {
    return { kind: "stdio" };
  }
  if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_URL_LENGTH) {
    return null;
  }
  const urlWithoutQuery = entry.split(/[?#]/, 1)[0] ?? entry;
  if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) {
    return null;
  }
  try {
    const url = new URL(entry);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    let path = url.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }
    return { kind: "url", origin: url.origin, path };
  } catch {
    return null;
  }
}

export interface McpStdioServerSpec {
  readonly serverId: string;
  readonly transport?: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly allow: string;
  readonly namePrefix?: string;
  /** Per-server connect budget override (default {@link DEFAULT_MCP_CONNECT_TIMEOUT_MS}). */
  readonly connectTimeoutMs?: number;
  /** When true, bridged tools are declared read-only (`effect.kind: "none"`) and bypass approval. */
  readonly readOnly?: boolean;
  /** Host-set: keep the server configured but unconnected (reported as `disabled` with this reason). */
  readonly disabledReason?: string;
  /** Host-set: the server could not be prepared; reported as `failed` with this message without connecting. */
  readonly preflightError?: string;
}

export interface McpHttpServerSpec {
  readonly serverId: string;
  readonly transport?: "streamable-http" | "http" | "sse";
  readonly url: string;
  readonly allow: string;
  readonly namePrefix?: string;
  readonly allowedOrigins?: readonly string[];
  /** Static request headers. Values are redacted from status errors. */
  readonly headers?: Readonly<Record<string, string>>;
  /** OAuth client integration (persistence/registration are host-supplied). */
  readonly auth?: McpClientAuthOptions;
  /** Per-server connect budget override (default {@link DEFAULT_MCP_CONNECT_TIMEOUT_MS}). */
  readonly connectTimeoutMs?: number;
  /** When true, bridged tools are declared read-only (`effect.kind: "none"`) and bypass approval. */
  readonly readOnly?: boolean;
  /** Host-set: keep the server configured but unconnected (reported as `disabled` with this reason). */
  readonly disabledReason?: string;
  /** Host-set: the server could not be prepared; reported as `failed` with this message without connecting. */
  readonly preflightError?: string;
}

export interface McpCustomTransportServerSpec {
  readonly serverId: string;
  readonly transport: McpTransportConfig;
  readonly allow: string;
  readonly namePrefix?: string;
  /** Per-server connect budget override (default {@link DEFAULT_MCP_CONNECT_TIMEOUT_MS}). */
  readonly connectTimeoutMs?: number;
  /** When true, bridged tools are declared read-only (`effect.kind: "none"`) and bypass approval. */
  readonly readOnly?: boolean;
  /** Host-set: keep the server configured but unconnected (reported as `disabled` with this reason). */
  readonly disabledReason?: string;
  /** Host-set: the server could not be prepared; reported as `failed` with this message without connecting. */
  readonly preflightError?: string;
}

export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec | McpCustomTransportServerSpec;

export interface McpPlaneConfig {
  readonly servers?: readonly McpServerSpec[];
  /**
   * Host allow-list (ACP `mcp.allow` semantics). Every configured server destination must be
   * covered by one of these entries; servers outside it are `disabled`, never connected.
   * Omit to allow every configured server.
   */
  readonly allow?: readonly string[];
  /** Plane-wide connect budget; per-server `connectTimeoutMs` overrides it. */
  readonly connectTimeoutMs?: number;
  /** Optional custom connector for testing or host embedding. */
  readonly connector?: (options: ConnectMcpToolsOptions) => Promise<McpToolBridge>;
  /**
   * Host approval policy for bridged tools. Tools whose declared effect is read-only (`kind: "none"`)
   * bypass it; everything else (including unclassified tools, which default to `external_mutation`)
   * is checked before dispatch and denied with a model-visible error.
   */
  readonly executionPolicy?: ExecutionPolicy;
}

/** Per-server outcome of an MCP plane connect attempt. */
export interface McpServerStatus {
  readonly serverId: string;
  readonly state: "connected" | "failed" | "disabled";
  readonly toolCount: number;
  /** Redacted runtime failure message (`failed` only). */
  readonly error?: string;
  /** Policy reason (`disabled` only, e.g. host allow-list). */
  readonly reason?: string;
}

export interface AssembledMcpPlane {
  /** Bridges currently connected (live view; changes after `reconnect`). */
  readonly bridges: readonly McpToolBridge[];
  /** Bridged tools currently exposed (live view; changes after `reconnect`). */
  readonly tools: readonly ToolDefinition[];
  readonly connectedServerIds: readonly string[];
  /** Per-server state in configuration order; connection failures never throw. */
  readonly status: readonly McpServerStatus[];
  /** Wrapped tools bridged for one server (empty when not connected). */
  getServerTools(serverId: string): readonly ToolDefinition[];
  /**
   * Closes a server's existing bridge (if any), reconnects it, and swaps its bridged tools.
   * Resolves with the new status on success and throws a redacted {@link McpConnectError} on failure.
   */
  reconnect(serverId: string): Promise<McpServerStatus>;
  /** Closes every bridge. Idempotent; reconnect after close fails closed. */
  close(): Promise<void>;
}

/**
 * Validates that an MCP server specification carries an explicit allow decision
 * conforming to ACP allow-list semantics (stdio marker or HTTP/HTTPS origin/subtree match).
 */
export function assertServerAllowed(server: McpServerSpec): void {
  if (!server.serverId || typeof server.serverId !== "string") {
    throw new AgentSdkConfigError("MCP server: missing serverId");
  }

  if (!server.allow || typeof server.allow !== "string") {
    throw new AgentSdkConfigError(`MCP server "${server.serverId}": missing explicit allow specification`);
  }

  const isStdio =
    ("command" in server && typeof server.command === "string") ||
    ("transport" in server && server.transport === "stdio") ||
    ("transport" in server &&
      typeof server.transport === "object" &&
      server.transport !== null &&
      "type" in server.transport &&
      server.transport.type === "stdio");

  if (isStdio) {
    if (server.allow !== "stdio") {
      throw new AgentSdkConfigError(`MCP server "${server.serverId}": stdio transport requires allow: "stdio", got "${server.allow}"`);
    }
    return;
  }

  // URL-based transport (streamable-http, http, sse)
  let url: string | undefined;
  if ("url" in server && typeof server.url === "string") {
    url = server.url;
  } else if (
    "transport" in server &&
    typeof server.transport === "object" &&
    server.transport !== null &&
    "url" in server.transport &&
    typeof server.transport.url === "string"
  ) {
    url = server.transport.url;
  }

  if (!url) {
    throw new AgentSdkConfigError(`MCP server "${server.serverId}": unrecognized transport or missing command/url`);
  }

  const dest = parseAllowDestination(server.allow);
  if (dest?.kind !== "url" || !dest.origin) {
    throw new AgentSdkConfigError(`MCP server "${server.serverId}": allow "${server.allow}" is not a valid HTTP/HTTPS allow destination`);
  }

  let candidateUrl: URL;
  try {
    candidateUrl = new URL(url);
  } catch {
    throw new AgentSdkConfigError(`MCP server "${server.serverId}": invalid server URL "${url}"`);
  }

  if (candidateUrl.origin !== dest.origin) {
    throw new AgentSdkConfigError(
      `MCP server "${server.serverId}": server URL origin "${candidateUrl.origin}" does not match allow origin "${dest.origin}"`,
    );
  }

  const pathname = candidateUrl.pathname;
  const pathMatches = dest.path === "/" || dest.path === "" || pathname === dest.path || pathname.startsWith(`${dest.path}/`);

  if (!pathMatches) {
    throw new AgentSdkConfigError(`MCP server "${server.serverId}": server path "${pathname}" is outside allow path "${dest.path}"`);
  }
}

/**
 * Builds the `ConnectMcpToolsOptions` from an `McpServerSpec`.
 */
export function buildConnectOptions(server: McpServerSpec): ConnectMcpToolsOptions {
  const readOnlyEffect: NonNullable<ConnectMcpToolsOptions["effect"]> | undefined = server.readOnly
    ? () => ({ kind: "none", idempotency: "none" })
    : undefined;
  if ("transport" in server && typeof server.transport === "object" && server.transport !== null && "type" in server.transport) {
    return {
      serverId: server.serverId,
      transport: server.transport,
      ...(server.namePrefix ? { namePrefix: server.namePrefix } : {}),
      ...(readOnlyEffect ? { effect: readOnlyEffect } : {}),
    };
  }

  if ("command" in server && typeof server.command === "string") {
    return {
      serverId: server.serverId,
      transport: {
        type: "stdio",
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
      },
      ...(server.namePrefix ? { namePrefix: server.namePrefix } : {}),
      ...(readOnlyEffect ? { effect: readOnlyEffect } : {}),
    };
  }

  if ("url" in server && typeof server.url === "string") {
    const parsed = new URL(server.url);
    const requestInit: RequestInit | undefined =
      server.headers && Object.keys(server.headers).length > 0 ? { headers: { ...server.headers } } : undefined;
    return {
      serverId: server.serverId,
      transport: {
        type: "streamable-http",
        url: server.url,
        allowedOrigins: server.allowedOrigins ?? [parsed.origin],
        ...(requestInit ? { requestInit } : {}),
        ...(server.auth ? { auth: server.auth } : {}),
      },
      ...(server.namePrefix ? { namePrefix: server.namePrefix } : {}),
      ...(readOnlyEffect ? { effect: readOnlyEffect } : {}),
    };
  }

  throw new AgentSdkConfigError(`MCP server "${server.serverId}": unable to build transport options`);
}

/**
 * Wraps one bridged MCP tool with the host approval policy. A tool is read-only only when its
 * declared effect (from the server binding's effect policy) says so; unclassified tools keep the
 * bridge's `external_mutation` default and are treated as mutating.
 */
export function applyMcpApprovalPolicy(tool: ToolDefinition, policy: ExecutionPolicy | undefined): ToolDefinition {
  if (!policy) return tool;
  const effect = tool.effect;
  if (effect && typeof effect !== "function" && effect.kind === "none") return tool;
  return {
    ...tool,
    execute: async (args, context) => {
      let decision: Awaited<ReturnType<ExecutionPolicy["check"]>>;
      try {
        decision = await policy.check({
          kind: "mcp",
          operation: "call",
          risk: "medium",
          metadata: {
            toolName: tool.name,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        });
      } catch (error) {
        decision = { allowed: false, reason: error instanceof Error ? error.message : String(error) };
      }
      if (!decision.allowed) {
        const message = `MCP tool ${tool.name} denied: ${decision.reason ?? "approval denied"}`;
        return {
          toolCallId: context.toolCallId,
          name: tool.name,
          content: [{ type: "text" as const, text: message }],
          error: { message },
        };
      }
      return tool.execute(args as JsonObject, context);
    },
  };
}

interface PlaneServerEntry {
  readonly server: McpServerSpec;
  state: McpServerStatus["state"] | "pending";
  bridge?: McpToolBridge;
  tools: readonly ToolDefinition[];
  error?: string;
  readonly reason?: string;
}

function resolveConnectTimeout(value: number | undefined, label: string): number {
  if (value === undefined) return DEFAULT_MCP_CONNECT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_MCP_CONNECT_TIMEOUT_MS) {
    throw new AgentSdkConfigError(`${label} must be an integer between 1 and ${MAX_MCP_CONNECT_TIMEOUT_MS}`);
  }
  return value;
}

/** Parses the optional host allow-list, failing closed on malformed entries. */
function resolveHostAllow(allow: readonly string[] | undefined): readonly ParsedAllowDestination[] | undefined {
  if (allow === undefined) return undefined;
  if (!Array.isArray(allow)) {
    throw new AgentSdkConfigError("mcp.allow must be an array of allow destinations");
  }
  return allow.map((entry) => {
    const destination = typeof entry === "string" ? parseAllowDestination(entry) : null;
    if (!destination) {
      throw new AgentSdkConfigError('mcp.allow entries must be "stdio" or an HTTP/HTTPS origin/subtree URL');
    }
    return destination;
  });
}

function serverUrl(server: McpServerSpec): string | undefined {
  if ("url" in server && typeof server.url === "string") return server.url;
  if ("transport" in server && typeof server.transport === "object" && server.transport !== null && "url" in server.transport) {
    const url = (server.transport as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return undefined;
}

function isStdioServer(server: McpServerSpec): boolean {
  if ("command" in server && typeof server.command === "string") return true;
  return (
    "transport" in server &&
    ((typeof server.transport === "string" && server.transport === "stdio") ||
      (typeof server.transport === "object" &&
        server.transport !== null &&
        "type" in server.transport &&
        server.transport.type === "stdio"))
  );
}

function isAllowedByHost(server: McpServerSpec, destinations: readonly ParsedAllowDestination[]): boolean {
  if (isStdioServer(server)) return destinations.some((entry) => entry.kind === "stdio");
  const url = serverUrl(server);
  if (!url) return false;
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }
  return destinations.some((entry) => {
    if (entry.kind !== "url" || !entry.origin || entry.origin !== candidate.origin) return false;
    if (entry.path === "/" || entry.path === "" || entry.path === undefined) return true;
    return candidate.pathname === entry.path || candidate.pathname.startsWith(`${entry.path}/`);
  });
}

function headerValues(headers: HeadersInit | undefined): readonly string[] {
  if (!headers) return [];
  if (typeof Headers !== "undefined" && headers instanceof Headers) return [...headers.values()];
  if (Array.isArray(headers)) return headers.map((entry) => entry[1] ?? "");
  return Object.values(headers as Record<string, string>);
}

function serverSecrets(server: McpServerSpec): readonly string[] {
  const secrets: string[] = [];
  if ("headers" in server && server.headers) secrets.push(...Object.values(server.headers));
  if ("transport" in server && typeof server.transport === "object" && server.transport !== null && "requestInit" in server.transport) {
    const requestInit = (server.transport as { requestInit?: RequestInit }).requestInit;
    secrets.push(...headerValues(requestInit?.headers));
  }
  return secrets.filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * Bounds and redacts a connect/reconnect failure: header values never survive, common
 * credential shapes are masked, and the message is truncated.
 */
export function redactMcpError(server: McpServerSpec, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let message = raw;
  for (const secret of serverSecrets(server)) {
    message = message.split(secret).join("[redacted]");
  }
  message = message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  message = message.replace(/((?:token|secret|password|api[_-]?key)=)[^&\s"']+/gi, "$1[redacted]");
  return message.length > MAX_MCP_ERROR_LENGTH ? `${message.slice(0, MAX_MCP_ERROR_LENGTH)}...` : message;
}

/**
 * Runs one connector call under `timeoutMs`. If the connector ignores the abort signal and
 * resolves late, the orphaned bridge is closed instead of leaking.
 */
async function connectWithTimeout(
  connector: (options: ConnectMcpToolsOptions) => Promise<McpToolBridge>,
  options: ConnectMcpToolsOptions,
  timeoutMs: number,
  label: string,
): Promise<McpToolBridge> {
  const controller = new AbortController();
  let expired = false;
  let rejectTimeout!: (error: unknown) => void;
  const timedOut = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
    rejectTimeout(new McpConnectError(label, `${label}: connect timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const pending = Promise.resolve().then(() => connector({ ...options, signal: controller.signal }));
  pending.catch(() => void 0);
  pending.then(
    (bridge) => {
      if (expired) void bridge.close().catch(() => void 0);
    },
    () => void 0,
  );
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function connectServer(
  entry: PlaneServerEntry,
  connector: (options: ConnectMcpToolsOptions) => Promise<McpToolBridge>,
  timeoutMs: number,
  executionPolicy: ExecutionPolicy | undefined,
): Promise<void> {
  try {
    const bridge = await connectWithTimeout(connector, buildConnectOptions(entry.server), timeoutMs, entry.server.serverId);
    entry.bridge = bridge;
    entry.tools = bridge.tools.map((tool) => applyMcpApprovalPolicy(tool, executionPolicy));
    entry.state = "connected";
    entry.error = undefined;
  } catch (error) {
    entry.state = "failed";
    entry.error = redactMcpError(entry.server, error);
  }
}

function statusOf(entry: PlaneServerEntry): McpServerStatus {
  return {
    serverId: entry.server.serverId,
    state: entry.state === "pending" ? "failed" : entry.state,
    toolCount: entry.state === "connected" ? entry.tools.length : 0,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

/**
 * Assemble MCP plane: eagerly validates every server's allow policy and host allow-list
 * (`AgentSdkConfigError`), then connects all allowed servers in parallel with per-server
 * timeouts. Connection failures are reported per server as status instead of aborting startup.
 */
export async function assembleMcpPlane(config?: McpPlaneConfig): Promise<AssembledMcpPlane> {
  const servers = config?.servers ?? [];
  const connector = config?.connector ?? connectMcpTools;
  const defaultTimeout = resolveConnectTimeout(config?.connectTimeoutMs, "mcp.connectTimeoutMs");
  const hostAllow = resolveHostAllow(config?.allow);

  // Config validation fails closed before any process/network activity. Disabled/pre-failed
  // servers are reported but never validated against the allow policy or connected.
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.serverId)) {
      throw new AgentSdkConfigError(`MCP server: duplicate serverId "${server.serverId}"`);
    }
    seen.add(server.serverId);
    if (server.disabledReason !== undefined || server.preflightError !== undefined) continue;
    assertServerAllowed(server);
    resolveConnectTimeout(server.connectTimeoutMs, `${server.serverId}.connectTimeoutMs`);
  }

  const entries: PlaneServerEntry[] = servers.map((server) => {
    if (server.disabledReason !== undefined) {
      return { server, state: "disabled", tools: [], reason: server.disabledReason };
    }
    if (server.preflightError !== undefined) {
      return { server, state: "failed", tools: [], error: server.preflightError };
    }
    if (hostAllow && !isAllowedByHost(server, hostAllow)) {
      return {
        server,
        state: "disabled",
        tools: [],
        reason: "destination is not covered by the host mcp.allow list",
      };
    }
    return { server, state: "pending", tools: [] };
  });
  const byId = new Map(entries.map((entry) => [entry.server.serverId, entry]));

  await Promise.all(
    entries
      .filter((entry) => entry.state === "pending")
      .map((entry) => connectServer(entry, connector, entry.server.connectTimeoutMs ?? defaultTimeout, config?.executionPolicy)),
  );

  let closed = false;

  return {
    get bridges() {
      return entries.map((entry) => entry.bridge).filter((bridge): bridge is McpToolBridge => bridge !== undefined);
    },
    get tools() {
      return entries.flatMap((entry) => entry.tools);
    },
    get connectedServerIds() {
      return entries.filter((entry) => entry.state === "connected").map((entry) => entry.server.serverId);
    },
    get status() {
      return entries.map(statusOf);
    },
    getServerTools(serverId: string) {
      return byId.get(serverId)?.tools ?? [];
    },
    async reconnect(serverId: string) {
      if (closed) {
        throw new AgentSdkConfigError("MCP plane is closed");
      }
      const entry = byId.get(serverId);
      if (!entry) {
        throw new AgentSdkConfigError(`MCP server "${serverId}" is not configured`);
      }
      if (entry.state === "disabled") {
        throw new AgentSdkConfigError(`MCP server "${serverId}" is disabled: ${entry.reason ?? "not permitted"}`);
      }
      const previous = entry.bridge;
      entry.bridge = undefined;
      entry.tools = [];
      if (previous) await previous.close().catch(() => void 0);

      const timeoutMs = entry.server.connectTimeoutMs ?? defaultTimeout;
      try {
        const bridge = await connectWithTimeout(connector, buildConnectOptions(entry.server), timeoutMs, serverId);
        entry.bridge = bridge;
        entry.tools = bridge.tools.map((tool) => applyMcpApprovalPolicy(tool, config?.executionPolicy));
        entry.state = "connected";
        entry.error = undefined;
        return statusOf(entry);
      } catch (error) {
        entry.state = "failed";
        entry.error = redactMcpError(entry.server, error);
        throw new McpConnectError(serverId, entry.error);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(entries.map((entry) => entry.bridge?.close().catch(() => void 0)));
      for (const entry of entries) {
        entry.bridge = undefined;
        entry.tools = [];
      }
    },
  };
}
