import type { AgentRunResult } from "@arnilo/prism";
import { createA2AAgentCard } from "./a2a-card.js";
import { bounded, optionalCursor, parseA2AMessage, record, requireId, resolveA2ALimits, validateA2ATask, type ResolvedA2ALimits } from "./a2a-parts.js";
import { A2AError } from "./errors.js";
import type { A2AAuthorization, A2AJsonRpcRequest, A2AJsonRpcResponse, A2APushConfig, A2ATask, A2ATaskEvent, CreateA2AHandlerOptions } from "./a2a-types.js";

const JSON_HEADERS = { "content-type": "application/a2a+json; charset=utf-8", "a2a-version": "1.0" };
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "a2a-version": "1.0" };

export function createA2AHandler(options: CreateA2AHandlerOptions): (request: Request) => Promise<Response> {
  const limits = resolveA2ALimits(options.limits);
  const card = createA2AAgentCard(options.card);
  if (Boolean(card.capabilities.pushNotifications) !== Boolean(options.push)) throw new A2AError("Agent card push capability must match push adapter", 400, "ERR_PRISM_A2A_CONFIG");
  const endpointPath = options.endpointPath ?? new URL(card.supportedInterfaces[0]!.url).pathname;
  if (!endpointPath.startsWith("/")) throw new A2AError("endpointPath must be absolute", 400, "ERR_PRISM_A2A_CONFIG");
  const cardJson = JSON.stringify(card);
  if (Buffer.byteLength(cardJson) > limits.maxCardBytes) throw new A2AError("Agent card exceeds max bytes", 400, "ERR_PRISM_A2A_CARD");
  let active = 0;

  return async (request) => {
    let acquired = false, transferred = false;
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/.well-known/agent-card.json") return new Response(cardJson, { headers: JSON_HEADERS });
      if (request.method !== "POST" || path !== endpointPath) return errorResponse(404, "Not found", null);
      const version = request.headers.get("a2a-version");
      if (version && version !== "1.0") return rpcError(null, -32009, "Unsupported A2A version");
      if (active >= limits.maxConcurrentRequests) return errorResponse(429, "Too many requests", null);
      active += 1; acquired = true;
      const owned = ownedSignal(request.signal, limits.timeoutMs);
      try {
        const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (contentType !== "application/json" && contentType !== "application/a2a+json") return errorResponse(415, "Unsupported media type", null);
        const rpc = parseRpc(await readJson(request, limits.maxRequestBytes, owned.signal));
        const authorization = await abortable(Promise.resolve(options.authorize({ request, method: rpc.method, signal: owned.signal })), owned.signal);
        if (!authorization) return errorResponse(403, "Forbidden", rpc.id);
        if (rpc.method === "GetExtendedAgentCard") return card.capabilities.extendedAgentCard ? json(rpc.id, card, limits, options) : rpcError(rpc.id, -32004, "Extended Agent Card unavailable");

        if (rpc.method === "SendMessage" || rpc.method === "SendStreamingMessage") {
          const message = await parseA2AMessage(rpc.params?.message, limits, options.parts);
          if (options.tasks) {
            const task = await options.tasks.start({ message, authorization, signal: owned.signal, returnImmediately: record(rpc.params?.configuration) && rpc.params.configuration.returnImmediately === true });
            await validateA2ATask(task, limits, options.parts);
            if (rpc.method === "SendMessage") return json(rpc.id, { task }, limits, options);
            transferred = true;
            const events = terminal(task.status.state) ? oneEvent(task) : options.tasks.subscribe({ id: task.id, authorization, signal: owned.signal });
            return streamResponse(rpc.id, events, owned, limits, options, () => { active -= 1; });
          }
          if (message.parts.some((part) => !("text" in part))) return rpcError(rpc.id, -32004, "Durable task lifecycle required for rich parts");
          const input = message.parts.map((part) => part.text).join("\n");
          const session = await abortable(Promise.resolve(options.exposure.sessionFactory(authorization)), owned.signal);
          const taskId = `task-${crypto.randomUUID()}`, contextId = message.contextId ?? `context-${crypto.randomUUID()}`;
          if (rpc.method === "SendMessage") return json(rpc.id, { task: toTask(taskId, contextId, await abortable(session.run(input, { ownership: authorization.ownership, metadata: authorization.metadata, signal: owned.signal, redactor: options.redactor }), owned.signal), options) }, limits, options);
          transferred = true;
          const events = runEvents(taskId, contextId, () => session.run(input, { ownership: authorization.ownership, metadata: authorization.metadata, signal: owned.signal, redactor: options.redactor }), options);
          return streamResponse(rpc.id, events, owned, limits, options, () => { active -= 1; });
        }

        if (["GetTask", "ListTasks", "CancelTask", "SubscribeToTask"].includes(rpc.method)) {
          if (!options.tasks) return rpcError(rpc.id, -32004, "Task lifecycle unavailable");
          if (rpc.method === "GetTask") {
            const task = await options.tasks.get({ id: requireId(rpc.params?.id, limits), historyLength: integer(rpc.params?.historyLength, 0, limits.maxHistory), authorization, signal: owned.signal });
            return task ? json(rpc.id, await validateA2ATask(task, limits, options.parts), limits, options) : rpcError(rpc.id, -32001, "Task not found");
          }
          if (rpc.method === "ListTasks") {
            const pageSize = integer(rpc.params?.pageSize, 50, limits.maxPageSize), pageToken = optionalCursor(rpc.params?.pageToken, limits), contextId = rpc.params?.contextId === undefined ? undefined : requireId(rpc.params.contextId, limits, "context id");
            const page = await options.tasks.list({ pageSize, pageToken, contextId, authorization, signal: owned.signal });
            if (page.tasks.length > pageSize || page.tasks.length > limits.maxPageSize) throw new A2AError("Task page exceeds limit", 507, "ERR_PRISM_A2A_RESPONSE_LIMIT");
            for (const task of page.tasks) await validateA2ATask(task, limits, options.parts);
            optionalCursor(page.nextPageToken, limits);
            return json(rpc.id, page, limits, options);
          }
          if (rpc.method === "CancelTask") {
            const task = await options.tasks.cancel({ id: requireId(rpc.params?.id, limits), authorization, signal: owned.signal });
            return task ? json(rpc.id, await validateA2ATask(task, limits, options.parts), limits, options) : rpcError(rpc.id, -32001, "Task not found");
          }
          const taskId = requireId(rpc.params?.id, limits), afterEventId = optionalCursor(rpc.params?.afterEventId, limits);
          const current = await options.tasks.get({ id: taskId, historyLength: 0, authorization, signal: owned.signal });
          if (!current) return rpcError(rpc.id, -32001, "Task not found");
          if (finalTerminal(current.status.state)) return rpcError(rpc.id, -32004, "Terminal task cannot be subscribed");
          transferred = true;
          return streamResponse(rpc.id, options.tasks.subscribe({ id: taskId, afterEventId, authorization, signal: owned.signal }), owned, limits, options, () => { active -= 1; });
        }

        if (rpc.method.includes("TaskPushNotificationConfig")) return await pushOperation(rpc, authorization, owned.signal, limits, options);
        return rpcError(rpc.id, -32601, "Method not found");
      } finally { if (!transferred) owned.dispose(); }
    } catch (error) {
      const status = error instanceof A2AError ? error.status : error instanceof DOMException && error.name === "AbortError" ? 408 : 500;
      return errorResponse(status, safeError(error, options), null);
    } finally { if (acquired && !transferred) active -= 1; }
  };
}

async function pushOperation(rpc: A2AJsonRpcRequest, authorization: A2AAuthorization, signal: AbortSignal, limits: ResolvedA2ALimits, options: CreateA2AHandlerOptions): Promise<Response> {
  if (!options.push) return rpcError(rpc.id, -32004, "Push notifications unavailable");
  const taskId = requireId(rpc.params?.taskId, limits), id = rpc.params?.id === undefined ? undefined : requireId(rpc.params.id, limits, "push config id");
  if (rpc.method === "CreateTaskPushNotificationConfig") {
    const supplied = record(rpc.params?.config) ? rpc.params.config : rpc.params;
    if (!record(supplied)) throw new A2AError("Invalid push config", 400, "ERR_PRISM_A2A_PUSH");
    const config = await parsePush({ ...supplied, taskId }, limits, options);
    return json(rpc.id, publicPush(await options.push.create({ config, authorization, signal })), limits, options);
  }
  if (rpc.method === "GetTaskPushNotificationConfig") { const value = await options.push.get({ taskId, id: id!, authorization, signal }); return value ? json(rpc.id, publicPush(value), limits, options) : rpcError(rpc.id, -32001, "Task or push config not found"); }
  if (rpc.method === "ListTaskPushNotificationConfigs") {
    const pageSize = integer(rpc.params?.pageSize, limits.maxPushConfigs, limits.maxPushConfigs), pageToken = optionalCursor(rpc.params?.pageToken, limits);
    const page = await options.push.list({ taskId, pageSize, pageToken, authorization, signal });
    if (page.configs.length > pageSize) throw new A2AError("Push config page exceeds limit", 507, "ERR_PRISM_A2A_RESPONSE_LIMIT");
    return json(rpc.id, { configs: page.configs.map(publicPush), nextPageToken: optionalCursor(page.nextPageToken, limits) }, limits, options);
  }
  if (rpc.method === "DeleteTaskPushNotificationConfig") return await options.push.delete({ taskId, id: id!, authorization, signal }) ? json(rpc.id, {}, limits, options) : rpcError(rpc.id, -32001, "Task or push config not found");
  return rpcError(rpc.id, -32601, "Method not found");
}

async function parsePush(value: Record<string, unknown>, limits: ResolvedA2ALimits, options: CreateA2AHandlerOptions): Promise<A2APushConfig> {
  const id = requireId(value.id, limits, "push config id"), taskId = requireId(value.taskId, limits);
  if (typeof value.url !== "string" || !options.parts?.validateUrl) throw new A2AError("Push URL policy required", 403, "ERR_PRISM_A2A_ORIGIN");
  let url: URL; try { url = new URL(value.url); } catch { throw new A2AError("Invalid push URL", 400, "ERR_PRISM_A2A_PUSH"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new A2AError("Push URL requires credential-free HTTPS", 403, "ERR_PRISM_A2A_ORIGIN");
  await options.parts.validateUrl(url);
  const authentication = record(value.authentication) && typeof value.authentication.scheme === "string" ? { scheme: value.authentication.scheme.slice(0, 64), credentials: typeof value.authentication.credentials === "string" ? value.authentication.credentials.slice(0, limits.maxPartBytes) : undefined } : undefined;
  return bounded({ id, taskId, url: url.href, token: typeof value.token === "string" ? value.token.slice(0, limits.maxPartBytes) : undefined, authentication }, limits.maxPartBytes, "Push config");
}
function publicPush(value: A2APushConfig): A2APushConfig { return { id: value.id, taskId: value.taskId, url: value.url, authentication: value.authentication ? { scheme: value.authentication.scheme } : undefined }; }

function streamResponse(id: A2AJsonRpcRequest["id"], source: AsyncIterable<A2ATaskEvent>, owned: ReturnType<typeof ownedSignal>, limits: ResolvedA2ALimits, options: CreateA2AHandlerOptions, release: () => void): Response {
  const iterator = source[Symbol.asyncIterator](); let events = 0, bytes = 0, released = false, previous = "";
  const finish = () => { if (!released) { released = true; owned.dispose(); release(); void iterator.return?.(); } };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) { try { const next = await iterator.next(); if (next.done) { finish(); controller.close(); return; } if (!optionalCursor(next.value.eventId, limits) || next.value.eventId === previous) throw new A2AError("Duplicate/invalid A2A event id", 500, "ERR_PRISM_A2A_STREAM_LIMIT"); await validateTaskEvent(next.value, limits, options); previous = next.value.eventId; const payload = options.redactor?.redact({ jsonrpc: "2.0", id, result: next.value }) ?? { jsonrpc: "2.0", id, result: next.value }; const chunk = new TextEncoder().encode(`id: ${next.value.eventId}\ndata: ${JSON.stringify(payload)}\n\n`); events++; bytes += chunk.byteLength; if (events > Math.min(limits.maxStreamEvents, limits.maxReplayEvents) || chunk.byteLength > limits.maxEventBytes || bytes > limits.maxStreamBytes) throw new A2AError("A2A stream limit exceeded", 507, "ERR_PRISM_A2A_STREAM_LIMIT"); controller.enqueue(chunk); } catch (error) { finish(); controller.error(error); } },
    cancel(reason) { owned.abort(reason); finish(); },
  }), { headers: SSE_HEADERS });
}
async function validateTaskEvent(event: A2ATaskEvent, limits: ResolvedA2ALimits, options: CreateA2AHandlerOptions): Promise<void> {
  if ("task" in event) { await validateA2ATask(event.task, limits, options.parts); return; }
  if ("statusUpdate" in event) { await validateA2ATask({ id: event.statusUpdate.taskId, contextId: event.statusUpdate.contextId, status: event.statusUpdate.status }, limits, options.parts); return; }
  await validateA2ATask({ id: event.artifactUpdate.taskId, contextId: event.artifactUpdate.contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, artifacts: [event.artifactUpdate.artifact] }, limits, options.parts);
}
async function* oneEvent(task: A2ATask): AsyncGenerator<A2ATaskEvent> { yield { eventId: `terminal-${task.id}`, task }; }
async function* runEvents(taskId: string, contextId: string, run: () => Promise<AgentRunResult>, options: CreateA2AHandlerOptions): AsyncGenerator<A2ATaskEvent> { yield { eventId: "1", task: { id: taskId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } }; yield { eventId: "2", task: toTask(taskId, contextId, await run(), options) }; }
function toTask(taskId: string, contextId: string, result: AgentRunResult, options: CreateA2AHandlerOptions): A2ATask { const state = result.status === "succeeded" ? "TASK_STATE_COMPLETED" : result.status === "aborted" ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED"; const text = options.redactor?.redact(result.text) ?? result.text; return { id: taskId, contextId, status: { state, timestamp: new Date().toISOString() }, artifacts: text ? [{ artifactId: `${taskId}-result`, parts: [{ text }] }] : undefined }; }
function parseRpc(value: unknown): A2AJsonRpcRequest { if (!record(value) || value.jsonrpc !== "2.0" || !(typeof value.id === "string" || typeof value.id === "number" || value.id === null) || typeof value.method !== "string" || (value.params !== undefined && !record(value.params))) throw new A2AError("Invalid JSON-RPC request", 400, "ERR_PRISM_A2A_REQUEST"); return { jsonrpc: "2.0", id: value.id, method: value.method, params: value.params as Record<string, unknown> | undefined }; }
async function readJson(request: Request, maxBytes: number, signal: AbortSignal): Promise<unknown> { if (!request.body) throw new A2AError("Request body is required", 400, "ERR_PRISM_A2A_REQUEST"); const reader=request.body.getReader(), chunks:Uint8Array[]=[]; let size=0; try { while(true){ signal.throwIfAborted(); const n=await reader.read(); if(n.done)break; size+=n.value.byteLength; if(size>maxBytes)throw new A2AError("Request exceeds max bytes",413,"ERR_PRISM_A2A_REQUEST_LIMIT"); chunks.push(n.value); } } finally { reader.releaseLock(); } const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;} try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new A2AError("Invalid JSON",400,"ERR_PRISM_A2A_REQUEST");} }
function json(id: A2AJsonRpcRequest["id"], result: unknown, limits: ResolvedA2ALimits, options: CreateA2AHandlerOptions): Response { const body=JSON.stringify(options.redactor?.redact({jsonrpc:"2.0",id,result})??{jsonrpc:"2.0",id,result}); if(Buffer.byteLength(body)>limits.maxResponseBytes)throw new A2AError("Response exceeds max bytes",507,"ERR_PRISM_A2A_RESPONSE_LIMIT"); return new Response(body,{headers:JSON_HEADERS}); }
function rpcError(id: A2AJsonRpcRequest["id"], code: number, message: string): Response { return new Response(JSON.stringify({jsonrpc:"2.0",id,error:{code,message}}),{headers:JSON_HEADERS}); }
function errorResponse(status:number,message:string,id:A2AJsonRpcRequest["id"]):Response{const body:A2AJsonRpcResponse={jsonrpc:"2.0",id,error:{code:status===404?-32001:-32000,message}};return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});}
function integer(value:unknown,fallback:number,max:number):number{if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>max)throw new A2AError("Invalid A2A integer limit",400,"ERR_PRISM_A2A_REQUEST");return Number(value);}
function terminal(state:A2ATask["status"]["state"]):boolean{return finalTerminal(state)||state==="TASK_STATE_INPUT_REQUIRED"||state==="TASK_STATE_AUTH_REQUIRED";}
function finalTerminal(state:A2ATask["status"]["state"]):boolean{return ["TASK_STATE_COMPLETED","TASK_STATE_FAILED","TASK_STATE_CANCELED","TASK_STATE_REJECTED"].includes(state);}
function ownedSignal(parent:AbortSignal,timeoutMs:number){const controller=new AbortController();const abort=()=>controller.abort(parent.reason);if(parent.aborted)abort();else parent.addEventListener("abort",abort,{once:true});const timer=setTimeout(()=>controller.abort(new DOMException("A2A request timed out","AbortError")),timeoutMs);return{signal:controller.signal,abort:(reason?:unknown)=>controller.abort(reason),dispose:()=>{clearTimeout(timer);parent.removeEventListener("abort",abort);}};}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(signal.reason);return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));});}
function safeError(error:unknown,options:CreateA2AHandlerOptions):string{const message=(error instanceof Error?error.message:"A2A request failed").slice(0,1024);return options.redactor?.redact(message)??message;}
