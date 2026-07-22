import { EventSchemas, EventType, type AGUIEvent } from "@ag-ui/core";
import type { AgentEvent, AgentRunLifecycle, AgentSession, SecretRedactor } from "@arnilo/prism";
import { createAgUiEventMapper, type AgUiEventMapperOptions } from "./ag-ui-mapper.js";
import { AgUiError } from "./errors.js";
import { parseAgUiInput, type ParsedAgUiInput } from "./input.js";
import { resolveAgUiLimits, type AgUiLimitOptions, type ResolvedAgUiLimits } from "./limits.js";
import type { AgUiProjection } from "./projection.js";
import type { AgUiReplay, AgUiReplayRequest } from "./replay.js";
import type { AgUiAuthorization, AgUiRunReference } from "./types.js";

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" };

export interface AgUiAuthorizationInput {
  readonly request: Request;
  readonly threadId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

export interface AgUiRunResolutionRequest<Authorization> extends AgUiReplayRequest<Authorization> {}

export interface CreateAgUiHandlerOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  /** Called only after official input parsing. Return false to hide the selected thread/run. */
  readonly authorize: (input: AgUiAuthorizationInput) => Authorization | false | Promise<Authorization | false>;
  /** Host-selected session; client input never selects tools, state, or capabilities. */
  readonly sessionFactory: (input: { readonly threadId: string; readonly authorization: Authorization; readonly signal: AbortSignal }) => AgentSession | Promise<AgentSession>;
  readonly lifecycle?: AgentRunLifecycle;
  /** Required for durable AG-UI resume; binds protocol selectors to internal checkpoint IDs. */
  readonly resolveRun?: (input: AgUiRunResolutionRequest<Authorization>) => AgUiRunReference | undefined | Promise<AgUiRunReference | undefined>;
  /** Optional durable event-page adapter used only when `?cursor=` is supplied. */
  readonly replay?: AgUiReplay<Authorization>;
  /** Persist this host correlation before the interrupt becomes visible to the client. */
  readonly onSuspended?: (input: { readonly threadId: string; readonly runId: string; readonly run: AgUiRunReference; readonly version: number; readonly authorization: Authorization; readonly signal: AbortSignal }) => void | Promise<void>;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
}

/** Framework-free, host-authorized AG-UI Web handler. */
export function createAgUiHandler<Authorization extends AgUiAuthorization = AgUiAuthorization>(options: CreateAgUiHandlerOptions<Authorization>): (request: Request) => Promise<Response> {
  const limits = resolveAgUiLimits(options.limits);
  return async (request) => {
    const owned = requestSignal(request, limits.requestTimeoutMs);
    try {
      if (request.method !== "POST") return complete(owned, failure(405, "ERR_PRISM_AG_UI_METHOD", "Method not allowed"));
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return complete(owned, failure(415, "ERR_PRISM_AG_UI_CONTENT_TYPE", "Content-Type must be application/json"));
      const input = parseAgUiInput(await readJson(request, limits.maxRequestBytes, owned.signal), limits);
      const authorization = await options.authorize({ request, threadId: input.threadId, runId: input.parentRunId ?? input.runId, signal: owned.signal });
      if (!authorization) return complete(owned, failure(403, "ERR_PRISM_AG_UI_FORBIDDEN", "Forbidden"));

      if (input.resume.length > 0) return sse(await resumeSource(input, authorization, options, limits, owned.signal), owned, limits);
      const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
      if (cursor !== undefined) {
        if (!options.replay) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay is not configured");
        return sse(replaySource(input, cursor, authorization, options, limits, owned.signal), owned, limits);
      }
      if (input.userText === undefined) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "A user message is required");
      return sse(startSource(input, authorization, options, limits, owned.signal), owned, limits);
    } catch (error) {
      owned.dispose();
      return errorResponse(error);
    }
  };
}

async function* startSource<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  const session = await options.sessionFactory({ threadId: input.threadId, authorization, signal });
  yield* mapped(session.stream(input.userText!, {
    ownership: authorization.ownership,
    redactor: options.redactor,
    signal,
    maxQueuedEvents: limits.maxQueuedEvents,
    overflow: "close",
  }), input, authorization, options, limits, signal);
}

async function resumeSource<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): Promise<AsyncIterable<AGUIEvent>> {
  if (!options.lifecycle || !options.resolveRun) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Durable resume is not configured");
  const protocolRunId = input.parentRunId ?? input.runId;
  const run = await resolveRun(options.resolveRun, { threadId: input.threadId, runId: protocolRunId, authorization, signal });
  const status = await options.lifecycle.status(run.ref, { ownership: authorization.ownership, agentId: run.agentId, signal });
  const entry = input.resume.length === 1 ? input.resume[0]! : undefined;
  if (!entry || status.state.status !== "suspended" || entry.interruptId !== interruptId(protocolRunId, status.version)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume does not match the pending interrupt");
  }
  const decision = resumeDecision(entry);
  return mapped(options.lifecycle.resumeStream(run.ref, { decision, expectedVersion: status.version }, {
    ownership: authorization.ownership,
    agentId: run.agentId,
    signal,
    maxQueuedEvents: limits.maxQueuedEvents,
    overflow: "close",
  }), input, authorization, options, limits, signal);
}

async function* replaySource<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  cursor: string,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  const page = await options.replay!.page({ threadId: input.threadId, runId: input.runId, cursor, authorization, signal });
  const mapper = mapperFor(input, options, limits);
  for (const record of page.records) {
    for (const event of mapper.map(record.event)) yield tagged(event, record.id);
    if (record.event.type === "agent_suspended") {
      yield interruptEvent(input, record.event, options.redactor);
      return;
    }
  }
  if (page.nextCursor) {
    yield event({ type: EventType.CUSTOM, name: "prism.replay_cursor", value: { cursor: page.nextCursor } });
    return;
  }
  if (page.terminal) return;
  const session = await options.sessionFactory({ threadId: input.threadId, authorization, signal });
  if (session.id !== page.run.ref.sessionId) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay session mismatch");
  yield* mapped(filterRun(session.subscribe({ maxQueuedEvents: limits.maxQueuedEvents, overflow: "close" }), page.run.ref.runId), input, authorization, options, limits, signal);
}

async function* mapped<Authorization extends AgUiAuthorization>(
  source: AsyncIterable<AgentEvent>,
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  const mapper = mapperFor(input, options, limits);
  for await (const prismEvent of source) {
    yield* mapper.map(prismEvent);
    if (prismEvent.type === "agent_suspended") {
      const run = { ref: { runId: prismEvent.runId, sessionId: prismEvent.sessionId } };
      await options.onSuspended?.({ threadId: input.threadId, runId: input.runId, run, version: prismEvent.version, authorization, signal });
      yield interruptEvent(input, prismEvent, options.redactor);
      return;
    }
  }
}

function mapperFor<Authorization extends AgUiAuthorization>(input: ParsedAgUiInput, options: CreateAgUiHandlerOptions<Authorization>, limits: ResolvedAgUiLimits) {
  const mapperOptions: AgUiEventMapperOptions = {
    redactor: options.redactor,
    projection: options.projection,
    limits,
    threadId: () => input.threadId,
    runId: () => input.runId,
  };
  return createAgUiEventMapper(mapperOptions);
}

async function* filterRun(source: AsyncIterable<AgentEvent>, runId: string): AsyncGenerator<AgentEvent> {
  for await (const event of source) {
    if (!("runId" in event) || event.runId !== runId) continue;
    yield event;
    if (event.type === "agent_finished" || event.type === "agent_denied" || event.type === "error") return;
  }
}

async function resolveRun<Authorization extends AgUiAuthorization>(
  resolve: (input: AgUiRunResolutionRequest<Authorization>) => AgUiRunReference | undefined | Promise<AgUiRunReference | undefined>,
  input: AgUiRunResolutionRequest<Authorization>,
): Promise<AgUiRunReference> {
  const run = await resolve(input);
  if (!run) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Run is unavailable");
  return run;
}

function resumeDecision(entry: { readonly status: string; readonly payload?: unknown }): "approve" | "deny" {
  if (entry.status === "cancelled") return "deny";
  const payload = entry.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || !((payload as { decision?: unknown }).decision === "approve" || (payload as { decision?: unknown }).decision === "deny")) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  return (payload as { decision: "approve" | "deny" }).decision;
}

function interruptEvent(input: ParsedAgUiInput, eventValue: Extract<AgentEvent, { readonly type: "agent_suspended" }>, redactor?: SecretRedactor): AGUIEvent {
  const interruption = redactor?.redact(eventValue.interruption) ?? eventValue.interruption;
  return event({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: {
      type: "interrupt",
      interrupts: [{
        id: interruptId(input.parentRunId ?? input.runId, eventValue.version),
        reason: boundedText(interruption.reason, 8 * 1024),
        message: boundedText(interruption.reason, 8 * 1024),
        ...(interruption.toolCallId ? { toolCallId: interruption.toolCallId } : {}),
        responseSchema: { type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { enum: ["approve", "deny"] } } },
      }],
    },
  });
}

function interruptId(runId: string, version: number): string {
  return `${runId}:${version}`;
}

function event(value: unknown): AGUIEvent {
  const parsed = EventSchemas.safeParse(value);
  if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Invalid AG-UI event");
  return parsed.data;
}

function tagged(value: AGUIEvent, id: string): AGUIEvent {
  return event({ ...value, prismEventId: id });
}

function sse(source: AsyncIterable<AGUIEvent>, owned: ReturnType<typeof requestSignal>, limits: ResolvedAgUiLimits): Response {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let count = 0;
  let bytes = 0;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    owned.dispose();
    await iterator.return?.();
  };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          await finish();
          controller.close();
          return;
        }
        const chunk = encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`);
        count += 1;
        bytes += chunk.byteLength;
        if (chunk.byteLength > limits.maxEventBytes || count > limits.maxStreamEvents || bytes > limits.maxStreamBytes) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event({ type: EventType.RUN_ERROR, message: "AG-UI stream limit exceeded", code: "ERR_PRISM_AG_UI_LIMIT" }))}\n\n`));
          await finish();
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event({ type: EventType.RUN_ERROR, message: "AG-UI stream failed", code: "ERR_PRISM_AG_UI_STREAM" }))}\n\n`));
        await finish();
        controller.close();
      }
    },
    cancel: finish,
  }), { status: 200, headers: SSE_HEADERS });
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
      if (bytes > maxBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Request exceeds maxRequestBytes");
      chunks.push(next.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    if (error instanceof AgUiError) throw error;
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid JSON request body");
  } finally {
    reader.releaseLock();
  }
}

function requestSignal(request: Request, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason ?? new Error("request aborted"));
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
  return { signal: controller.signal, dispose() { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); } };
}

function errorResponse(error: unknown): Response {
  const known = error instanceof AgUiError;
  const status = known && error.code === "ERR_PRISM_AG_UI_FORBIDDEN" ? 403
    : known && error.code === "ERR_PRISM_AG_UI_LIMIT" ? 413
      : known ? 400 : 500;
  const code = known ? error.code : "ERR_PRISM_AG_UI_INTERNAL";
  const message = known ? error.message : "Internal server error";
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function complete(owned: ReturnType<typeof requestSignal>, response: Response): Response {
  owned.dispose();
  return response;
}

function boundedText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
