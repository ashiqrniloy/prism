import { randomUUID } from "node:crypto";
import {
  McpBridgeError,
  normalizeProtectedResource,
  protectedResourceMetadata,
  unauthorizedResponse,
  WELL_KNOWN_OAUTH_PROTECTED_RESOURCE,
} from "@arnilo/prism-extensions/mcp";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import {
  createMcpHandler,
  InMemoryServerEventBus,
  isLegacyRequest,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { bounded } from "./bounds.js";
import type { CreatePrismMcpWebHandlerOptions, PrismMcpStdioHandle, PrismMcpWebHandler, ServePrismMcpStdioOptions } from "./types.js";

const DEFAULT_MAX_HTTP_REQUEST_BYTES = 1024 * 1024;
const HARD_MAX_HTTP_REQUEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const HARD_MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_SERVER_CALL_TIMEOUT_MS = 60_000;
const HARD_SERVER_CALL_TIMEOUT_MS = 30 * 60_000;

/**
 * Dual-era web handler. Modern (2026-07-28) traffic is served by the SDK's
 * `createMcpHandler` — one fresh McpServer per request from the factory, with
 * `server/discover`, result metadata, cancellation and modern headers all
 * SDK-generated. With `sessionIdGenerator` configured, classified legacy
 * session traffic (2025-era) routes to a sessionful
 * `WebStandardStreamableHTTPServerTransport` beside a strict modern handler;
 * without sessions the SDK's stateless legacy fallback serves 2025 traffic.
 * Host/origin validation, auth, identity binding, bounded body parsing and
 * response bounding all run in front of the SDK entries because
 * `createMcpHandler` intentionally provides none of them.
 */
export async function createPrismMcpWebHandler(
  server: McpServer | McpServerFactory,
  options: CreatePrismMcpWebHandlerOptions = {},
): Promise<PrismMcpWebHandler> {
  const createServer: McpServerFactory = typeof server === "function" ? server : () => server;
  const maxRequestBytes = bounded(options.maxRequestBytes, DEFAULT_MAX_HTTP_REQUEST_BYTES, HARD_MAX_HTTP_REQUEST_BYTES, "maxRequestBytes");
  const maxResponseBytes = bounded(
    options.maxResponseBytes,
    DEFAULT_MAX_HTTP_RESPONSE_BYTES,
    HARD_MAX_HTTP_RESPONSE_BYTES,
    "maxResponseBytes",
  );
  const maxConcurrentRequests = bounded(options.maxConcurrentRequests, 32, 512, "maxConcurrentRequests");
  const requestTimeoutMs = bounded(
    options.requestTimeoutMs,
    DEFAULT_SERVER_CALL_TIMEOUT_MS,
    HARD_SERVER_CALL_TIMEOUT_MS,
    "requestTimeoutMs",
  );
  const stateful = options.sessionIdGenerator !== undefined;
  if (stateful && (!options.resolveIdentity || !options.allowedOrigins?.length))
    throw new McpBridgeError("Stateful MCP sessions require resolveIdentity and exact allowedOrigins");
  const protectedResource = options.protectedResource === undefined ? undefined : normalizeProtectedResource(options.protectedResource);
  const maxSessions = bounded(options.maxSessions, 32, 512, "maxSessions");
  const sessions = new Map<string, string>();
  const maxSubscriptions = bounded(options.maxSubscriptions, 1024, 4096, "maxSubscriptions");
  if (
    options.keepAliveMs !== undefined &&
    (!Number.isSafeInteger(options.keepAliveMs) || options.keepAliveMs < 0 || options.keepAliveMs > 300_000)
  )
    throw new McpBridgeError("keepAliveMs must be a safe integer between 0 and 300000");
  // Stateless (and modern-beside-legacy) serving needs a factory: one fresh
  // McpServer per request. A bare McpServer instance can only serve the
  // legacy session path (documented legacy-only).
  if (!stateful && typeof server !== "function") {
    throw new McpBridgeError(
      "Stateless MCP web handlers require a server factory (() => McpServer): serving is one fresh McpServer per request",
    );
  }
  const modern =
    typeof server === "function"
      ? createMcpHandler((ctx) => createServer(ctx), { legacy: stateful ? "reject" : "stateless", maxSubscriptions })
      : undefined;

  // Legacy session leg: shared transport + shared server (2025-era only).
  const sharedTransport = stateful
    ? new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          if (sessions.size >= maxSessions) throw new McpBridgeError("ERR_PRISM_MCP_SESSION_LIMIT: MCP session limit reached");
          const id = options.sessionIdGenerator?.() ?? randomUUID();
          if (!validCapabilityId(id) || sessions.has(id)) throw new McpBridgeError("Invalid or duplicate MCP session id");
          return id;
        },
        enableJsonResponse: true,
      })
    : undefined;
  const sharedMcpServer = stateful ? ((await createServer({ era: "legacy" })) as McpServer) : undefined;
  if (sharedMcpServer && sharedTransport) await sharedMcpServer.connect(sharedTransport);
  let activeRequests = 0;

  async function close(): Promise<void> {
    await modern?.close();
    await sharedTransport?.close();
    await sharedMcpServer?.close();
  }

  // Legacy-only handlers (bare McpServer instance with sessions) publish
  // change notifications through the shared server; the bus stays a local
  // default because nothing subscribes to it without a modern leg.
  const legacyNotifier = {
    toolsChanged: () => void sharedMcpServer?.sendToolListChanged(),
    promptsChanged: () => void sharedMcpServer?.sendPromptListChanged(),
    resourcesChanged: () => void sharedMcpServer?.sendResourceListChanged(),
    resourceUpdated: (uri: string) => void sharedMcpServer?.server.sendResourceUpdated({ uri }),
  };

  const handler = async (request: Request): Promise<Response> => {
    if (activeRequests >= maxConcurrentRequests) return httpError(429, "MCP server is busy");
    activeRequests += 1;
    const controller = linkedController(request.signal);
    const timeout = setTimeout(() => controller.controller.abort(new Error("MCP HTTP request timed out")), requestTimeoutMs);
    try {
      // Host/origin validation runs before parsing, auth, and dispatch —
      // the SDK serving entries intentionally perform none.
      const rejected = hostOriginRejection(request, options);
      if (rejected) return rejected;
      if (protectedResource) {
        const pathname = new URL(request.url).pathname;
        if (pathname === WELL_KNOWN_OAUTH_PROTECTED_RESOURCE) {
          if (request.method !== "GET") return httpError(405, "Method not allowed");
          return Response.json(protectedResourceMetadata(protectedResource), {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      }
      const authInfo = await awaitWithSignal(Promise.resolve(options.resolveAuthInfo?.(request)), controller.signal);
      const identity = options.resolveIdentity
        ? await awaitWithSignal(Promise.resolve(options.resolveIdentity(request, authInfo)), controller.signal)
        : undefined;
      if (options.resolveIdentity && !identity) return unauthorizedResponse(protectedResource, request);
      const identityId = identity ? identity.id : undefined;
      if (identityId !== undefined && (!validCapabilityId(identityId) || Buffer.byteLength(identityId, "utf8") > 256))
        return unauthorizedResponse(protectedResource, request);
      const requestedSession = request.headers.get("mcp-session-id") ?? undefined;
      if (requestedSession && sessions.get(requestedSession) !== identityId) return httpError(404, "MCP session not found");
      // Bounded body parsing; the raw bytes feed the rebuilt request and the
      // parsed value is handed to the era classifier and serving legs so
      // nothing re-reads the stream.
      const boundedBody = request.method === "POST" ? await readBoundedBody(request, maxRequestBytes, controller.signal) : undefined;
      const transportRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
        ...(boundedBody ? { body: boundedBody.bytes } : {}),
      });
      let response: Response;
      if (modern && (!stateful || !(await isLegacyRequest(transportRequest, boundedBody?.parsed)))) {
        response = await awaitWithSignal(modern.fetch(transportRequest, { parsedBody: boundedBody?.parsed, authInfo }), controller.signal);
      } else {
        if (!sharedTransport) throw new McpBridgeError("Stateful MCP transport is not configured");
        response = await awaitWithSignal(
          sharedTransport.handleRequest(transportRequest, { parsedBody: boundedBody?.parsed, authInfo }),
          controller.signal,
        );
        const createdSession = response.headers.get("mcp-session-id") ?? undefined;
        if (createdSession && identityId) {
          const existing = sessions.get(createdSession);
          if (existing && existing !== identityId) return httpError(404, "MCP session not found");
          sessions.set(createdSession, identityId);
        }
        if (request.method === "DELETE" && requestedSession && response.status < 400) sessions.delete(requestedSession);
      }
      return await boundResponse(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof McpHttpError) return httpError(error.status, error.message);
      return httpError(controller.signal.aborted ? 408 : 500, controller.signal.aborted ? "MCP request timed out" : "MCP request failed");
    } finally {
      clearTimeout(timeout);
      controller.dispose();
      activeRequests -= 1;
    }
  };

  return Object.assign(handler, {
    fetch: handler,
    close,
    notify: modern ? modern.notify : legacyNotifier,
    bus: modern ? modern.bus : new InMemoryServerEventBus(),
  });
}

function hostOriginRejection(request: Request, options: CreatePrismMcpWebHandlerOptions): Response | undefined {
  if (options.allowedHosts?.length) {
    const host = request.headers.get("host")?.toLowerCase();
    if (!host || !options.allowedHosts.some((allowed) => allowed.toLowerCase() === host)) return httpError(403, "Invalid Host header");
  }
  if (options.allowedOrigins?.length) {
    const origin = request.headers.get("origin");
    if (origin && !options.allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase()))
      return httpError(403, "Invalid Origin header");
  }
  return undefined;
}

/** Thin dual-era stdio wrapper: the opening exchange pins the era; one factory instance serves the connection. */
export function servePrismMcpStdio(server: McpServer | McpServerFactory, options: ServePrismMcpStdioOptions = {}): PrismMcpStdioHandle {
  const factory: McpServerFactory = typeof server === "function" ? server : () => server;
  return serveStdio(factory, {
    legacy: options.legacy ?? "serve",
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    ...(options.maxSubscriptions !== undefined
      ? { maxSubscriptions: bounded(options.maxSubscriptions, 1024, 4096, "maxSubscriptions") }
      : {}),
  });
}

function validCapabilityId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new McpBridgeError("MCP request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function linkedController(signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    signal: controller.signal,
    dispose: () => signal.removeEventListener("abort", abort),
  };
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly parsed: unknown }> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new McpHttpError(415, "Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new McpHttpError(413, "MCP request body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new McpHttpError(400, "MCP request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel(signal.reason);
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new McpHttpError(413, "MCP request body too large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (signal.aborted) throw new McpHttpError(408, "MCP request timed out");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { bytes, parsed: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    throw new McpHttpError(400, "Invalid MCP JSON body");
  }
}

async function boundResponse(response: Response, maxBytes: number): Promise<Response> {
  if (!response.body) return response;
  // Server-sent-event responses are long-lived and unbounded; buffering them
  // would stall the handler forever. Relay them as-is (the stateless relay
  // below still forwards chunks and closes on client disconnect).
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return httpError(507, "MCP response too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function httpError(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

class McpHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
