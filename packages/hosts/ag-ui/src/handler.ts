import { type AGUIEvent, type AgentCapabilities, AgentCapabilitiesSchema, EventSchemas, EventType, type Interrupt } from "@ag-ui/core";
import {
  type Agent,
  type AgentEvent,
  type ApprovalOutcome,
  type Decision,
  isSessionNotFound,
  type Message,
  type OwnershipScope,
  type PendingDecision,
  type SecretRedactor,
  type Session,
} from "@arnilo/prism";
import type { McpToolBridge } from "@arnilo/prism-mcp";
import type { AgUiA2UiOptions } from "./a2ui.js";
import { type AgUiEventMapperOptions, createAgUiEventMapper } from "./ag-ui-mapper.js";
import { AgUiError } from "./errors.js";
import { assertBoundedJson, defaultAgUiInput, type ParsedAgUiInput, parseAgUiInput } from "./input.js";
import { type AgUiLimitOptions, type ResolvedAgUiLimits, resolveAgUiLimits } from "./limits.js";
import type { AgUiProjection } from "./projection.js";
import type { CoWorkReplay } from "./replay.js";
import type { AgUiAuthorization, CoWorkContext } from "./types.js";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

/** Resume-boundary caps mirroring the kernel's hard decision limits (`HARD_MAX_*`). */
const MAX_RESUME_DECISIONS = 128;
const MAX_RESUME_PAYLOAD_BYTES = 64 * 1024;
const APPROVAL_OUTCOMES: ReadonlySet<string> = new Set(["allow_once", "allow_for_run", "reject_once", "reject_for_run"]);

interface PendingInterrupt {
  readonly threadId: string;
  readonly approvalId: string;
  readonly ownership?: OwnershipScope;
}

export interface AgUiAuthorizationInput {
  readonly request: Request;
  readonly threadId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

/** Host-approved client tool declaration. It is never converted to a Prism ToolDefinition by this adapter. */
export interface AgUiFrontendToolHandoff {
  readonly name: string;
  readonly execution: "client";
}

export interface AgUiFrontendToolPolicyInput<Authorization> {
  readonly request: ParsedAgUiInput;
  readonly authorization: Authorization;
  readonly signal: AbortSignal;
}

export interface AgUiInputProjection {
  /** Host-selected Prism input. Preserve message/tool-result IDs in `Message.id`/content when continuing a client tool. */
  readonly messages: string | Message | readonly Message[];
  /** Host-selected client-side tool handoff list. Names must be a subset of request tools. */
  readonly frontendTools?: readonly AgUiFrontendToolHandoff[];
}

export interface AgUiInputProjectorInput<Authorization> extends AgUiFrontendToolPolicyInput<Authorization> {
  readonly frontendTools: readonly AgUiFrontendToolHandoff[];
  /** Present only when `a2ui` is configured; actions remain untrusted until the host accepts them. */
  readonly a2uiActions?: readonly import("./a2ui.js").AgUiA2UiAction[];
}

/** Optional full-input adapter. Omit it to keep legacy last-text/default-deny behavior. */
export interface AgUiInputOptions<Authorization> {
  readonly project?: (
    input: AgUiInputProjectorInput<Authorization>,
  ) => AgUiInputProjection | undefined | Promise<AgUiInputProjection | undefined>;
  /** Explicitly accepts client-side tool handoffs; omitted means all frontend tools are denied. */
  readonly frontendTools?: (
    input: AgUiFrontendToolPolicyInput<Authorization>,
  ) => readonly AgUiFrontendToolHandoff[] | undefined | Promise<readonly AgUiFrontendToolHandoff[] | undefined>;
}

/** Who owns the two client-supplied fields a browser must never decide: its `state` projection and its `tools` list. */
export interface AgUiInputPolicyOptions {
  /**
   * `"honor"` keeps today's behavior: the validated `state`/`tools` reach `input.project`. `"ignore"` validates the same
   * envelope for shape and bounds, then discards both fields, so input comes only from the server session and projector.
   */
  readonly clientState: "honor" | "ignore";
}

export interface AgUiPreparedInput {
  readonly messages: string | Message | readonly Message[];
  readonly frontendTools: readonly AgUiFrontendToolHandoff[];
  /** Host-reviewed remote MCP tools. `sessionFactory` decides how to combine them with local tools. */
  readonly serverTools: readonly McpToolBridge["tools"][number][];
  /** `"ignore"` means client-supplied `state`/`tools` were validated then discarded before this payload was built. */
  readonly clientState: "honor" | "ignore";
}

export interface AgUiHandler {
  (request: Request): Promise<Response>;
  /** Schema-validated snapshot; unsupported transports are never advertised. */
  readonly capabilities: AgentCapabilities;
}

export interface CreateAgUiHandlerOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  /** Per-request gate. Omitted (or returning false) denies the request before any session is opened. */
  readonly authorize?: (input: AgUiAuthorizationInput) => Authorization | false | Promise<Authorization | false>;
  /** Host capability declaration, narrowed to implemented handler/projector features. */
  readonly capabilities?: AgentCapabilities;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  /** Opt-in A2UI painting middleware. Absent keeps byte-identical behavior. */
  readonly a2ui?: AgUiA2UiOptions;
  /** Resolves thread/artifact/identity co-work context from an authorized request. */
  readonly coWorkContext?: (input: ParsedAgUiInput, authorization: Authorization) => CoWorkContext | undefined;
  /** Optional durable co-work source; one bounded page is projected after the run stream. */
  readonly coWork?: CoWorkReplay<Authorization>;
  readonly limits?: AgUiLimitOptions;
}

/**
 * Framework-free, host-authorized AG-UI Web handler over one Prism `Agent`.
 * A request's `threadId` selects the session; a suspended run ends in an AG-UI interrupt
 * that a later `resume` request continues through `session.resume`.
 */
export function createAgUiHandler<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  agent: Agent,
  options: CreateAgUiHandlerOptions<Authorization> = {},
): AgUiHandler {
  const limits = resolveAgUiLimits(options.limits);
  const capabilities = resolveAgUiCapabilities(options);
  /** interruptId → the pending decision it stands for, scoped to its thread and owning scope. */
  const pending = new Map<string, PendingInterrupt>();
  const handler = async (request: Request): Promise<Response> => {
    const owned = requestSignal(request, limits.requestTimeoutMs);
    try {
      if (request.method !== "POST") return complete(owned, failure(405, "ERR_PRISM_AG_UI_METHOD", "Method not allowed"));
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return complete(owned, failure(415, "ERR_PRISM_AG_UI_CONTENT_TYPE", "Content-Type must be application/json"));
      }
      const parsed = parseAgUiInput(await readJson(request, limits.maxRequestBytes, owned.signal), limits);
      const authorization = await options.authorize?.({
        request,
        threadId: parsed.threadId,
        runId: parsed.parentRunId ?? parsed.runId,
        signal: owned.signal,
      });
      if (!authorization) return complete(owned, failure(403, "ERR_PRISM_AG_UI_FORBIDDEN", "Forbidden"));
      if (parsed.resume.length > 0) {
        // Resolve the resume batch before the stream opens, so a foreign or malformed interrupt is a 400, not an SSE error.
        const decisions = readResumeDecisions(parsed, authorization.ownership, pending);
        return sse(
          withCoWork(
            await resumeSource(agent, parsed, decisions, authorization, options, limits, owned.signal, pending),
            parsed,
            authorization,
            options,
            limits,
            owned.signal,
          ),
          owned,
          limits,
        );
      }
      return sse(
        withCoWork(
          await runSource(agent, parsed, authorization, options, limits, owned.signal, pending),
          parsed,
          authorization,
          options,
          limits,
          owned.signal,
        ),
        owned,
        limits,
      );
    } catch (error) {
      owned.dispose();
      return errorResponse(error);
    }
  };
  return Object.assign(handler, { capabilities });
}

/** Creates the validated declaration attached to every handler. */
export function resolveAgUiCapabilities<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  options: Pick<CreateAgUiHandlerOptions<Authorization>, "capabilities" | "projection">,
): AgentCapabilities {
  const parsed = AgentCapabilitiesSchema.safeParse(options.capabilities ?? {});
  if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid AG-UI capability declaration");
  const requested = parsed.data;
  if (requested.transport?.websocket || requested.transport?.httpBinary || requested.transport?.pushNotifications) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Unsupported AG-UI transport was declared");
  }
  if (requested.state?.snapshots && !options.projection?.state && !options.projection?.stateSnapshot) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "state snapshots require a state projector");
  }
  if (requested.state?.deltas && !options.projection?.stateDelta) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "state deltas require projection.stateDelta");
  }
  if (
    (requested.reasoning?.supported || requested.reasoning?.streaming || requested.reasoning?.encrypted) &&
    !options.projection?.reasoning
  ) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "reasoning capability requires projection.reasoning");
  }
  return AgentCapabilitiesSchema.parse({
    ...requested,
    transport: { ...requested.transport, streaming: true, resumable: false },
    state:
      requested.state || options.projection?.state || options.projection?.stateSnapshot || options.projection?.stateDelta
        ? {
            ...requested.state,
            snapshots: requested.state?.snapshots ?? Boolean(options.projection?.state || options.projection?.stateSnapshot),
            deltas: requested.state?.deltas ?? Boolean(options.projection?.stateDelta),
          }
        : undefined,
    reasoning:
      requested.reasoning || options.projection?.reasoning
        ? {
            ...requested.reasoning,
            supported: requested.reasoning?.supported ?? Boolean(options.projection?.reasoning),
            streaming: requested.reasoning?.streaming ?? Boolean(options.projection?.reasoning),
          }
        : undefined,
    // Approvals are the handler's run driver: a suspended run always ends in an interrupt.
    humanInTheLoop: {
      ...requested.humanInTheLoop,
      supported: true,
      approvals: true,
      interrupts: true,
      approveWithEdits: requested.humanInTheLoop?.approveWithEdits ?? false,
    },
  });
}

async function runSource<Authorization extends AgUiAuthorization>(
  agent: Agent,
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
  pending: Map<string, PendingInterrupt>,
): Promise<AsyncGenerator<AGUIEvent>> {
  const prompt = defaultAgUiInput(input, limits);
  const session = await agent.session({
    id: input.threadId,
    create: true,
    ownership: authorization.ownership,
  });
  return mapped(
    session.stream(prompt, {
      ownership: authorization.ownership,
      redactor: options.redactor,
      signal,
      interactive: false,
      maxQueuedEvents: limits.maxQueuedEvents,
      overflow: "close",
    }),
    session,
    input,
    authorization,
    options,
    limits,
    signal,
    pending,
  );
}

async function resumeSource<Authorization extends AgUiAuthorization>(
  agent: Agent,
  input: ParsedAgUiInput,
  decisions: readonly Decision[],
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
  pending: Map<string, PendingInterrupt>,
): Promise<AsyncGenerator<AGUIEvent>> {
  const session = await agent.session({
    id: input.threadId,
    ownership: authorization.ownership,
  });
  return mapped(
    session.resume(decisions, {
      ownership: authorization.ownership,
      redactor: options.redactor,
      signal,
    }),
    session,
    input,
    authorization,
    options,
    limits,
    signal,
    pending,
  );
}

/** One `ResumeEntry` per interrupt; an unknown or foreign id fails before any session resume. */
function readResumeDecisions(
  input: ParsedAgUiInput,
  ownership: OwnershipScope | undefined,
  pending: Map<string, PendingInterrupt>,
): readonly Decision[] {
  const decisions: Decision[] = [];
  const seen = new Set<string>();
  for (const entry of input.resume) {
    if (entry.status !== "resolved" && entry.status !== "cancelled") {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume status is invalid");
    }
    const record = pending.get(entry.interruptId);
    if (
      !record ||
      record.threadId !== input.threadId ||
      !sameOwnership(record.ownership, ownership) ||
      seen.has(entry.interruptId)
    ) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume does not match the pending interrupt");
    }
    seen.add(entry.interruptId);
    if (entry.status === "cancelled") {
      decisions.push({ approvalId: record.approvalId, outcome: "reject_once" });
      continue;
    }
    decisions.push({ approvalId: record.approvalId, outcome: readResumeOutcome(entry.payload) });
  }
  if (decisions.length === 0 || decisions.length > MAX_RESUME_DECISIONS) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decisions must be a non-empty bounded array");
  }
  return decisions;
}

/** A resolved payload is exactly `{ outcome: ApprovalOutcome }`. */
function readResumeOutcome(payload: unknown): ApprovalOutcome {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  const row = payload as Record<string, unknown>;
  const keys = Object.keys(row);
  const text = JSON.stringify(row);
  if (keys.length !== 1 || keys[0] !== "outcome" || text === undefined || Buffer.byteLength(text, "utf8") > MAX_RESUME_PAYLOAD_BYTES) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  if (typeof row.outcome !== "string" || !APPROVAL_OUTCOMES.has(row.outcome)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  return row.outcome as ApprovalOutcome;
}

async function* mapped<Authorization extends AgUiAuthorization>(
  source: AsyncIterable<AgentEvent>,
  session: Session,
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
  pending: Map<string, PendingInterrupt>,
): AsyncGenerator<AGUIEvent> {
  const mapper = mapperFor(input, options, limits);
  const onAbort = () => session.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  // A consumer that stops early (client disconnect) aborts the run; a suspension is a clean end.
  let settled = false;
  try {
    for await (const prismEvent of source) {
      yield* await mapper.map(prismEvent);
      if (prismEvent.type === "run.suspended") {
        yield interruptEvent(input, authorization.ownership, prismEvent, options, limits, pending);
        settled = true;
        return;
      }
    }
    settled = true;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!settled) session.abort();
  }
}

function mapperFor<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
) {
  const mapperOptions: AgUiEventMapperOptions = {
    redactor: options.redactor,
    projection: options.projection,
    limits,
    a2ui: options.a2ui,
    threadId: () => input.threadId,
    runId: () => input.runId,
  };
  return createAgUiEventMapper(mapperOptions);
}

/** Appends one bounded, redacted co-work page after the run stream. */
async function* withCoWork<Authorization extends AgUiAuthorization>(
  base: AsyncIterable<AGUIEvent>,
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  yield* base;
  if (!options.coWork) return;
  const context = options.coWorkContext?.(input, authorization) ?? { threadId: input.threadId };
  const mapper = mapperFor(input, options, limits);
  const page = await options.coWork.page({ context, authorization, signal });
  for (const event of page.events) yield* await mapper.mapCoWork(event);
}

/** One interrupt per pending decision; each carries the approval id, tool call, and redacted reason. */
function interruptEvent<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  ownership: OwnershipScope | undefined,
  eventValue: Extract<AgentEvent, { readonly type: "run.suspended" }>,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  pending: Map<string, PendingInterrupt>,
): AGUIEvent {
  const interruption = options.redactor?.redact(eventValue.interruption) ?? eventValue.interruption;
  const decisions: readonly PendingDecision[] =
    interruption.pendingDecisions ??
    (interruption.toolCallId || interruption.toolName
      ? [
          {
            approvalId: eventValue.runId,
            kind: interruption.kind === "elicitation" ? "elicitation" : "tool_approval",
            toolCallId: interruption.toolCallId,
            scope: interruption.toolName ? { toolName: interruption.toolName } : {},
            reason: interruption.reason,
          },
        ]
      : []);
  if (decisions.length === 0 || decisions.length > limits.maxInputInterrupts) {
    throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Suspension carried no usable pending decisions");
  }
  const interrupts: readonly Interrupt[] = decisions.map((decision, index) => {
    const id = `${eventValue.runId}:${eventValue.version}:${index}`;
    pending.set(id, {
      threadId: input.threadId,
      approvalId: decision.approvalId,
      ownership: cloneOwnership(ownership),
    });
    const reason = boundedText(decision.reason || interruption.reason, limits.maxErrorBytes);
    return {
      id,
      reason,
      message: reason,
      ...(decision.toolCallId ? { toolCallId: decision.toolCallId } : {}),
      metadata: {
        approvalId: decision.approvalId,
        kind: decision.kind,
        ...(decision.scope.toolName ? { toolName: decision.scope.toolName } : {}),
      },
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: ["outcome"],
        properties: { outcome: { enum: ["allow_once", "allow_for_run", "reject_once", "reject_for_run"] } },
      },
    };
  });
  assertBoundedJson(interrupts, limits.maxStateBytes, limits, "interrupts");
  return event({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: { type: "interrupt", interrupts },
  });
}

function cloneOwnership(ownership: OwnershipScope | undefined): OwnershipScope | undefined {
  if (!ownership) return undefined;
  return {
    ...(ownership.tenantId !== undefined ? { tenantId: ownership.tenantId } : {}),
    ...(ownership.accountId !== undefined ? { accountId: ownership.accountId } : {}),
    ...(ownership.userId !== undefined ? { userId: ownership.userId } : {}),
  };
}

function sameOwnership(a: OwnershipScope | undefined, b: OwnershipScope | undefined): boolean {
  return a?.tenantId === b?.tenantId && a?.accountId === b?.accountId && a?.userId === b?.userId;
}

function event(value: unknown): AGUIEvent {
  const parsed = EventSchemas.safeParse(value);
  if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Invalid AG-UI event");
  return parsed.data;
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
  return new Response(
    new ReadableStream<Uint8Array>({
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
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(event({ type: EventType.RUN_ERROR, message: "AG-UI stream limit exceeded", code: "ERR_PRISM_AG_UI_LIMIT" }))}\n\n`,
              ),
            );
            await finish();
            controller.close();
            return;
          }
          controller.enqueue(chunk);
        } catch {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(event({ type: EventType.RUN_ERROR, message: "AG-UI stream failed", code: "ERR_PRISM_AG_UI_STREAM" }))}\n\n`,
            ),
          );
          await finish();
          controller.close();
        }
      },
      cancel: finish,
    }),
    { status: 200, headers: SSE_HEADERS },
  );
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
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
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
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    },
  };
}

function isOwnershipScopeError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "ERR_PRISM_OWNERSHIP_WIDEN";
}

function errorResponse(error: unknown): Response {
  if (isSessionNotFound(error) || isOwnershipScopeError(error)) {
    return failure(404, "ERR_PRISM_AG_UI_NOT_FOUND", "Session not found");
  }
  const known = error instanceof AgUiError;
  const status =
    known && error.code === "ERR_PRISM_AG_UI_FORBIDDEN"
      ? 403
      : known && error.code === "ERR_PRISM_AG_UI_NOT_FOUND"
        ? 404
        : known && error.code === "ERR_PRISM_AG_UI_LIMIT"
          ? 413
          : known
            ? 400
            : 500;
  const code = known ? error.code : "ERR_PRISM_AG_UI_INTERNAL";
  const message = known ? error.message : "Internal server error";
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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
