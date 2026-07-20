import type { AgentRunResult, ContentBlock, Message } from "@arnilo/prism";
import { createA2AAgentCard } from "./a2a-card.js";
import { resolveA2ALimits, type ResolvedA2ALimits } from "./a2a-parts.js";
import { A2AError } from "./errors.js";
import { A2A_PROTOCOL_VERSION, type A2AAgentCard, type A2AClient, type A2AClientOptions, type A2AJsonRpcResponse, type A2ATask } from "./a2a-types.js";

type ClientLimits = ResolvedA2ALimits;

export function createA2AClient(options: A2AClientOptions): A2AClient {
  const endpoint = requireAllowedHttpsUrl(options.endpoint, options.allowedOrigins);
  const cardUrl = requireAllowedHttpsUrl(options.cardUrl ?? `${endpoint.origin}/.well-known/agent-card.json`, options.allowedOrigins);
  const fetcher = options.fetch ?? globalThis.fetch;
  const limits = resolveA2ALimits(options.limits);
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
      const response = await fetcher(endpoint, { method: "POST", signal, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "application/a2a+json", "a2a-version": "1.0" }, body });
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
      const response = await fetcher(endpoint, { method: "POST", signal: owned.signal, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "text/event-stream", "a2a-version": "1.0" }, body });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new A2AError("A2A stream request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      reader = response.body.getReader();
      let terminal = false;
      for await (const data of readA2AStreamData(reader, limits, owned.signal)) {
        if (terminal) throw new A2AError("A2A stream continued after terminal task state", 502, "ERR_PRISM_A2A_REMOTE");
        if (!data) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { throw new A2AError("Malformed A2A stream event", 502, "ERR_PRISM_A2A_REMOTE"); }
        const rpc = parseRpcResponse(parsed, id);
        if (rpc.error) throw new A2AError(safeRemote(rpc.error.message, options), 502, "ERR_PRISM_A2A_REMOTE");
        const task = parseTaskResult(rpc.result);
        if (task.status.state === "TASK_STATE_FAILED" || task.status.state === "TASK_STATE_CANCELED" || task.status.state === "TASK_STATE_REJECTED") throw new A2AError("Remote A2A stream task failed", 502, "ERR_PRISM_A2A_REMOTE");
        if (task.status.state === "TASK_STATE_INPUT_REQUIRED" || task.status.state === "TASK_STATE_AUTH_REQUIRED") throw new A2AError(`Remote A2A task interrupted: ${task.status.state}`, 409, "ERR_PRISM_A2A_INTERRUPTED");
        if (task.status.state === "TASK_STATE_COMPLETED") terminal = true;
        for (const artifact of task.artifacts ?? []) for (const part of artifact.parts) if (typeof part.text === "string") yield options.redactor?.redact(part.text) ?? part.text;
      }
      if (!terminal) throw new A2AError("A2A stream ended before terminal task state", 502, "ERR_PRISM_A2A_REMOTE");
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

  async function invoke(method: string, params: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    return withRequest(signal, async (owned) => {
      await getCardWithin(owned);
      const id = ++requestId;
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      if (Buffer.byteLength(body) > limits.maxRequestBytes) throw new A2AError("A2A request exceeds max bytes", 413, "ERR_PRISM_A2A_REQUEST_LIMIT");
      const authHeaders = await abortable(Promise.resolve(options.authorize?.({ endpoint: endpoint.href, signal: owned }) ?? {}), owned);
      const response = await fetcher(endpoint, { method: "POST", signal: owned, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "application/a2a+json", "a2a-version": "1.0" }, body });
      if (!response.ok) throw new A2AError("A2A remote request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      const rpc = parseRpcResponse(await readBoundedJson(response, limits.maxResponseBytes, owned), id);
      if (rpc.error) throw remoteProtocolError(rpc.error.code, rpc.error.message, options);
      return rpc.result;
    });
  }

  async function sendMessage(message: import("./a2a-types.js").A2AMessage, call: { readonly signal?: AbortSignal; readonly returnImmediately?: boolean } = {}): Promise<A2ATask> {
    return parseTaskResult(await invoke("SendMessage", { message, configuration: { returnImmediately: call.returnImmediately ?? false } }, call.signal));
  }
  async function getTask(id: string, call: { readonly signal?: AbortSignal; readonly historyLength?: number } = {}): Promise<A2ATask> { return parseTaskResult(await invoke("GetTask", { id, historyLength: call.historyLength ?? 0 }, call.signal)); }
  async function listTasks(call: { readonly signal?: AbortSignal; readonly pageSize?: number; readonly pageToken?: string; readonly contextId?: string } = {}): Promise<import("./a2a-types.js").A2ATaskPage> {
    const value = await invoke("ListTasks", { pageSize: call.pageSize ?? 50, pageToken: call.pageToken, contextId: call.contextId }, call.signal);
    if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length > limits.maxPageSize) throw new A2AError("Malformed A2A task page", 502, "ERR_PRISM_A2A_REMOTE");
    return { tasks: value.tasks.map((task) => parseTaskResult(task)), nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined, totalSize: typeof value.totalSize === "number" ? value.totalSize : undefined };
  }
  async function cancelTask(id: string, call: { readonly signal?: AbortSignal } = {}): Promise<A2ATask> { return parseTaskResult(await invoke("CancelTask", { id }, call.signal)); }
  async function* subscribeToTask(id: string, call: { readonly signal?: AbortSignal; readonly afterEventId?: string } = {}): AsyncGenerator<import("./a2a-types.js").A2ATaskEvent> {
    if (active >= limits.maxConcurrentRequests) throw new A2AError("A2A client concurrency exceeded", 429, "ERR_PRISM_A2A_CONCURRENCY");
    active += 1; const owned = ownedSignal(call.signal, limits.timeoutMs); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      await getCardWithin(owned.signal); const request = ++requestId;
      const authHeaders = await abortable(Promise.resolve(options.authorize?.({ endpoint: endpoint.href, signal: owned.signal }) ?? {}), owned.signal);
      const response = await fetcher(endpoint, { method: "POST", signal: owned.signal, redirect: "error", headers: { ...headersObject(authHeaders), "content-type": "application/a2a+json", accept: "text/event-stream", "a2a-version": "1.0" }, body: JSON.stringify({ jsonrpc: "2.0", id: request, method: "SubscribeToTask", params: { id, afterEventId: call.afterEventId } }) });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new A2AError("A2A subscribe request failed", response.status, "ERR_PRISM_A2A_REMOTE");
      reader = response.body.getReader(); let previous = "", count = 0;
      for await (const data of readA2AStreamData(reader, limits, owned.signal)) {
        const rpc = parseRpcResponse(JSON.parse(data), request); if (rpc.error) throw remoteProtocolError(rpc.error.code, rpc.error.message, options);
        const event = parseTaskEvent(rpc.result); if (event.eventId === previous) continue; previous = event.eventId; if (++count > limits.maxReplayEvents) throw new A2AError("A2A replay exceeds event limit", 507, "ERR_PRISM_A2A_STREAM_LIMIT"); yield event;
      }
    } finally { await reader?.cancel().catch(() => undefined); owned.dispose(); active -= 1; }
  }

  async function createPushConfig(config: import("./a2a-types.js").A2APushConfig, call: { readonly signal?: AbortSignal } = {}) { return parsePushConfig(await invoke("CreateTaskPushNotificationConfig", { ...config }, call.signal)); }
  async function getPushConfig(taskId: string, id: string, call: { readonly signal?: AbortSignal } = {}) { return parsePushConfig(await invoke("GetTaskPushNotificationConfig", { taskId, id }, call.signal)); }
  async function listPushConfigs(taskId: string, call: { readonly signal?: AbortSignal; readonly pageSize?: number; readonly pageToken?: string } = {}) { const value = await invoke("ListTaskPushNotificationConfigs", { taskId, pageSize: call.pageSize, pageToken: call.pageToken }, call.signal); if (!isRecord(value) || !Array.isArray(value.configs)) throw new A2AError("Malformed A2A push config page", 502, "ERR_PRISM_A2A_REMOTE"); return { configs: value.configs.map(parsePushConfig), nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined }; }
  async function deletePushConfig(taskId: string, id: string, call: { readonly signal?: AbortSignal } = {}) { await invoke("DeleteTaskPushNotificationConfig", { taskId, id }, call.signal); }

  return { getCard, send, sendMessage, stream, getTask, listTasks, cancelTask, subscribeToTask, createPushConfig, getPushConfig, listPushConfigs, deletePushConfig };
}

async function* readA2AStreamData(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limits: ClientLimits,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const lineParts: string[] = [];
  let lineTail = "";
  let lineBytes = 0;
  let eventBytes = 0;
  let eventCount = 0;
  let eventHasLine = false;
  let previousEndingBytes = 0;
  let dataLines: string[] = [];
  let totalBytes = 0;

  const appendLine = (text: string): void => {
    lineBytes += Buffer.byteLength(text, "utf8");
    const projectedEventBytes = eventBytes + (eventHasLine ? previousEndingBytes : 0) + lineBytes;
    if (projectedEventBytes > limits.maxEventBytes + 1) throw new A2AError("A2A event exceeds max bytes", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
    lineTail += text;
    // ponytail: 4 KiB coalescing bounds one-byte chunk overhead; tune only if parser profiling requires it.
    if (lineTail.length >= 4096) { lineParts.push(lineTail); lineTail = ""; }
  };
  const completeLine = (raw: string, endingBytes: number): string | undefined => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) {
      eventCount += 1;
      if (eventCount > limits.maxStreamEvents) throw new A2AError("A2A stream exceeds max events", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
      const data = dataLines.join("\n");
      eventBytes = 0;
      eventHasLine = false;
      previousEndingBytes = 0;
      dataLines = [];
      return data;
    }
    if (eventHasLine) eventBytes += previousEndingBytes;
    eventBytes += Buffer.byteLength(line, "utf8");
    if (eventBytes > limits.maxEventBytes) throw new A2AError("A2A event exceeds max bytes", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
    eventHasLine = true;
    previousEndingBytes = endingBytes;
    if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") dataLines.push(value);
    }
    return undefined;
  };
  const feed = (text: string): string[] => {
    const completed: string[] = [];
    let start = 0;
    while (true) {
      const newline = text.indexOf("\n", start);
      if (newline === -1) break;
      appendLine(text.slice(start, newline));
      const raw = `${lineParts.join("")}${lineTail}`;
      const data = completeLine(raw, raw.endsWith("\r") ? 2 : 1);
      if (data !== undefined) completed.push(data);
      lineParts.length = 0;
      lineTail = "";
      lineBytes = 0;
      start = newline + 1;
    }
    appendLine(text.slice(start));
    return completed;
  };

  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > limits.maxStreamBytes) throw new A2AError("A2A stream exceeds max bytes", 507, "ERR_PRISM_A2A_STREAM_LIMIT");
      for (const data of feed(decoder.decode(next.value, { stream: true }))) yield data;
    }
    for (const data of feed(decoder.decode())) yield data;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof A2AError) throw error;
    throw new A2AError("Malformed A2A UTF-8 stream", 502, "ERR_PRISM_A2A_REMOTE");
  }
  const tail = `${lineParts.join("")}${lineTail}`;
  if (eventHasLine || tail.trim()) throw new A2AError("Truncated A2A stream", 502, "ERR_PRISM_A2A_REMOTE");
}

function requestBody(id: number, method: "SendMessage" | "SendStreamingMessage", input: string) {
  return { jsonrpc: "2.0", id, method, params: { message: { role: "user", messageId: `message-${id}`, parts: [{ text: input }] } } };
}

function taskResult(task: A2ATask, options: A2AClientOptions): AgentRunResult {
  if (task.status.state === "TASK_STATE_SUBMITTED" || task.status.state === "TASK_STATE_WORKING") throw new A2AError("A2A response task is not terminal", 502, "ERR_PRISM_A2A_REMOTE");
  if (task.status.state === "TASK_STATE_INPUT_REQUIRED" || task.status.state === "TASK_STATE_AUTH_REQUIRED") throw new A2AError(`Remote A2A task interrupted: ${task.status.state}`, 409, "ERR_PRISM_A2A_INTERRUPTED");
  const text = (task.artifacts ?? []).flatMap((artifact) => artifact.parts.flatMap((part) => "text" in part ? [part.text] : [])).join("");
  const safeText = options.redactor?.redact(text) ?? text;
  const status = task.status.state === "TASK_STATE_COMPLETED" ? "succeeded" : task.status.state === "TASK_STATE_CANCELED" ? "aborted" : "failed";
  const content: readonly ContentBlock[] = safeText ? [{ type: "text", text: safeText }] : [];
  const message: Message | undefined = safeText ? { role: "assistant", content } : undefined;
  return Object.freeze({ sessionId: task.contextId, runId: task.id, status, text: safeText, content, message, error: status === "failed" ? { message: "Remote A2A task failed" } : undefined, abortReason: status === "aborted" ? "Remote A2A task canceled" : undefined });
}

function parseTaskResult(value: unknown): A2ATask {
  if (!isRecord(value)) throw new A2AError("Malformed A2A task result", 502, "ERR_PRISM_A2A_REMOTE");
  const task = isRecord(value.task) ? value.task : value;
  if (typeof task.id !== "string" || typeof task.contextId !== "string" || !isRecord(task.status) || typeof task.status.state !== "string") throw new A2AError("Malformed A2A task", 502, "ERR_PRISM_A2A_REMOTE");
  const states = new Set(["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED"]);
  if (!states.has(task.status.state)) throw new A2AError("Unknown A2A task state", 502, "ERR_PRISM_A2A_REMOTE");
  const artifacts = task.artifacts === undefined ? undefined : parseArtifacts(task.artifacts);
  const history = task.history === undefined ? undefined : Array.isArray(task.history) ? task.history.map(parseRemoteMessage) : (() => { throw new A2AError("Malformed A2A task history", 502, "ERR_PRISM_A2A_REMOTE"); })();
  return { id: task.id, contextId: task.contextId, status: { state: task.status.state as A2ATask["status"]["state"], timestamp: typeof task.status.timestamp === "string" ? task.status.timestamp : new Date(0).toISOString() }, artifacts, history };
}

function parseArtifacts(value: unknown): A2ATask["artifacts"] {
  if (!Array.isArray(value) || value.length > 32) throw new A2AError("Malformed A2A artifacts", 502, "ERR_PRISM_A2A_REMOTE");
  return value.map((artifact) => {
    if (!isRecord(artifact) || typeof artifact.artifactId !== "string" || !Array.isArray(artifact.parts) || artifact.parts.length > 32) throw new A2AError("Malformed A2A artifact", 502, "ERR_PRISM_A2A_REMOTE");
    return { artifactId: artifact.artifactId, parts: artifact.parts.map(parseRemotePart) };
  });
}

function parseRemotePart(value: unknown): import("./a2a-types.js").A2APart {
  if (!isRecord(value)) throw new A2AError("Malformed A2A part", 502, "ERR_PRISM_A2A_REMOTE");
  const keys = ["text", "raw", "url", "data"].filter((key) => Object.hasOwn(value, key));
  if (keys.length !== 1) throw new A2AError("Malformed A2A part union", 502, "ERR_PRISM_A2A_REMOTE");
  const base = { mediaType: typeof value.mediaType === "string" ? value.mediaType : undefined, filename: typeof value.filename === "string" ? value.filename : undefined };
  if (keys[0] === "text" && typeof value.text === "string") return { ...base, text: value.text };
  if (keys[0] === "raw" && typeof value.raw === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.raw)) return { ...base, raw: value.raw };
  if (keys[0] === "url" && typeof value.url === "string") { const url = new URL(value.url); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new A2AError("Unsafe remote A2A URL part", 502, "ERR_PRISM_A2A_REMOTE"); return { ...base, url: url.href }; }
  if (keys[0] === "data") return { ...base, data: structuredClone(value.data) };
  throw new A2AError("Malformed A2A part", 502, "ERR_PRISM_A2A_REMOTE");
}
function parseRemoteMessage(value: unknown): import("./a2a-types.js").A2AMessage { if (!isRecord(value) || typeof value.messageId !== "string" || !Array.isArray(value.parts) || (value.role !== "ROLE_USER" && value.role !== "ROLE_AGENT" && value.role !== "user" && value.role !== "agent")) throw new A2AError("Malformed A2A message", 502, "ERR_PRISM_A2A_REMOTE"); return { role: value.role, messageId: value.messageId, parts: value.parts.map(parseRemotePart), contextId: typeof value.contextId === "string" ? value.contextId : undefined, taskId: typeof value.taskId === "string" ? value.taskId : undefined }; }
function parseTaskEvent(value: unknown): import("./a2a-types.js").A2ATaskEvent {
  if (!isRecord(value) || typeof value.eventId !== "string" || !value.eventId) throw new A2AError("Malformed A2A task event", 502, "ERR_PRISM_A2A_REMOTE");
  if (isRecord(value.task)) return { eventId: value.eventId, task: parseTaskResult(value.task) };
  if (isRecord(value.statusUpdate) && typeof value.statusUpdate.taskId === "string" && typeof value.statusUpdate.contextId === "string" && isRecord(value.statusUpdate.status)) { const parsed = parseTaskResult({ id: value.statusUpdate.taskId, contextId: value.statusUpdate.contextId, status: value.statusUpdate.status }); return { eventId: value.eventId, statusUpdate: { taskId: parsed.id, contextId: parsed.contextId, status: parsed.status } }; }
  if (isRecord(value.artifactUpdate) && typeof value.artifactUpdate.taskId === "string" && typeof value.artifactUpdate.contextId === "string" && isRecord(value.artifactUpdate.artifact)) return { eventId: value.eventId, artifactUpdate: { taskId: value.artifactUpdate.taskId, contextId: value.artifactUpdate.contextId, artifact: parseArtifacts([value.artifactUpdate.artifact])![0]!, append: value.artifactUpdate.append === true, lastChunk: value.artifactUpdate.lastChunk === true } };
  throw new A2AError("Malformed A2A task event", 502, "ERR_PRISM_A2A_REMOTE");
}
function parsePushConfig(value: unknown): import("./a2a-types.js").A2APushConfig { if (!isRecord(value) || typeof value.id !== "string" || typeof value.taskId !== "string" || typeof value.url !== "string") throw new A2AError("Malformed A2A push config", 502, "ERR_PRISM_A2A_REMOTE"); const url = new URL(value.url); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new A2AError("Unsafe A2A push URL", 502, "ERR_PRISM_A2A_REMOTE"); return { id: value.id, taskId: value.taskId, url: url.href, token: typeof value.token === "string" ? value.token : undefined, authentication: isRecord(value.authentication) && typeof value.authentication.scheme === "string" ? { scheme: value.authentication.scheme, credentials: typeof value.authentication.credentials === "string" ? value.authentication.credentials : undefined } : undefined }; }
function remoteProtocolError(code: number, message: string, options: A2AClientOptions): A2AError { return new A2AError(safeRemote(message, options), code === -32001 ? 404 : code === -32004 ? 501 : 502, code === -32001 ? "ERR_PRISM_A2A_TASK_NOT_FOUND" : code === -32004 ? "ERR_PRISM_A2A_UNSUPPORTED" : "ERR_PRISM_A2A_REMOTE"); }

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
