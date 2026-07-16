import type { AgentRunResult } from "@arnilo/prism";
import { createA2AAgentCard } from "./a2a-card.js";
import { A2AError } from "./errors.js";
import type { A2AJsonRpcRequest, A2AJsonRpcResponse, A2ALimits, A2AMessage, A2ATask, CreateA2AHandlerOptions } from "./a2a-types.js";

const JSON_HEADERS = { "content-type": "application/a2a+json; charset=utf-8" };
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" };
const DEFAULTS = { maxRequestBytes: 64 * 1024, maxResponseBytes: 1024 * 1024, maxEventBytes: 64 * 1024, maxStreamBytes: 10 * 1024 * 1024, maxStreamEvents: 10_000, maxConcurrentRequests: 16, timeoutMs: 120_000, maxCardBytes: 64 * 1024 } as const;
const HARD = { maxRequestBytes: 1024 * 1024, maxResponseBytes: 8 * 1024 * 1024, maxEventBytes: 1024 * 1024, maxStreamBytes: 64 * 1024 * 1024, maxStreamEvents: 100_000, maxConcurrentRequests: 256, timeoutMs: 30 * 60_000, maxCardBytes: 1024 * 1024 } as const;

type ResolvedA2ALimits = { readonly [K in keyof typeof DEFAULTS]: number };

export function createA2AHandler(options: CreateA2AHandlerOptions): (request: Request) => Promise<Response> {
  const limits = resolveA2ALimits(options.limits);
  const card = createA2AAgentCard(options.card);
  const endpointPath = options.endpointPath ?? new URL(card.supportedInterfaces[0]!.url).pathname;
  if (!endpointPath.startsWith("/")) throw new A2AError("endpointPath must be absolute", 400, "ERR_PRISM_A2A_CONFIG");
  const cardJson = JSON.stringify(card);
  if (new TextEncoder().encode(cardJson).byteLength > limits.maxCardBytes) throw new A2AError("Agent card exceeds max bytes", 400, "ERR_PRISM_A2A_CARD");
  let active = 0;
  let sequence = 0;

  return async (request) => {
    let acquired = false;
    let transferred = false;
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/.well-known/agent-card.json") return new Response(cardJson, { status: 200, headers: JSON_HEADERS });
      if (request.method !== "POST" || path !== endpointPath) return errorResponse(404, "Not found", null);
      if (active >= limits.maxConcurrentRequests) return errorResponse(429, "Too many requests", null);
      active += 1;
      acquired = true;
      const owned = ownedSignal(request.signal, limits.timeoutMs);
      try {
        const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (contentType !== "application/json" && contentType !== "application/a2a+json") return errorResponse(415, "Unsupported media type", null);
        const body = await readJson(request, limits.maxRequestBytes, owned.signal);
        const rpc = parseRpc(body);
        const authorized = await abortable(Promise.resolve(options.authorize({ request, method: rpc.method, signal: owned.signal })), owned.signal);
        if (!authorized) return errorResponse(403, "Forbidden", rpc.id);
        if (rpc.method === "GetExtendedAgentCard") return boundedJson({ jsonrpc: "2.0", id: rpc.id, result: card }, limits.maxResponseBytes, options);
        if (rpc.method !== "SendMessage" && rpc.method !== "SendStreamingMessage") return boundedJson({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } }, limits.maxResponseBytes, options);
        const message = parseMessage(rpc.params?.message, limits.maxRequestBytes);
        const input = message.parts.map((part) => part.text).join("\n");
        sequence += 1;
        const taskId = `task-${crypto.randomUUID()}`;
        const contextId = message.contextId ?? `context-${sequence}-${crypto.randomUUID()}`;
        const session = await abortable(Promise.resolve(options.exposure.sessionFactory(authorized)), owned.signal);
        if (rpc.method === "SendMessage") {
          const result = await abortable(session.run(input, { ownership: authorized.ownership, metadata: authorized.metadata, signal: owned.signal, redactor: options.redactor }), owned.signal);
          return boundedJson({ jsonrpc: "2.0", id: rpc.id, result: { task: toTask(taskId, contextId, result, options) } }, limits.maxResponseBytes, options);
        }
        if (rpc.method === "SendStreamingMessage") {
          transferred = true;
          const stream = taskStream(rpc.id, taskId, contextId, () => session.run(input, { ownership: authorized.ownership, metadata: authorized.metadata, signal: owned.signal, redactor: options.redactor }), owned, limits, options, () => { active -= 1; });
          return new Response(stream, { status: 200, headers: SSE_HEADERS });
        }
        throw new A2AError("Method not found", 400, "ERR_PRISM_A2A_METHOD");
      } finally {
        if (!transferred) owned.dispose();
      }
    } catch (error) {
      const status = error instanceof A2AError ? error.status : error instanceof DOMException && error.name === "AbortError" ? 408 : 500;
      return errorResponse(status, safeError(error, options), null);
    } finally {
      if (acquired && !transferred) active -= 1;
    }
  };
}

function taskStream(
  id: A2AJsonRpcRequest["id"],
  taskId: string,
  contextId: string,
  run: () => Promise<AgentRunResult>,
  owned: ReturnType<typeof ownedSignal>,
  limits: ResolvedA2ALimits,
  options: CreateA2AHandlerOptions,
  release: () => void,
): ReadableStream<Uint8Array> {
  const iterator = (async function *() {
    yield { jsonrpc: "2.0", id, result: { task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } } };
    try {
      const result = await run();
      yield { jsonrpc: "2.0", id, result: { task: toTask(taskId, contextId, result, options) } };
    } catch (error) {
      yield { jsonrpc: "2.0", id, error: { code: -32000, message: safeError(error, options) } };
    }
  })()[Symbol.asyncIterator]();
  let events = 0;
  let bytes = 0;
  let released = false;
  const finish = () => { if (!released) { released = true; owned.dispose(); release(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) { finish(); controller.close(); return; }
        const payload = options.redactor?.redact(next.value) ?? next.value;
        const chunk = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
        events += 1;
        bytes += chunk.byteLength;
        if (chunk.byteLength > limits.maxEventBytes || events > limits.maxStreamEvents || bytes > limits.maxStreamBytes) throw new A2AError("A2A stream limit exceeded", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
        controller.enqueue(chunk);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    cancel(reason) { owned.abort(reason); finish(); void iterator.return?.(); },
  });
}

function toTask(taskId: string, contextId: string, result: AgentRunResult, options: CreateA2AHandlerOptions): A2ATask {
  const state: A2ATask["status"]["state"] = result.status === "succeeded" ? "TASK_STATE_COMPLETED" : result.status === "aborted" ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED";
  const text = options.redactor?.redact(result.text) ?? result.text;
  return Object.freeze({
    id: taskId,
    contextId,
    status: { state, timestamp: new Date().toISOString() },
    artifacts: text ? [{ artifactId: `${taskId}-result`, parts: [{ text }] }] : undefined,
  });
}

function parseRpc(value: unknown): A2AJsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || !(typeof value.id === "string" || typeof value.id === "number" || value.id === null) || typeof value.method !== "string") throw new A2AError("Invalid JSON-RPC request", 400, "ERR_PRISM_A2A_REQUEST");
  if (value.params !== undefined && !isRecord(value.params)) throw new A2AError("Invalid JSON-RPC params", 400, "ERR_PRISM_A2A_REQUEST");
  return { jsonrpc: "2.0", id: value.id, method: value.method, params: value.params };
}

function parseMessage(value: unknown, maxBytes: number): A2AMessage {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "ROLE_USER") || typeof value.messageId !== "string" || !value.messageId || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 32) throw new A2AError("Invalid A2A message", 400, "ERR_PRISM_A2A_MESSAGE");
  const parts = value.parts.map((part) => {
    if (!isRecord(part) || typeof part.text !== "string" || Object.keys(part).some((key) => key !== "text" && key !== "metadata")) throw new A2AError("Only text A2A parts are supported", 400, "ERR_PRISM_A2A_MESSAGE");
    return { text: part.text, metadata: isRecord(part.metadata) ? part.metadata : undefined };
  });
  const message: A2AMessage = { role: value.role, messageId: value.messageId, parts, contextId: typeof value.contextId === "string" ? value.contextId : undefined };
  if (encode(message).byteLength > maxBytes) throw new A2AError("A2A message exceeds max bytes", 413, "ERR_PRISM_A2A_MESSAGE_LIMIT");
  return message;
}

function resolveA2ALimits(input: A2ALimits = {}): ResolvedA2ALimits {
  const output: Record<string, number> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    const value = input[key] ?? DEFAULTS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD[key]) throw new A2AError(`${key} is invalid`, 400, "ERR_PRISM_A2A_CONFIG");
    output[key] = value;
  }
  return output as ResolvedA2ALimits;
}

async function readJson(request: Request, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (!request.body) throw new A2AError("Request body is required", 400, "ERR_PRISM_A2A_REQUEST");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new A2AError("Request exceeds max bytes", 413, "ERR_PRISM_A2A_REQUEST_LIMIT");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new A2AError("Invalid JSON", 400, "ERR_PRISM_A2A_REQUEST"); }
}

function boundedJson(value: unknown, maxBytes: number, options: CreateA2AHandlerOptions): Response {
  const body = JSON.stringify(options.redactor?.redact(value) ?? value);
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new A2AError("Response exceeds max bytes", 507, "ERR_PRISM_A2A_RESPONSE_LIMIT");
  return new Response(body, { status: 200, headers: JSON_HEADERS });
}

function errorResponse(status: number, message: string, id: A2AJsonRpcRequest["id"]): Response {
  const body: A2AJsonRpcResponse = { jsonrpc: "2.0", id, error: { code: status === 404 ? -32601 : -32000, message } };
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function ownedSignal(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("A2A request timed out", "AbortError")), timeoutMs);
  return { signal: controller.signal, abort: (reason?: unknown) => controller.abort(reason), dispose: () => { clearTimeout(timer); parent.removeEventListener("abort", abort); } };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function encode(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function safeError(error: unknown, options: CreateA2AHandlerOptions): string {
  const message = (error instanceof Error ? error.message : "A2A request failed").slice(0, 1024);
  return options.redactor?.redact(message) ?? message;
}
