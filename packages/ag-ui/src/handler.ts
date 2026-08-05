import { type AGUIEvent, type AgentCapabilities, AgentCapabilitiesSchema, EventSchemas, EventType, type Interrupt } from "@ag-ui/core";
import { HARD_MAX_DECISION_REASON_BYTES, HARD_MAX_ELICITATION_BYTES, HARD_MAX_PENDING_DECISIONS } from "@arnilo/prism";
import type {
  AgentEvent,
  AgentRunLifecycle,
  AgentRunStatusResult,
  AgentSession,
  Message,
  RunDecision,
  SecretRedactor,
} from "@arnilo/prism";
import { type AgUiA2UiAction, type AgUiA2UiOptions, extractAgUiA2UiActions } from "./a2ui.js";
import { type AgUiEventMapperOptions, createAgUiEventMapper } from "./ag-ui-mapper.js";
import type { AgUiA2AAdapter } from "./a2a.js";
import { AgUiError } from "./errors.js";
import type { AgUiMcpAdapter } from "./mcp.js";
import { assertBoundedJson, defaultAgUiInput, type ParsedAgUiInput, parseAgUiInput } from "./input.js";
import { type AgUiLimitOptions, type ResolvedAgUiLimits, resolveAgUiLimits } from "./limits.js";
import type { AgUiProjection } from "./projection.js";
import type { AgUiReplay, AgUiReplayRequest, CoWorkReplay } from "./replay.js";
import type { AgUiAuthorization, AgUiRunReference, CoWorkContext } from "./types.js";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

export interface AgUiAuthorizationInput {
  readonly request: Request;
  readonly threadId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

export interface AgUiRunResolutionRequest<Authorization> extends AgUiReplayRequest<Authorization> {}

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
  readonly a2uiActions?: readonly AgUiA2UiAction[];
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

export interface AgUiPreparedInput {
  readonly messages: string | Message | readonly Message[];
  readonly frontendTools: readonly AgUiFrontendToolHandoff[];
  /** Host-reviewed remote MCP tools. `sessionFactory` decides how to combine them with local tools. */
  readonly serverTools: readonly import("@arnilo/prism").ToolDefinition[];
}

export interface AgUiInterruptResume<Authorization> {
  readonly request: ParsedAgUiInput;
  readonly authorization: Authorization;
  readonly run: AgUiRunReference;
  readonly status: AgentRunStatusResult;
  readonly expectedInterruptId: string;
  readonly signal: AbortSignal;
}

/** Host policy for an aggregate AG-UI interrupt. It must resolve to core's one CAS-protected decision. */
export interface AgUiInterruptOptions<Authorization> {
  readonly resume?: (input: AgUiInterruptResume<Authorization>) => AgUiInterruptResolution | Promise<AgUiInterruptResolution>;
}

/** Legacy binary resolution or a batch of shared run decisions with parity to core. */
export type AgUiInterruptResolution =
  | { readonly decision: "approve" | "deny"; readonly expectedVersion?: number }
  | { readonly decisions: readonly RunDecision[]; readonly expectedVersion?: number };

export interface AgUiHandler {
  (request: Request): Promise<Response>;
  /** Schema-validated snapshot; unsupported transports and edit approvals are never advertised. */
  readonly capabilities: AgentCapabilities;
}

export interface CreateAgUiHandlerOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  /** Called only after official input parsing. Return false to hide the selected thread/run. */
  readonly authorize: (input: AgUiAuthorizationInput) => Authorization | false | Promise<Authorization | false>;
  /** Host-selected session; client input never selects tools, state, identity, ownership, or capabilities. */
  readonly sessionFactory: (input: {
    readonly threadId: string;
    readonly authorization: Authorization;
    readonly signal: AbortSignal;
    readonly input: AgUiPreparedInput;
  }) => AgentSession | Promise<AgentSession>;
  readonly lifecycle?: AgentRunLifecycle;
  /** Required for durable AG-UI resume; binds protocol selectors to internal checkpoint IDs. */
  readonly resolveRun?: (
    input: AgUiRunResolutionRequest<Authorization>,
  ) => AgUiRunReference | undefined | Promise<AgUiRunReference | undefined>;
  /** Optional durable event-page adapter used only when `?cursor=` is supplied. */
  readonly replay?: AgUiReplay<Authorization>;
  /** Explicit full-input policy. Omit it to preserve the text-only/default-deny boundary. */
  readonly input?: AgUiInputOptions<Authorization>;
  /** Optional reviewed MCP bridge adapter. Its selected tools are passed only to `sessionFactory`. */
  readonly mcp?: AgUiMcpAdapter<Authorization>;
  /** Optional verified remote A2A mode. When configured it replaces local `sessionFactory` only for this handler. */
  readonly a2a?: AgUiA2AAdapter<Authorization>;
  /** Optional multiple-interrupt resolver; edits always deny because core cannot mutate a persisted call. */
  readonly interrupts?: AgUiInterruptOptions<Authorization>;
  /** Host capability declaration, narrowed to implemented handler/projector features. */
  readonly capabilities?: AgentCapabilities;
  /** Persist this host correlation before the interrupt becomes visible to the client. */
  readonly onSuspended?: (input: {
    readonly threadId: string;
    readonly runId: string;
    readonly run: AgUiRunReference;
    readonly version: number;
    readonly authorization: Authorization;
    readonly signal: AbortSignal;
  }) => void | Promise<void>;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  /** Opt-in A2UI painting middleware. Absent keeps 0.0.24 byte-identical behavior. */
  readonly a2ui?: AgUiA2UiOptions;
  readonly limits?: AgUiLimitOptions;
  /** Resolves thread/artifact/identity co-work context from an authorized request. */
  readonly coWorkContext?: (input: ParsedAgUiInput, authorization: Authorization) => CoWorkContext | undefined;
  /** Optional durable co-work source; one bounded page is projected after the run stream. */
  readonly coWork?: CoWorkReplay<Authorization>;
}

/** Framework-free, host-authorized AG-UI Web handler. */
export function createAgUiHandler<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  options: CreateAgUiHandlerOptions<Authorization>,
): AgUiHandler {
  const limits = resolveAgUiLimits(options.limits);
  const capabilities = resolveAgUiCapabilities(options);
  const handler = async (request: Request): Promise<Response> => {
    const owned = requestSignal(request, limits.requestTimeoutMs);
    try {
      if (request.method !== "POST") return complete(owned, failure(405, "ERR_PRISM_AG_UI_METHOD", "Method not allowed"));
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return complete(owned, failure(415, "ERR_PRISM_AG_UI_CONTENT_TYPE", "Content-Type must be application/json"));
      }
      const input = parseAgUiInput(await readJson(request, limits.maxRequestBytes, owned.signal), limits);
      // Preserve the legacy boundary: unsupported state/tools fail before authorization/session lookup.
      if (!options.input?.project && input.resume.length === 0 && new URL(request.url).searchParams.get("cursor") === null) {
        defaultAgUiInput(input, limits);
      }
      const authorization = await options.authorize({
        request,
        threadId: input.threadId,
        runId: input.parentRunId ?? input.runId,
        signal: owned.signal,
      });
      if (!authorization) return complete(owned, failure(403, "ERR_PRISM_AG_UI_FORBIDDEN", "Forbidden"));

      if (input.resume.length > 0) {
        return sse(
          withCoWork(
            await resumeSource(input, authorization, options, limits, owned.signal),
            input,
            authorization,
            options,
            limits,
            owned.signal,
          ),
          owned,
          limits,
        );
      }
      const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
      if (cursor !== undefined) {
        if (!options.replay) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay is not configured");
        return sse(
          withCoWork(
            replaySource(input, cursor, authorization, options, limits, owned.signal),
            input,
            authorization,
            options,
            limits,
            owned.signal,
          ),
          owned,
          limits,
        );
      }
      const prepared = await prepareInput(input, authorization, options, limits, owned.signal);
      return sse(
        withCoWork(
          startSource(input, prepared, authorization, options, limits, owned.signal),
          input,
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
  options: Pick<
    CreateAgUiHandlerOptions<Authorization>,
    "capabilities" | "input" | "interrupts" | "lifecycle" | "projection" | "replay" | "resolveRun"
  >,
): AgentCapabilities {
  const parsed = AgentCapabilitiesSchema.safeParse(options.capabilities ?? {});
  if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid AG-UI capability declaration");
  const requested = parsed.data;
  if (requested.transport?.websocket || requested.transport?.httpBinary || requested.transport?.pushNotifications) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Unsupported AG-UI transport was declared");
  }
  if (requested.transport?.resumable && !options.replay) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "resumable requires replay");
  if (requested.tools?.clientProvided && !options.input?.frontendTools) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "clientProvided tools require input.frontendTools");
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
  if (hasMultimodalInput(requested.multimodal) && !options.input?.project) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "multimodal input requires input.project");
  }
  if (requested.humanInTheLoop?.approveWithEdits) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "approveWithEdits is unsupported");
  }
  if (hasHitl(requested.humanInTheLoop) && (!options.lifecycle || !options.resolveRun)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "human-in-the-loop capability requires lifecycle and resolveRun");
  }
  return AgentCapabilitiesSchema.parse({
    ...requested,
    transport: { ...requested.transport, streaming: true, resumable: requested.transport?.resumable ?? Boolean(options.replay) },
    tools:
      requested.tools || options.input?.frontendTools
        ? { ...requested.tools, clientProvided: requested.tools?.clientProvided ?? Boolean(options.input?.frontendTools) }
        : undefined,
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
    humanInTheLoop:
      requested.humanInTheLoop || (options.lifecycle && options.resolveRun)
        ? {
            ...requested.humanInTheLoop,
            supported: requested.humanInTheLoop?.supported ?? Boolean(options.lifecycle && options.resolveRun),
            approvals: requested.humanInTheLoop?.approvals ?? Boolean(options.lifecycle && options.resolveRun),
            interrupts: requested.humanInTheLoop?.interrupts ?? Boolean(options.lifecycle && options.resolveRun),
            approveWithEdits: false,
          }
        : undefined,
  });
}

async function prepareInput<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): Promise<AgUiPreparedInput> {
  if (!options.input?.project)
    return {
      messages: defaultAgUiInput(input, limits),
      frontendTools: [],
      serverTools: await prepareMcpTools(input, authorization, options, limits, signal),
    };
  const policyInput = { request: input, authorization, signal };
  const frontendTools = input.tools.length === 0 ? [] : await options.input.frontendTools?.(policyInput);
  if (input.tools.length > 0 && !frontendTools) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Frontend tools are unavailable");
  const approved = validateFrontendTools(frontendTools ?? [], input, limits);
  const a2uiActions = options.a2ui ? extractAgUiA2UiActions(input, limits) : undefined;
  const projected = await options.input.project({
    ...policyInput,
    frontendTools: approved,
    ...(a2uiActions && a2uiActions.length > 0 ? { a2uiActions } : {}),
  });
  if (!projected) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Input is unavailable");
  assertBoundedJson(projected.messages, limits.maxInputTextBytes, limits, "projected messages");
  const selected = projected.frontendTools === undefined ? approved : validateFrontendTools(projected.frontendTools, input, limits);
  return {
    messages: projected.messages,
    frontendTools: selected,
    serverTools: await prepareMcpTools(input, authorization, options, limits, signal),
  };
}

async function prepareMcpTools<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): Promise<readonly import("@arnilo/prism").ToolDefinition[]> {
  if (options.a2a) return [];
  let tools: readonly import("@arnilo/prism").ToolDefinition[] = [];
  try {
    tools = (await options.mcp?.prepare({ request: input, authorization, signal, maxTools: limits.maxInputTools })) ?? [];
  } catch {
    throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "MCP tools are unavailable");
  }
  if (tools.length > limits.maxInputTools) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many MCP tools");
  return tools;
}

function validateFrontendTools(
  handoffs: readonly AgUiFrontendToolHandoff[],
  input: ParsedAgUiInput,
  limits: ResolvedAgUiLimits,
): readonly AgUiFrontendToolHandoff[] {
  if (handoffs.length > limits.maxInputTools) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many approved frontend tools");
  const available = new Set(input.tools.map((tool) => tool.name));
  const names = new Set<string>();
  for (const handoff of handoffs) {
    if (handoff?.execution !== "client" || typeof handoff.name !== "string" || !available.has(handoff.name) || names.has(handoff.name)) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid frontend tool handoff");
    }
    names.add(handoff.name);
  }
  return handoffs.map((handoff) => ({ name: handoff.name, execution: "client" }));
}

async function* startSource<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  prepared: AgUiPreparedInput,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  if (options.a2a) {
    yield* options.a2a.stream({ request: input, authorization, signal, threadId: input.threadId, runId: input.runId });
    return;
  }
  const session = await options.sessionFactory({ threadId: input.threadId, authorization, signal, input: prepared });
  yield* mapped(
    session.stream(prepared.messages, {
      ownership: authorization.ownership,
      redactor: options.redactor,
      signal,
      maxQueuedEvents: limits.maxQueuedEvents,
      overflow: "close",
    }),
    input,
    authorization,
    options,
    limits,
    signal,
  );
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
  if (status.state.status !== "suspended") throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume does not match the pending interrupt");
  const decision = await resumeDecision(input, authorization, run, status, protocolRunId, options, signal);
  return mapped(
    options.lifecycle.resumeStream(
      run.ref,
      { ...decision, expectedVersion: status.version },
      {
        ownership: authorization.ownership,
        agentId: run.agentId,
        signal,
        maxQueuedEvents: limits.maxQueuedEvents,
        overflow: "close",
      },
    ),
    input,
    authorization,
    options,
    limits,
    signal,
  );
}

async function resumeDecision<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  authorization: Authorization,
  run: AgUiRunReference,
  status: AgentRunStatusResult,
  protocolRunId: string,
  options: CreateAgUiHandlerOptions<Authorization>,
  signal: AbortSignal,
): Promise<{ readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] }> {
  const expectedInterruptId = interruptId(protocolRunId, status.version);
  if (hasEditedArgs(input.resume)) return { decision: "deny" };
  if (!options.interrupts?.resume) {
    const entry = input.resume.length === 1 ? input.resume[0] : undefined;
    if (!entry || entry.interruptId !== expectedInterruptId)
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume does not match the pending interrupt");
    return simpleResumeDecision(entry);
  }
  const resolved = await options.interrupts.resume({ request: input, authorization, run, status, expectedInterruptId, signal });
  if (!resolved || (resolved.expectedVersion !== undefined && resolved.expectedVersion !== status.version)) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Interrupt resolution is invalid");
  }
  if ("decisions" in resolved) return { decisions: readRunDecisions(resolved.decisions) };
  if (resolved.decision !== "approve" && resolved.decision !== "deny") {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Interrupt resolution is invalid");
  }
  return { decision: resolved.decision };
}

const RUN_DECISION_OUTCOMES = new Set(["allow_once", "allow_for_run", "reject_once", "reject_for_run"]);
const RUN_DECISION_KEYS = new Set(["approvalId", "outcome", "reason", "modifiedArguments", "elicitation"]);

/**
 * Boundary validation for a client-supplied decision batch: shape and hard caps only.
 * Core re-validates every entry against the recorded pending set under CAS.
 */
function readRunDecisions(value: unknown): readonly RunDecision[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > HARD_MAX_PENDING_DECISIONS) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decisions must be a non-empty bounded array");
  }
  return value.map((entry): RunDecision => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decision must be an object");
    }
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) => !RUN_DECISION_KEYS.has(key))) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decision has unknown keys");
    }
    if (typeof row.approvalId !== "string" || row.approvalId.length === 0 || row.approvalId.length > 128) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decision approvalId is invalid");
    }
    if (typeof row.outcome !== "string" || !RUN_DECISION_OUTCOMES.has(row.outcome)) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decision outcome is invalid");
    }
    if (
      row.reason !== undefined &&
      (typeof row.reason !== "string" || Buffer.byteLength(row.reason, "utf8") > HARD_MAX_DECISION_REASON_BYTES)
    ) {
      throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume decision reason exceeds limits");
    }
    for (const key of ["modifiedArguments", "elicitation"] as const) {
      const field = row[key];
      if (field === undefined) continue;
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `Resume decision ${key} must be an object`);
      }
      const text = JSON.stringify(field);
      if (text === undefined || Buffer.byteLength(text, "utf8") > HARD_MAX_ELICITATION_BYTES) {
        throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `Resume decision ${key} exceeds limits`);
      }
    }
    return entry as RunDecision;
  });
}

async function* replaySource<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  cursor: string,
  authorization: Authorization,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): AsyncGenerator<AGUIEvent> {
  const request = { threadId: input.threadId, runId: input.runId, cursor, authorization, signal };
  const mapper = mapperFor(input, options, limits);
  if (options.replay!.subscribe) {
    for await (const item of options.replay!.subscribe(request)) {
      const mappedEvents = mapper.map(item.record.event);
      if (mappedEvents.length === 0) {
        yield tagged(
          event({ type: EventType.CUSTOM, name: "prism.replay_cursor", value: { cursor: item.cursor } }),
          item.record.id,
          item.cursor,
        );
      } else {
        for (const mappedEvent of mappedEvents) yield tagged(mappedEvent, item.record.id, item.cursor);
      }
      if (item.record.event.type === "agent_suspended") {
        yield tagged(await interruptEvent(input, item.record.event, options, limits), item.record.id, item.cursor);
        return;
      }
    }
    return;
  }

  const page = await options.replay!.page(request);
  for (const record of page.records) {
    for (const mappedEvent of mapper.map(record.event)) yield tagged(mappedEvent, record.id);
    if (record.event.type === "agent_suspended") {
      yield await interruptEvent(input, record.event, options, limits);
      return;
    }
  }
  if (page.nextCursor) {
    yield event({ type: EventType.CUSTOM, name: "prism.replay_cursor", value: { cursor: page.nextCursor } });
    return;
  }
  if (page.terminal) return;
  const session = await options.sessionFactory({
    threadId: input.threadId,
    authorization,
    signal,
    input: await prepareInput(input, authorization, options, limits, signal),
  });
  if (session.id !== page.run.ref.sessionId) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay session mismatch");
  yield* mapped(
    filterRun(session.subscribe({ maxQueuedEvents: limits.maxQueuedEvents, overflow: "close" }), page.run.ref.runId),
    input,
    authorization,
    options,
    limits,
    signal,
  );
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
      await options.onSuspended?.({
        threadId: input.threadId,
        runId: input.runId,
        run,
        version: prismEvent.version,
        authorization,
        signal,
      });
      yield await interruptEvent(input, prismEvent, options, limits);
      return;
    }
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
    activity: options.mcp?.activity,
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
  for (const event of page.events) yield* mapper.mapCoWork(event);
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

function simpleResumeDecision(entry: {
  readonly status: string;
  readonly payload?: unknown;
}): { readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] } {
  if (entry.status === "cancelled") return { decision: "deny" };
  const payload = entry.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  if (Object.hasOwn(payload, "decisions")) {
    return { decisions: readRunDecisions((payload as { decisions: unknown }).decisions) };
  }
  const decision = (payload as { decision?: unknown }).decision;
  if (decision !== "approve" && decision !== "deny") {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Resume payload is invalid");
  }
  return { decision };
}

function hasEditedArgs(entries: readonly { readonly payload?: unknown }[]): boolean {
  return entries.some(
    (entry) =>
      entry.payload &&
      typeof entry.payload === "object" &&
      !Array.isArray(entry.payload) &&
      (Object.hasOwn(entry.payload, "editedArgs") || Object.hasOwn(entry.payload, "args")),
  );
}

async function interruptEvent<Authorization extends AgUiAuthorization>(
  input: ParsedAgUiInput,
  eventValue: Extract<AgentEvent, { readonly type: "agent_suspended" }>,
  options: CreateAgUiHandlerOptions<Authorization>,
  limits: ResolvedAgUiLimits,
): Promise<AGUIEvent> {
  const interruption = options.redactor?.redact(eventValue.interruption) ?? eventValue.interruption;
  const requiredId = interruptId(input.parentRunId ?? input.runId, eventValue.version);
  let interrupts: readonly Interrupt[] | undefined;
  try {
    interrupts = options.projection?.interrupt?.({ ...eventValue, interruption });
  } catch {
    interrupts = undefined;
  }
  const fallback: readonly Interrupt[] = [
    {
      id: requiredId,
      reason: boundedText(interruption.reason, limits.maxErrorBytes),
      message: boundedText(interruption.reason, limits.maxErrorBytes),
      ...(interruption.toolCallId ? { toolCallId: interruption.toolCallId } : {}),
      ...(interruption.pendingDecisions?.length ? { metadata: { pendingDecisions: interruption.pendingDecisions } } : {}),
      responseSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: { enum: ["approve", "deny"] },
          decisions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["approvalId", "outcome"],
              properties: {
                approvalId: { type: "string" },
                outcome: { enum: ["allow_once", "allow_for_run", "reject_once", "reject_for_run"] },
                reason: { type: "string" },
                modifiedArguments: { type: "object" },
                elicitation: { type: "object" },
              },
            },
          },
        },
      },
    },
  ];
  const selected = interrupts ?? fallback;
  if (selected.length === 0 || selected.length > limits.maxInputInterrupts || !selected.some((interrupt) => interrupt.id === requiredId)) {
    throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Interrupt projection must retain the current interrupt");
  }
  assertBoundedJson(selected, limits.maxStateBytes, limits, "interrupts");
  return event({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: { type: "interrupt", interrupts: selected },
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

function tagged(value: AGUIEvent, id: string, cursor?: string): AGUIEvent {
  return event({ ...value, prismEventId: id, ...(cursor === undefined ? {} : { prismCursor: cursor }) });
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

function errorResponse(error: unknown): Response {
  const known = error instanceof AgUiError;
  const status =
    known && error.code === "ERR_PRISM_AG_UI_FORBIDDEN" ? 403 : known && error.code === "ERR_PRISM_AG_UI_LIMIT" ? 413 : known ? 400 : 500;
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

function hasMultimodalInput(value: AgentCapabilities["multimodal"] | undefined): boolean {
  return Boolean(value?.input && Object.values(value.input).some((enabled) => enabled));
}

function hasHitl(value: AgentCapabilities["humanInTheLoop"] | undefined): boolean {
  return Boolean(value && Object.entries(value).some(([key, enabled]) => key !== "approveWithEdits" && enabled));
}
