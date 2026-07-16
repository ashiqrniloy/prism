import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolRegistry, dispatchToolCall, type JsonObject, type ToolResult } from "@arnilo/prism";
import * as z from "zod/v4";
import type {
  CreatePrismMcpServerOptions,
  CreatePrismMcpWebHandlerOptions,
  PrismMcpAuthorization,
  PrismMcpWebHandler,
} from "./types.js";
import { McpBridgeError } from "./types.js";

const DEFAULT_MAX_SERVER_RESULT_BYTES = 1024 * 1024;
const HARD_MAX_SERVER_RESULT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SERVER_CONCURRENT_CALLS = 16;
const HARD_MAX_SERVER_CONCURRENT_CALLS = 256;
const DEFAULT_SERVER_CALL_TIMEOUT_MS = 60_000;
const HARD_SERVER_CALL_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_HTTP_REQUEST_BYTES = 1024 * 1024;
const HARD_MAX_HTTP_REQUEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
const HARD_MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;

export function createPrismMcpServer(options: CreatePrismMcpServerOptions): McpServer {
  const tools = options.tools ?? [];
  const commands = options.commands ?? [];
  const names = new Set<string>();
  for (const capability of [...tools, ...commands]) {
    if (!capability.name || names.has(capability.name)) {
      throw new McpBridgeError(`Duplicate or empty MCP capability name: ${capability.name}`);
    }
    names.add(capability.name);
  }
  const maxResultBytes = bounded(options.maxResultBytes, DEFAULT_MAX_SERVER_RESULT_BYTES, HARD_MAX_SERVER_RESULT_BYTES, "maxResultBytes");
  const maxConcurrentCalls = bounded(options.maxConcurrentCalls, DEFAULT_MAX_SERVER_CONCURRENT_CALLS, HARD_MAX_SERVER_CONCURRENT_CALLS, "maxConcurrentCalls");
  const callTimeoutMs = bounded(options.callTimeoutMs, DEFAULT_SERVER_CALL_TIMEOUT_MS, HARD_SERVER_CALL_TIMEOUT_MS, "callTimeoutMs");
  const registry = createToolRegistry(tools, { duplicate: "error" });
  const server = new McpServer(
    { name: options.name ?? "prism-mcp-server", version: options.version ?? "0.0.5" },
    { capabilities: { tools: { listChanged: true } } },
  );
  let activeCalls = 0;

  for (const tool of tools) {
    register(tool.name, tool.description, tool.parameters, "tool", async (args, authorization, signal, requestId, sessionId) => {
      const result = await dispatchToolCall({
        call: { type: "tool_call", id: requestId, name: tool.name, arguments: args },
        registry,
        context: {
          sessionId: sessionId ?? "mcp",
          runId: requestId,
          toolCallId: requestId,
          signal,
          metadata: authorization.metadata,
        },
        validate: options.validate,
        permission: options.permission,
        redactor: options.redactor,
        ownership: authorization.ownership,
      });
      return toolResult(result, maxResultBytes, options.redactor);
    });
  }

  for (const command of commands) {
    register(command.name, command.description, command.parameters, "command", async (args, authorization, signal, requestId, sessionId) => {
      const result = await command.execute(args, {
        sessionId,
        runId: requestId,
        signal,
        metadata: { ...command.metadata, ...authorization.metadata },
      });
      return toolResult({
        toolCallId: requestId,
        name: command.name,
        content: result.content,
        value: result.value,
        error: result.error,
        metadata: result.metadata,
      }, maxResultBytes, options.redactor);
    });
  }

  return server;

  function register(
    name: string,
    description: string | undefined,
    schema: JsonObject | undefined,
    kind: "tool" | "command",
    execute: (
      args: JsonObject,
      authorization: PrismMcpAuthorization,
      signal: AbortSignal,
      requestId: string,
      sessionId?: string,
    ) => Promise<CallToolResult>,
  ): void {
    let inputSchema: z.ZodType;
    try {
      inputSchema = schema ? z.fromJSONSchema(schema) : z.record(z.string(), z.unknown());
    } catch (error) {
      throw new McpBridgeError(`Unsupported JSON Schema for MCP capability ${name}`, { cause: error });
    }
    server.registerTool(name, { description, inputSchema }, async (rawArgs, extra) => {
      if (activeCalls >= maxConcurrentCalls) return mcpError("MCP server is busy", "ERR_PRISM_MCP_CONCURRENCY", maxResultBytes);
      activeCalls += 1;
      const args = jsonObject(rawArgs);
      const requestId = String(extra.requestId);
      const controller = linkedController(extra.signal);
      const execution = (async () => {
        let authorization: false | PrismMcpAuthorization;
        try {
          authorization = await options.authorize({
            kind,
            name,
            arguments: args,
            authInfo: extra.authInfo,
            sessionId: extra.sessionId,
            signal: controller.signal,
          });
        } catch {
          authorization = false;
        }
        if (!authorization) return mcpError("Forbidden", "ERR_PRISM_MCP_FORBIDDEN", maxResultBytes);
        controller.signal.throwIfAborted();
        return execute(args, authorization, controller.signal, requestId, extra.sessionId);
      })();
      void execution.finally(() => {
        activeCalls -= 1;
        controller.dispose();
      }).catch(() => undefined);
      try {
        return await raceTimeout(execution, callTimeoutMs, controller);
      } catch (error) {
        const safe = options.redactor?.redact(errorMessage(error)) ?? errorMessage(error);
        return mcpError(safe, "ERR_PRISM_MCP_SERVER", maxResultBytes);
      }
    });
  }
}

export async function createPrismMcpWebHandler(
  server: McpServer,
  options: CreatePrismMcpWebHandlerOptions = {},
): Promise<PrismMcpWebHandler> {
  const maxRequestBytes = bounded(options.maxRequestBytes, DEFAULT_MAX_HTTP_REQUEST_BYTES, HARD_MAX_HTTP_REQUEST_BYTES, "maxRequestBytes");
  const maxResponseBytes = bounded(options.maxResponseBytes, DEFAULT_MAX_HTTP_RESPONSE_BYTES, HARD_MAX_HTTP_RESPONSE_BYTES, "maxResponseBytes");
  const maxConcurrentRequests = bounded(options.maxConcurrentRequests, 32, 512, "maxConcurrentRequests");
  const requestTimeoutMs = bounded(options.requestTimeoutMs, DEFAULT_SERVER_CALL_TIMEOUT_MS, HARD_SERVER_CALL_TIMEOUT_MS, "requestTimeoutMs");
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts: options.allowedHosts ? [...options.allowedHosts] : undefined,
    allowedOrigins: options.allowedOrigins ? [...options.allowedOrigins] : undefined,
    enableDnsRebindingProtection: Boolean(options.allowedHosts?.length || options.allowedOrigins?.length),
  });
  await server.connect(transport);
  let activeRequests = 0;

  return async (request) => {
    if (activeRequests >= maxConcurrentRequests) return httpError(429, "MCP server is busy");
    activeRequests += 1;
    const controller = linkedController(request.signal);
    const timeout = setTimeout(() => controller.controller.abort(new Error("MCP HTTP request timed out")), requestTimeoutMs);
    try {
      const parsedBody = request.method === "POST" ? await readBoundedJson(request, maxRequestBytes, controller.signal) : undefined;
      const authInfo = await awaitWithSignal(Promise.resolve(options.resolveAuthInfo?.(request)), controller.signal);
      const transportRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
      });
      const response = await awaitWithSignal(transport.handleRequest(transportRequest, { parsedBody, authInfo }), controller.signal);
      return boundResponse(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof McpHttpError) return httpError(error.status, error.message);
      return httpError(controller.signal.aborted ? 408 : 500, controller.signal.aborted ? "MCP request timed out" : "MCP request failed");
    } finally {
      clearTimeout(timeout);
      controller.dispose();
      activeRequests -= 1;
    }
  };
}

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function toolResult(result: ToolResult, maxBytes: number, redactor: CreatePrismMcpServerOptions["redactor"]): CallToolResult {
  const safe = redactor?.redact(result) ?? result;
  const text = safe.content?.map((block) => {
    if (block.type === "text" || block.type === "thinking") return block.text;
    if (block.type === "image") return `[image ${block.mimeType}]`;
    return `[${block.type}]`;
  }).join("\n") || (safe.value !== undefined ? stringify(safe.value) : safe.error?.message ?? "OK");
  return {
    isError: Boolean(safe.error),
    content: [{ type: "text", text: truncateUtf8(text, maxBytes) }],
  };
}

function mcpError(message: string, code: string, maxBytes: number): CallToolResult {
  return { isError: true, content: [{ type: "text", text: truncateUtf8(`${code}: ${message}`, maxBytes) }] };
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

async function raceTimeout<T>(
  execution: Promise<T>,
  timeoutMs: number,
  linked: ReturnType<typeof linkedController>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new McpBridgeError(`MCP capability timed out after ${timeoutMs}ms`);
      linked.controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([execution, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readBoundedJson(request: Request, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new McpHttpError(415, "Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new McpHttpError(413, "MCP request body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new McpHttpError(400, "MCP request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason); };
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new McpHttpError(400, "Invalid MCP JSON body");
  }
}

async function boundResponse(response: Response, maxBytes: number): Promise<Response> {
  if (!response.body) return response;
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

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable result]";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap) throw new McpBridgeError(`${name} must be a positive safe integer <= ${cap}`);
  return resolved;
}

function httpError(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

class McpHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
