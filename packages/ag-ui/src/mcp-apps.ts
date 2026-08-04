import type { JsonObject, ToolExecutionContext } from "@arnilo/prism";
import type { McpAppResource, McpAppsBridge } from "@arnilo/prism-mcp";
import { AgUiError } from "./errors.js";
import { assertBoundedJson } from "./input.js";
import { DEFAULT_AG_UI_LIMITS } from "./limits.js";
import type { AgUiAuthorization } from "./types.js";

const DEFAULT_MAX_APP_REQUEST_BYTES = 64 * 1024;

export interface AgUiMcpAppSandbox {
  /** Required iframe sandbox tokens for the separate-origin MCP Apps proxy. */
  readonly sandbox: "allow-scripts allow-same-origin";
  /** CSP for raw approved HTML. A host may narrow it but must not widen it. */
  readonly contentSecurityPolicy: string;
  /** Optional iframe `allow` value derived from reviewed requested permissions. */
  readonly allow?: string;
}

/** Builds host renderer configuration; this package never creates an iframe or executes remote HTML. */
export function createAgUiMcpAppSandbox(resource: Pick<McpAppResource, "ui">): AgUiMcpAppSandbox {
  const csp = resource.ui?.csp;
  const directive = (name: string, domains: readonly string[] | undefined, fallback: string) =>
    `${name} ${domains?.length ? domains.join(" ") : fallback}`;
  const resourceDomains = csp?.resourceDomains;
  const policy = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    directive("img-src", resourceDomains, "'self' data:"),
    directive("media-src", resourceDomains, "'self' data:"),
    directive("font-src", resourceDomains, "'self'"),
    directive("connect-src", csp?.connectDomains, "'none'"),
    directive("frame-src", csp?.frameDomains, "'none'"),
    directive("base-uri", csp?.baseUriDomains, "'self'"),
    "object-src 'none'",
  ].join("; ");
  const permissions = resource.ui?.permissions;
  const allow = [
    permissions?.camera ? "camera" : undefined,
    permissions?.microphone ? "microphone" : undefined,
    permissions?.geolocation ? "geolocation" : undefined,
    permissions?.clipboardWrite ? "clipboard-write" : undefined,
  ].filter((value): value is string => value !== undefined);
  return {
    sandbox: "allow-scripts allow-same-origin",
    contentSecurityPolicy: policy,
    ...(allow.length ? { allow: allow.join("; ") } : {}),
  };
}

export interface AgUiMcpAppAuthorizationInput {
  readonly request: Request;
  readonly signal: AbortSignal;
}

export interface AgUiMcpAppCallContext<Authorization> {
  readonly authorization: Authorization;
  readonly tool: McpAppsBridge["tools"][number];
  readonly messageId: string | number;
  readonly signal: AbortSignal;
}

export interface CreateAgUiMcpAppHandlerOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  readonly apps: McpAppsBridge;
  /** Reauthorize each iframe-proxy call. Return false without disclosing server/resource names. */
  readonly authorize: (input: AgUiMcpAppAuthorizationInput) => Authorization | false | Promise<Authorization | false>;
  /** The host binds a UI call to its already-authorized durable run. */
  readonly context: (input: AgUiMcpAppCallContext<Authorization>) => ToolExecutionContext | false | Promise<ToolExecutionContext | false>;
  /** Required before every UI-initiated tool call. It cannot approve another server's tool. */
  readonly approveToolCall: (
    input: AgUiMcpAppCallContext<Authorization> & { readonly arguments: JsonObject },
  ) => boolean | Promise<boolean>;
  /** Exact browser origins permitted to call this proxy. */
  readonly allowedOrigins: readonly string[];
  readonly maxRequestBytes?: number;
  /** Host-owned sandbox/renderer configuration returned during `ui/initialize`. */
  readonly initialize?: (input: { readonly authorization: Authorization; readonly signal: AbortSignal }) => Record<string, unknown>;
}

/** Framework-free, allow-listed MCP Apps JSON-RPC proxy. Host still owns the sandbox iframe. */
export function createAgUiMcpAppHandler<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  options: CreateAgUiMcpAppHandlerOptions<Authorization>,
): (request: Request) => Promise<Response> {
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_APP_REQUEST_BYTES;
  if (options.apps.negotiated !== true) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "MCP Apps was not negotiated");
  if (options.allowedOrigins.length === 0 || options.allowedOrigins.some((origin) => !exactOrigin(origin)))
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "MCP Apps origins are invalid");
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1024 || maxRequestBytes > 1024 * 1024)
    throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Invalid MCP Apps request limit");
  return async (request) => {
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      if (request.method !== "POST") return appError(405, undefined, -32600, "Method not allowed");
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        return appError(415, undefined, -32600, "Content-Type must be application/json");
      const origin = request.headers.get("origin");
      if (!origin || !options.allowedOrigins.includes(origin)) return appError(403, undefined, -32001, "Unavailable");
      const authorization = await options.authorize({ request, signal: controller.signal });
      if (!authorization) return appError(403, undefined, -32001, "Unavailable");
      const value = await readJson(request, maxRequestBytes, controller.signal);
      assertBoundedJson(value, maxRequestBytes, DEFAULT_AG_UI_LIMITS, "MCP Apps request");
      const envelope = parseEnvelope(value, options.apps.serverId);
      return await dispatchAppMessage(envelope, authorization, options, controller.signal, maxRequestBytes);
    } catch (error) {
      const message = error instanceof AgUiError ? error.message : "Invalid MCP Apps request";
      return appError(400, undefined, -32600, message);
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  };
}

interface AppEnvelope {
  readonly id?: string | number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

async function dispatchAppMessage<Authorization extends AgUiAuthorization>(
  envelope: AppEnvelope,
  authorization: Authorization,
  options: CreateAgUiMcpAppHandlerOptions<Authorization>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Response> {
  const id = envelope.id;
  const result = (value: unknown) => {
    assertBoundedJson(value, maxBytes, DEFAULT_AG_UI_LIMITS, "MCP Apps response");
    return Response.json({ jsonrpc: "2.0", id: id ?? null, result: value });
  };
  if (envelope.method === "ui/initialize") {
    return result({
      protocolVersion: "2025-06-18",
      hostCapabilities: { serverTools: {}, serverResources: {}, logging: {}, sandbox: {} },
      hostInfo: { name: "prism-ag-ui", version: "0.0.23" },
      ...(options.initialize ? { hostContext: await options.initialize({ authorization, signal }) } : {}),
    });
  }
  if (envelope.method === "ping") return result({});
  if (envelope.method === "notifications/message") return new Response(null, { status: 204 });
  if (envelope.method === "tools/list") {
    return result({
      tools: options.apps.tools
        .filter((tool) => tool.visibility.includes("app"))
        .map((tool) => ({
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: tool.inputSchema,
          _meta: { ui: { ...(tool.resourceUri === undefined ? {} : { resourceUri: tool.resourceUri }), visibility: tool.visibility } },
        })),
    });
  }
  if (envelope.method === "resources/read") {
    const uri = envelope.params.uri;
    if (typeof uri !== "string") return appError(400, id, -32602, "Invalid resource");
    const resource = await options.apps.readResource(uri);
    return result({
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.html,
          ...(resource.ui === undefined ? {} : { _meta: { ui: resource.ui } }),
        },
      ],
    });
  }
  if (envelope.method === "tools/call") {
    const name = envelope.params.name;
    const args = envelope.params.arguments;
    const tool =
      typeof name === "string"
        ? options.apps.tools.find((candidate) => candidate.name === name && candidate.visibility.includes("app"))
        : undefined;
    if (!tool || !isJsonObject(args) || id === undefined) return appError(404, id, -32001, "Unavailable");
    const input = { authorization, tool, messageId: id, signal };
    if (!(await options.approveToolCall({ ...input, arguments: args }))) return appError(403, id, -32001, "Unavailable");
    const context = await options.context(input);
    if (!context) return appError(403, id, -32001, "Unavailable");
    // ponytail: Task 4 adds generic effect recovery; this proxy never retries an approved app mutation.
    const called = await options.apps.callTool(tool.name, args, context);
    return result({
      content: called.content ?? [],
      ...(called.value === undefined ? {} : { structuredContent: called.value }),
      ...(called.error === undefined ? {} : { isError: true }),
    });
  }
  return appError(404, id, -32601, "Method unavailable");
}

function parseEnvelope(value: unknown, serverId: string): AppEnvelope {
  if (!isRecord(value) || value.serverId !== serverId || !isRecord(value.message))
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid MCP Apps request");
  const message = value.message;
  if (
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")
  )
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid MCP Apps message");
  if (message.params !== undefined && !isRecord(message.params))
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid MCP Apps parameters");
  return { ...(message.id === undefined ? {} : { id: message.id }), method: message.method, params: message.params ?? {} };
}

async function readJson(request: Request, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (!request.body) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "MCP Apps request exceeds limit");
      chunks.push(next.value);
    }
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
  } finally {
    reader.releaseLock();
  }
}

function appError(status: number, id: string | number | undefined, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.keys(value).every((key) => !["__proto__", "prototype", "constructor"].includes(key));
}
