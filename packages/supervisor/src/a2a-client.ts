import type { AgentRunResult, ContentBlock, Message } from "@arnilo/prism";
import { createA2AAgentCard } from "./a2a-card.js";
import { A2AError } from "./errors.js";
import { A2A_PROTOCOL_VERSION, type A2AAgentCard, type A2AClient, type A2AClientOptions, type A2AJsonRpcResponse, type A2ALimits, type A2ATask } from "./a2a-types.js";

const DEFAULTS = { maxRequestBytes: 64 * 1024, maxResponseBytes: 1024 * 1024, maxEventBytes: 64 * 1024, maxStreamBytes: 10 * 1024 * 1024, maxStreamEvents: 10_000, maxConcurrentRequests: 16, timeoutMs: 120_000, maxCardBytes: 64 * 1024 } as const;
const HARD = { maxRequestBytes: 1024 * 1024, maxResponseBytes: 8 * 1024 * 1024, maxEventBytes: 1024 * 1024, maxStreamBytes: 64 * 1024 * 1024, maxStreamEvents: 100_000, maxConcurrentRequests: 256, timeoutMs: 30 * 60_000, maxCardBytes: 1024 * 1024 } as const;
type ClientLimits = { readonly [K in keyof typeof DEFAULTS]: number };

export function createA2AClient(options: A2AClientOptions): A2AClient {
  const endpoint = requireAllowedHttpsUrl(options.endpoint, options.allowedOrigins);
  const cardUrl = requireAllowedHttpsUrl(options.cardUrl ?? `${endpoint.origin}/.well-known/agent-card.json`, options.allowedOrigins);
  const fetcher = options.fetch ?? globalThis.fetch;
  const limits = clientLimits(options.limits);
  let active = 0;
  let requestId = 0;

  async function withRequest<T>(signal: AbortSignal | undefined, operation: (owned: AbortSignal) => Promise<T>): Promise<T> {
    if (active >= limits.maxConcurrentRequests) throw new A2AError("A2A client concurrency exceeded", 429, "ERR_PRISM_A2A_CONCURRENCY");
    active += 1;
    const owned = ownedSignal(signal, limits.timeoutMs);
    try { return await operation(owned.signal); } finally { owned.dispose(); active -= 1; }
  }

  async function getCard(call: { readonly signal?: AbortSignal } = {}): Promise<A2AAgentCard> {
    return withRequest(call.signal, async (signal) => {
      const response = await fetcher(cardUrl, { method: "GET", signal, redirect: "error", headers: { accept: "application/a2a+json, application/json" } });
      if (!response.ok) throw new A2AError("A2A card request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      const value = await readBoundedJson(response, limits.maxCardBytes, signal);
      const card = parseCard(value);
      if (!card.supportedInterfaces.some((item) => item.protocolBinding === "JSONRPC" && item.protocolVersion === A2A_PROTOCOL_VERSION && item.url === endpoint.href)) throw new A2AError("Agent card does not declare the selected endpoint", 403, "ERR_PRISM_A2A_CARD");
      if (options.verifyCard) await abortable(Promise.resolve(options.verifyCard(card)), signal);
      return card;
    });
  }

  async function send(input: string, call: { readonly signal?: AbortSignal } = {}): Promise<AgentRunResult> {
    return withRequest(call.signal, async (signal) => {
      assertInput(input, limits.maxRequestBytes);
      await getCardWithin(signal);
      const id = ++requestId;
      const body = JSON.stringify(requestBody(id, "SendMessage", input));
      if (new TextEncoder().encode(body).byteLength > limits.maxRequestBytes) throw new A2AError("A2A request exceeds max bytes", 413, "ERR_PRISM_A2A_REQUEST_LIMIT");
      const authHeaders = await abortable(Promise.resolve(options.authorize?.({ endpoint: endpoint.href, signal }) ?? {}), signal);
      const response = await fetcher(endpoint, { method: "POST", signal, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "application/a2a+json" }, body });
      if (!response.ok) throw new A2AError("A2A remote request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      const rpc = parseRpcResponse(await readBoundedJson(response, limits.maxResponseBytes, signal), id);
      if (rpc.error) throw new A2AError(safeRemote(rpc.error.message, options), 502, "ERR_PRISM_A2A_REMOTE");
      return taskResult(parseTaskResult(rpc.result), options);
    });
  }

  async function *stream(input: string, call: { readonly signal?: AbortSignal } = {}): AsyncGenerator<string> {
    if (active >= limits.maxConcurrentRequests) throw new A2AError("A2A client concurrency exceeded", 429, "ERR_PRISM_A2A_CONCURRENCY");
    active += 1;
    const owned = ownedSignal(call.signal, limits.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      assertInput(input, limits.maxRequestBytes);
      await getCardWithin(owned.signal);
      const id = ++requestId;
      const body = JSON.stringify(requestBody(id, "SendStreamingMessage", input));
      if (new TextEncoder().encode(body).byteLength > limits.maxRequestBytes) throw new A2AError("A2A request exceeds max bytes", 413, "ERR_PRISM_A2A_REQUEST_LIMIT");
      const authHeaders = await abortable(Promise.resolve(options.authorize?.({ endpoint: endpoint.href, signal: owned.signal }) ?? {}), owned.signal);
      const response = await fetcher(endpoint, { method: "POST", signal: owned.signal, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "text/event-stream" }, body });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new A2AError("A2A stream request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      reader = response.body.getReader();
      let buffered = "";
      let totalBytes = 0;
      let eventCount = 0;
      let terminal = false;
      while (true) {
        owned.signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        totalBytes += next.value.byteLength;
        if (totalBytes > limits.maxStreamBytes) throw new A2AError("A2A stream exceeds max bytes", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
        buffered += new TextDecoder().decode(next.value, { stream: true });
        while (buffered.includes("\n\n")) {
          const split = buffered.indexOf("\n\n");
          const frame = buffered.slice(0, split);
          buffered = buffered.slice(split + 2);
          if (new TextEncoder().encode(frame).byteLength > limits.maxEventBytes) throw new A2AError("A2A event exceeds max bytes", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
          eventCount += 1;
          if (eventCount > limits.maxStreamEvents) throw new A2AError("A2A stream exceeds max events", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { throw new A2AError("Malformed A2A stream event", 502, "ERR_PRISM_A2A_REMOTE"); }
          const rpc = parseRpcResponse(parsed, id);
          if (rpc.error) throw new A2AError(safeRemote(rpc.error.message, options), 502, "ERR_PRISM_A2A_REMOTE");
          const task = parseTaskResult(rpc.result);
          if (task.status.state === "TASK_STATE_FAILED" || task.status.state === "TASK_STATE_CANCELED") throw new A2AError("Remote A2A stream task failed", 502, "ERR_PRISM_A2A_REMOTE");
          if (task.status.state === "TASK_STATE_COMPLETED") terminal = true;
          for (const artifact of task.artifacts ?? []) for (const part of artifact.parts) yield options.redactor?.redact(part.text) ?? part.text;
        }
      }
      if (!terminal) throw new A2AError("A2A stream ended before terminal task state", 502, "ERR_PRISM_A2A_REMOTE");
      if (buffered.trim()) throw new A2AError("Truncated A2A stream", 502, "ERR_PRISM_A2A_REMOTE");
    } finally {
      await reader?.cancel().catch(() => undefined);
      owned.dispose();
      active -= 1;
    }
  }

  async function getCardWithin(signal: AbortSignal): Promise<A2AAgentCard> {
    const response = await fetcher(cardUrl, { method: "GET", signal, redirect: "error", headers: { accept: "application/a2a+json, application/json" } });
    if (!response.ok) throw new A2AError("A2A card request failed", response.status, "ERR_PRISM_A2A_REMOTE");
    const card = parseCard(await readBoundedJson(response, limits.maxCardBytes, signal));
    if (!card.supportedInterfaces.some((item) => item.protocolBinding === "JSONRPC" && item.protocolVersion === A2A_PROTOCOL_VERSION && item.url === endpoint.href)) throw new A2AError("Agent card does not declare the selected endpoint", 403, "ERR_PRISM_A2A_CARD");
    if (options.verifyCard) await abortable(Promise.resolve(options.verifyCard(card)), signal);
    return card;
  }

  return { getCard, send, stream };
}

function requestBody(id: number, method: "SendMessage" | "SendStreamingMessage", input: string) {
  return { jsonrpc: "2.0", id, method, params: { message: { role: "user", messageId: `message-${id}`, parts: [{ text: input }] } } };
}

function taskResult(task: A2ATask, options: A2AClientOptions): AgentRunResult {
  if (task.status.state === "TASK_STATE_SUBMITTED" || task.status.state === "TASK_STATE_WORKING") throw new A2AError("A2A response task is not terminal", 502, "ERR_PRISM_A2A_REMOTE");
  const text = (task.artifacts ?? []).flatMap((artifact) => artifact.parts.map((part) => part.text)).join("");
  const safeText = options.redactor?.redact(text) ?? text;
  const status = task.status.state === "TASK_STATE_COMPLETED" ? "succeeded" : task.status.state === "TASK_STATE_CANCELED" ? "aborted" : "failed";
  const content: readonly ContentBlock[] = safeText ? [{ type: "text", text: safeText }] : [];
  const message: Message | undefined = safeText ? { role: "assistant", content } : undefined;
  return Object.freeze({ sessionId: task.contextId, runId: task.id, status, text: safeText, content, message, error: status === "failed" ? { message: "Remote A2A task failed" } : undefined, abortReason: status === "aborted" ? "Remote A2A task canceled" : undefined });
}

function parseTaskResult(value: unknown): A2ATask {
  if (!isRecord(value) || !isRecord(value.task)) throw new A2AError("Malformed A2A task result", 502, "ERR_PRISM_A2A_REMOTE");
  const task = value.task;
  if (typeof task.id !== "string" || typeof task.contextId !== "string" || !isRecord(task.status) || typeof task.status.state !== "string") throw new A2AError("Malformed A2A task", 502, "ERR_PRISM_A2A_REMOTE");
  const states = new Set(["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"]);
  if (!states.has(task.status.state)) throw new A2AError("Unknown A2A task state", 502, "ERR_PRISM_A2A_REMOTE");
  const artifacts = task.artifacts === undefined ? undefined : parseArtifacts(task.artifacts);
  return { id: task.id, contextId: task.contextId, status: { state: task.status.state as A2ATask["status"]["state"], timestamp: typeof task.status.timestamp === "string" ? task.status.timestamp : new Date(0).toISOString() }, artifacts };
}

function parseArtifacts(value: unknown): A2ATask["artifacts"] {
  if (!Array.isArray(value) || value.length > 32) throw new A2AError("Malformed A2A artifacts", 502, "ERR_PRISM_A2A_REMOTE");
  return value.map((artifact) => {
    if (!isRecord(artifact) || typeof artifact.artifactId !== "string" || !Array.isArray(artifact.parts) || artifact.parts.length > 32) throw new A2AError("Malformed A2A artifact", 502, "ERR_PRISM_A2A_REMOTE");
    return { artifactId: artifact.artifactId, parts: artifact.parts.map((part) => {
      if (!isRecord(part) || typeof part.text !== "string") throw new A2AError("Unsupported A2A artifact part", 502, "ERR_PRISM_A2A_REMOTE");
      return { text: part.text };
    }) };
  });
}

function parseRpcResponse(value: unknown, id: string | number): A2AJsonRpcResponse {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.id !== id) throw new A2AError("Malformed A2A JSON-RPC response", 502, "ERR_PRISM_A2A_REMOTE");
  const error = value.error;
  if (error !== undefined && (!isRecord(error) || typeof error.code !== "number" || typeof error.message !== "string")) throw new A2AError("Malformed A2A JSON-RPC error", 502, "ERR_PRISM_A2A_REMOTE");
  return { jsonrpc: "2.0", id, result: value.result, error: error as A2AJsonRpcResponse["error"] };
}

function parseCard(value: unknown): A2AAgentCard {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.description !== "string" || typeof value.version !== "string" || !Array.isArray(value.supportedInterfaces) || !Array.isArray(value.skills) || !stringArray(value.defaultInputModes) || !stringArray(value.defaultOutputModes) || !isRecord(value.capabilities) || typeof value.capabilities.streaming !== "boolean") throw new A2AError("Malformed A2A agent card", 502, "ERR_PRISM_A2A_CARD");
  const supportedInterfaces = value.supportedInterfaces.map((item) => {
    if (!isRecord(item) || typeof item.url !== "string" || item.protocolBinding !== "JSONRPC" || item.protocolVersion !== "1.0") throw new A2AError("Malformed A2A agent interface", 502, "ERR_PRISM_A2A_CARD");
    return { url: item.url, protocolBinding: "JSONRPC" as const, protocolVersion: "1.0" as const };
  });
  const skills = value.skills.map((skill) => {
    if (!isRecord(skill) || typeof skill.id !== "string" || typeof skill.name !== "string" || typeof skill.description !== "string" || !stringArray(skill.tags)) throw new A2AError("Malformed A2A agent skill", 502, "ERR_PRISM_A2A_CARD");
    return { id: skill.id, name: skill.name, description: skill.description, tags: skill.tags, examples: stringArray(skill.examples) ? skill.examples : undefined, inputModes: stringArray(skill.inputModes) ? skill.inputModes : undefined, outputModes: stringArray(skill.outputModes) ? skill.outputModes : undefined };
  });
  const signatures = value.signatures === undefined ? undefined : Array.isArray(value.signatures) ? value.signatures.map((signature) => {
    if (!isRecord(signature) || typeof signature.protected !== "string" || typeof signature.signature !== "string") throw new A2AError("Malformed A2A card signature", 502, "ERR_PRISM_A2A_CARD");
    return { protected: signature.protected, signature: signature.signature, header: isRecord(signature.header) ? signature.header : undefined };
  }) : (() => { throw new A2AError("Malformed A2A card signatures", 502, "ERR_PRISM_A2A_CARD"); })();
  return createA2AAgentCard({
    name: value.name,
    description: value.description,
    version: value.version,
    supportedInterfaces,
    capabilities: { streaming: value.capabilities.streaming, pushNotifications: typeof value.capabilities.pushNotifications === "boolean" ? value.capabilities.pushNotifications : undefined, extendedAgentCard: typeof value.capabilities.extendedAgentCard === "boolean" ? value.capabilities.extendedAgentCard : undefined },
    defaultInputModes: value.defaultInputModes,
    defaultOutputModes: value.defaultOutputModes,
    skills,
    securitySchemes: isRecord(value.securitySchemes) ? value.securitySchemes : undefined,
    security: parseSecurity(value.security),
    signatures,
  });
}

async function readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.includes("json")) throw new A2AError("Unexpected A2A response content type", 502, "ERR_PRISM_A2A_REMOTE");
  if (!response.body) throw new A2AError("A2A response body is missing", 502, "ERR_PRISM_A2A_REMOTE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new A2AError("A2A response exceeds max bytes", 507, "ERR_PRISM_A2A_RESPONSE_LIMIT");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new A2AError("Malformed A2A JSON response", 502, "ERR_PRISM_A2A_REMOTE"); }
}

function requireAllowedHttpsUrl(value: string, origins: readonly string[]): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !origins.includes(url.origin)) throw new A2AError("A2A endpoint origin is not allow-listed HTTPS", 403, "ERR_PRISM_A2A_ORIGIN");
  return url;
}

function clientLimits(input: A2ALimits = {}): ClientLimits {
  const output: Record<string, number> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    const value = input[key] ?? DEFAULTS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD[key]) throw new A2AError(`${key} is invalid`, 400, "ERR_PRISM_A2A_CONFIG");
    output[key] = value;
  }
  return output as ClientLimits;
}

function ownedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("A2A request timed out", "AbortError")), timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function assertInput(input: string, maxBytes: number): void { if (new TextEncoder().encode(input).byteLength > maxBytes) throw new A2AError("A2A input exceeds max bytes", 413, "ERR_PRISM_A2A_REQUEST_LIMIT"); }
function headersObject(headers: HeadersInit): Record<string, string> { return Object.fromEntries(new Headers(headers).entries()); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function parseSecurity(value: unknown): readonly Readonly<Record<string, readonly string[]>>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new A2AError("Malformed A2A card security", 502, "ERR_PRISM_A2A_CARD");
  return value.map((entry) => {
    if (!isRecord(entry) || !Object.values(entry).every(stringArray)) throw new A2AError("Malformed A2A card security", 502, "ERR_PRISM_A2A_CARD");
    return entry as Record<string, readonly string[]>;
  });
}
function safeRemote(message: string, options: A2AClientOptions): string { return options.redactor?.redact(message.slice(0, 1024)) ?? message.slice(0, 1024); }
