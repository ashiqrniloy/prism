import { randomUUID } from "node:crypto";
import {
  type Agent,
  resolveCeilings,
  type AgentEvent,
  type CredentialResolver,
  createEnvRefCredentialResolver,
  type Decision,
  isSessionNotFound,
  type Message,
  type OwnershipScope,
  OwnershipScopeError,
  type PendingDecision,
  type Principal,
  type SecretRedactor,
  type Session,
} from "@arnilo/prism";
import { type A2AAgentCard, buildServedCard, endpointPathOf, signAgentCard } from "./card.js";
import {
  A2A_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  type A2AArtifact,
  type A2AMessage,
  type A2AStreamResponse,
  type A2ATask,
  type A2ATaskState,
  decodeTaskId,
  encodeTaskId,
  INTERRUPTED_STATES,
  isA2AId,
  type JsonRpcId,
  type JsonRpcRequest,
  jsonRpcError,
  jsonRpcResult,
  messageToA2A,
  parseJsonRpcRequest,
  parseSendMessageParams,
  parseTaskIdParams,
  partsToMessage,
  pendingParts,
  readDecisions,
  TERMINAL_STATES,
} from "./codec.js";
import { A2AConfigError, A2AError, A2ALiteralSecretError } from "./errors.js";
import { type A2ALimitOptions, type ResolvedA2ALimits, resolveA2ALimits } from "./limits.js";
import { suspensionOf } from "./pending.js";

export interface A2AAuthorizeInput {
  readonly request: Request;
  /** The JSON-RPC method being called. */
  readonly method: string;
  readonly signal: AbortSignal;
}

/** Who is calling and which ownership scope their contexts live in. */
export interface A2AAuthorization {
  readonly principal: Principal;
  /** Session ownership for this caller. When absent, `ownershipFor(principal)` is used, else sessions are unscoped. */
  readonly ownership?: OwnershipScope;
}

export interface ServeA2AOptions {
  /** The Agent Card to serve. `capabilities` is filled from what `serveA2A` implements. */
  readonly card: A2AAgentCard;
  /**
   * Verifies whatever the card's `securitySchemes` declare (Bearer, API key, OAuth, mTLS) and returns the
   * caller, or `false`. Required: without it every call is refused.
   */
  readonly authorize: (input: A2AAuthorizeInput) => A2AAuthorization | false | Promise<A2AAuthorization | false>;
  readonly ownershipFor?: (principal: Principal) => OwnershipScope;
  /** Signs the served card (ES256). `key` is an `env:` / `keyring:` ref to a PKCS#8 P-256 PEM; a literal throws. */
  readonly signing?: { readonly key: string; readonly keyId: string };
  /** Resolves `signing.key`. Defaults to the agent's credentials slot, else the kernel `env:` resolver. */
  readonly credentials?: CredentialResolver;
  /** Accept `modifiedArguments` in decisions (re-gated by the kernel). Defaults to `false`. */
  readonly allowModifiedArguments?: boolean;
  readonly redactor?: SecretRedactor;
  readonly limits?: A2ALimitOptions;
}

export interface A2AHandler {
  (request: Request): Promise<Response>;
  /** The card as served, before signing. */
  readonly card: A2AAgentCard;
  /** Aborts working tasks and closes every open session. */
  close(): Promise<void>;
}

type Listener = (frame: A2AStreamResponse, end: boolean) => void;

interface ContextEntry {
  readonly id: string;
  readonly principalKey: string;
  readonly session: Session;
  /** Set while a task of this context is starting or working; one run per session at a time. */
  busy: boolean;
}

interface TaskRecord {
  readonly id: string;
  readonly contextId: string;
  readonly runId: string;
  readonly principalKey: string;
  state: A2ATaskState;
  statusMessage?: A2AMessage;
  timestamp: string;
  pending: readonly PendingDecision[];
  readonly artifacts: A2AArtifact[];
  current?: { readonly artifactId: string; text: string };
  artifactSeq: number;
  readonly listeners: Set<Listener>;
  segment: Promise<void>;
  settle?: () => void;
  controller?: AbortController;
  cancelRequested: boolean;
  timedOut: boolean;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "a2a-version": A2A_PROTOCOL_VERSION };
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "a2a-version": A2A_PROTOCOL_VERSION,
};
const MAX_ARTIFACTS = 16;
const MAX_STATUS_TEXT_BYTES = 2 * 1024;
const VERSION_PATTERN = /^1\.0(?:\.\d+)?$/;

/**
 * Serves one `Agent` to A2A 1.0 peers over JSON-RPC: the Agent Card at `/.well-known/agent-card.json`, and
 * `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask` and `SubscribeToTask` at the card's JSONRPC
 * interface path. A context is one session; a task is one run plus the resumes that continue it. Every call
 * goes through `session.stream` / `session.resume`, so approvals, hooks and limits apply.
 */
export function serveA2A(agent: Agent, options: ServeA2AOptions): A2AHandler {
  const limits = resolveA2ALimits(options.limits);
  const maxDecisions = resolveCeilings(agent.config?.ceilings).pendingDecisions;
  const card = buildServedCard(options.card);
  const endpointPath = endpointPathOf(card);
  if (options.signing !== undefined) {
    const { key, keyId } = options.signing;
    if (typeof key !== "string" || !(key.startsWith("env:") || key.startsWith("keyring:"))) throw new A2ALiteralSecretError("signing.key");
    if (typeof keyId !== "string" || keyId.trim().length === 0) throw new A2AConfigError("signing.keyId is required");
  }
  let servedCard: Promise<string> | undefined;
  const cardBody = (): Promise<string> => {
    servedCard ??= (async () => {
      if (!options.signing) return JSON.stringify(card);
      const resolver = options.credentials ?? resolverOf(agent);
      const pem = (await resolver.resolve(options.signing.key, { package: "@arnilo/prism-hosts/a2a" }))?.value;
      if (!pem) throw new A2AConfigError("signing.key reference is unavailable");
      return JSON.stringify(signAgentCard(card, pem, options.signing.keyId));
    })();
    servedCard.catch(() => {
      servedCard = undefined;
    });
    return servedCard;
  };

  const contexts = new Map<string, Promise<ContextEntry>>();
  const tasks = new Map<string, TaskRecord>();
  const working = new Map<string, number>();
  const declaredInput = agent.config?.model?.capabilities?.input;
  const redact = (text: string): string => boundedText(options.redactor ? options.redactor.redact(text) : text, MAX_STATUS_TEXT_BYTES);

  // --- contexts --------------------------------------------------------------------------------

  async function contextFor(
    contextId: string,
    principalKey: string,
    ownership: OwnershipScope | undefined,
    create: boolean,
  ): Promise<ContextEntry> {
    const existing = contexts.get(contextId);
    if (existing) {
      const entry = await existing;
      if (entry.principalKey !== principalKey) throw notFound();
      contexts.delete(contextId);
      contexts.set(contextId, existing); // most recently used last
      return entry;
    }
    await evictContexts();
    const opening = (async (): Promise<ContextEntry> => {
      try {
        const session = await agent.session({ id: contextId, create, ...(ownership ? { ownership } : {}) });
        return { id: contextId, principalKey, session, busy: false };
      } catch (error) {
        if (isSessionNotFound(error) || error instanceof OwnershipScopeError || codeOf(error) === "ERR_PRISM_OWNERSHIP_WIDEN")
          throw notFound();
        throw error;
      }
    })();
    contexts.set(contextId, opening);
    opening.catch(() => {
      if (contexts.get(contextId) === opening) contexts.delete(contextId);
    });
    return opening;
  }

  async function evictContexts(): Promise<void> {
    if (contexts.size < limits.maxContexts) return;
    for (const [id, promise] of contexts) {
      const entry = await promise.catch(() => undefined);
      if (entry?.busy) continue;
      contexts.delete(id);
      await entry?.session.close().catch(() => {});
      if (contexts.size < limits.maxContexts) return;
    }
    throw new A2AError("overloaded", "Too many open contexts", 429);
  }

  // --- task registry -----------------------------------------------------------------------------

  function register(record: TaskRecord): void {
    if (tasks.size >= limits.maxTasks) {
      for (const [id, candidate] of tasks) {
        if (candidate.state === "TASK_STATE_WORKING") continue;
        tasks.delete(id);
        if (tasks.size < limits.maxTasks) break;
      }
      if (tasks.size >= limits.maxTasks) throw new A2AError("overloaded", "Too many tasks", 429);
    }
    tasks.set(record.id, record);
  }

  function newRecord(contextId: string, runId: string, principalKey: string, state: A2ATaskState): TaskRecord {
    return {
      id: encodeTaskId(contextId, runId),
      contextId,
      runId,
      principalKey,
      state,
      timestamp: new Date().toISOString(),
      pending: [],
      artifacts: [],
      artifactSeq: 0,
      listeners: new Set(),
      segment: Promise.resolve(),
      cancelRequested: false,
      timedOut: false,
    };
  }

  /** A task the caller owns: from the registry, else recovered from its session when it is still suspended. */
  async function lookup(taskId: string, principalKey: string, ownership: OwnershipScope | undefined): Promise<TaskRecord> {
    const known = tasks.get(taskId);
    if (known) {
      if (known.principalKey !== principalKey) throw notFound();
      return known;
    }
    const decoded = decodeTaskId(taskId);
    if (!decoded) throw notFound();
    const context = await contextFor(decoded.contextId, principalKey, ownership, false);
    const suspension = suspensionOf(await context.session.entries());
    if (!suspension || suspension.runId !== decoded.runId) throw notFound();
    const record = newRecord(decoded.contextId, decoded.runId, principalKey, "TASK_STATE_INPUT_REQUIRED");
    record.pending = suspension.pending;
    record.statusMessage = statusMessage(record, pendingParts(suspension.pending));
    register(record);
    return record;
  }

  function statusMessage(record: TaskRecord, parts: A2AMessage["parts"]): A2AMessage {
    return { messageId: randomUUID(), role: "ROLE_AGENT", contextId: record.contextId, taskId: record.id, parts };
  }

  function snapshot(record: TaskRecord, history?: readonly A2AMessage[]): A2ATask {
    return {
      id: record.id,
      contextId: record.contextId,
      status: {
        state: record.state,
        ...(record.statusMessage ? { message: record.statusMessage } : {}),
        timestamp: record.timestamp,
      },
      ...(record.artifacts.length > 0 ? { artifacts: record.artifacts.map((artifact) => ({ ...artifact })) } : {}),
      ...(history ? { history } : {}),
    };
  }

  function emit(record: TaskRecord, frame: A2AStreamResponse, end = false): void {
    for (const listener of record.listeners) listener(frame, end);
    if (end) record.listeners.clear();
  }

  function statusFrame(record: TaskRecord): A2AStreamResponse {
    return {
      statusUpdate: {
        taskId: record.id,
        contextId: record.contextId,
        status: {
          state: record.state,
          ...(record.statusMessage ? { message: record.statusMessage } : {}),
          timestamp: record.timestamp,
        },
      },
    };
  }

  function setState(record: TaskRecord, state: A2ATaskState, message?: A2AMessage): void {
    record.state = state;
    record.statusMessage = message;
    record.timestamp = new Date().toISOString();
  }

  // --- running -----------------------------------------------------------------------------------

  /** Reads events until `run.started`, so a run that cannot start is a JSON-RPC error, not a task. */
  async function untilStarted(iterator: AsyncIterator<AgentEvent>): Promise<string> {
    while (true) {
      let next: IteratorResult<AgentEvent>;
      try {
        next = await iterator.next();
      } catch (error) {
        if (nameOf(error) === "AgentDecisionError") throw new A2AError("invalidParams", "Decisions do not match the pending task");
        if (nameOf(error) === "AgentBusyError" || codeOf(error) === "session_busy")
          throw new A2AError("invalidParams", "The context has a run in progress");
        throw error;
      }
      if (next.done) throw new A2AError("internalError", "The run could not start");
      const event = next.value;
      if (event.type === "run.started") return event.runId;
      if (event.type === "run.failed") throw new A2AError("internalError", "The run could not start");
    }
  }

  function arm(record: TaskRecord, controller: AbortController, context: ContextEntry): () => void {
    record.controller = controller;
    record.cancelRequested = false;
    record.timedOut = false;
    let settle!: () => void;
    record.segment = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => {
      record.timedOut = true;
      controller.abort(new Error("A2A task timed out"));
    }, limits.taskTimeoutMs);
    record.settle = () => {
      clearTimeout(timer);
      record.controller = undefined;
      context.busy = false;
      working.set(record.principalKey, Math.max(0, (working.get(record.principalKey) ?? 1) - 1));
      settle();
    };
    return () => record.settle?.();
  }

  function finish(record: TaskRecord, state: A2ATaskState, message?: A2AMessage): void {
    if (record.state !== "TASK_STATE_WORKING") return;
    if (record.current) closeArtifact(record);
    setState(record, state, message);
    const settle = record.settle;
    record.settle = undefined;
    emit(record, statusFrame(record), true);
    settle?.();
  }

  function closeArtifact(record: TaskRecord): void {
    const current = record.current;
    record.current = undefined;
    if (!current || current.text.length === 0) return;
    record.artifacts.push({ artifactId: current.artifactId, name: "response", parts: [{ text: current.text }] });
    if (record.artifacts.length > MAX_ARTIFACTS) record.artifacts.splice(0, record.artifacts.length - MAX_ARTIFACTS);
  }

  function appendText(record: TaskRecord, text: string): void {
    if (text.length === 0) return;
    const append = record.current !== undefined;
    if (!record.current) record.current = { artifactId: `response-${++record.artifactSeq}`, text: "" };
    if (record.current.text.length + text.length <= limits.maxResponseBytes) record.current.text += text;
    emit(record, {
      artifactUpdate: {
        taskId: record.id,
        contextId: record.contextId,
        artifact: { artifactId: record.current.artifactId, name: "response", parts: [{ text }] },
        append,
      },
    });
  }

  function apply(record: TaskRecord, event: AgentEvent): void {
    switch (event.type) {
      case "message.delta":
        if (event.content.type === "text") appendText(record, event.content.text);
        return;
      case "message.completed": {
        if (event.message.role !== "assistant") return;
        if (!record.current) {
          const text = event.message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
          appendText(record, text);
        }
        closeArtifact(record);
        return;
      }
      case "run.suspended": {
        const interruption = options.redactor?.redact(event.interruption) ?? event.interruption;
        const pending: readonly PendingDecision[] =
          interruption.pendingDecisions ??
          (interruption.toolCallId || interruption.toolName
            ? [
                {
                  approvalId: event.runId,
                  kind: interruption.kind === "elicitation" ? "elicitation" : "tool_approval",
                  toolCallId: interruption.toolCallId,
                  scope: interruption.toolName ? { toolName: interruption.toolName } : {},
                  reason: interruption.reason,
                },
              ]
            : []);
        if (pending.length === 0) {
          finish(record, "TASK_STATE_FAILED", statusMessage(record, [{ text: "The run suspended with no decision to answer" }]));
          return;
        }
        record.pending = pending;
        finish(record, "TASK_STATE_INPUT_REQUIRED", statusMessage(record, pendingParts(pending)));
        return;
      }
      case "run.completed":
        finish(record, event.status === "stopped" && event.stopReason === "denied" ? "TASK_STATE_REJECTED" : "TASK_STATE_COMPLETED");
        return;
      case "run.failed":
        if (record.cancelRequested) finish(record, "TASK_STATE_CANCELED");
        else if (record.timedOut) finish(record, "TASK_STATE_FAILED", statusMessage(record, [{ text: "The task timed out" }]));
        else finish(record, "TASK_STATE_FAILED", statusMessage(record, [{ text: redact(event.error.message || "The run failed") }]));
        return;
      default:
        return;
    }
  }

  async function pump(record: TaskRecord, iterator: AsyncIterator<AgentEvent>, release: () => void): Promise<void> {
    try {
      while (record.state === "TASK_STATE_WORKING") {
        const next = await iterator.next();
        if (next.done) break;
        apply(record, next.value);
      }
    } catch {
      // A throwing iterator ends the task below; its error text is never forwarded.
    } finally {
      if (record.state === "TASK_STATE_WORKING") {
        finish(record, record.cancelRequested ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED");
      }
      release();
      await iterator.return?.().catch(() => {});
    }
  }

  function reserve(principalKey: string, context: ContextEntry): void {
    if (context.busy) throw new A2AError("invalidParams", "The context has a task in progress");
    const count = working.get(principalKey) ?? 0;
    if (count >= limits.maxConcurrentTasks) throw new A2AError("overloaded", "Too many concurrent tasks", 429);
    working.set(principalKey, count + 1);
    context.busy = true;
  }

  function unreserve(principalKey: string, context: ContextEntry): void {
    working.set(principalKey, Math.max(0, (working.get(principalKey) ?? 1) - 1));
    context.busy = false;
  }

  async function startTask(context: ContextEntry, caller: Caller, input: Message, listener?: Listener): Promise<TaskRecord> {
    reserve(caller.principalKey, context);
    const controller = new AbortController();
    let iterator: AsyncIterator<AgentEvent>;
    let runId: string;
    try {
      iterator = context.session
        .stream(input, {
          ...(caller.ownership ? { ownership: caller.ownership } : {}),
          principal: caller.principal,
          signal: controller.signal,
          interactive: false,
          ...(options.redactor ? { redactor: options.redactor } : {}),
          overflow: "coalesce",
        })
        [Symbol.asyncIterator]();
      runId = await untilStarted(iterator);
    } catch (error) {
      unreserve(caller.principalKey, context);
      throw error;
    }
    const record = newRecord(context.id, runId, caller.principalKey, "TASK_STATE_WORKING");
    try {
      register(record);
    } catch (error) {
      context.session.abort("A2A registry full");
      unreserve(caller.principalKey, context);
      await iterator.return?.().catch(() => {});
      throw error;
    }
    const release = arm(record, controller, context);
    if (listener) {
      record.listeners.add(listener);
      listener({ task: snapshot(record) }, false);
    }
    void pump(record, iterator, release);
    return record;
  }

  async function resumeTask(
    record: TaskRecord,
    context: ContextEntry,
    caller: Caller,
    decisions: readonly Decision[],
    listener?: Listener,
  ): Promise<void> {
    const known = new Set(record.pending.map((decision) => decision.approvalId));
    if (decisions.some((decision) => !known.has(decision.approvalId))) {
      throw new A2AError("invalidParams", "Decisions do not match the pending task");
    }
    reserve(caller.principalKey, context);
    const controller = new AbortController();
    let iterator: AsyncIterator<AgentEvent>;
    try {
      iterator = context.session
        .resume(decisions, {
          ...(caller.ownership ? { ownership: caller.ownership } : {}),
          principal: caller.principal,
          signal: controller.signal,
          interactive: false,
          ...(options.redactor ? { redactor: options.redactor } : {}),
          overflow: "coalesce",
        })
        [Symbol.asyncIterator]();
      const runId = await untilStarted(iterator);
      if (runId !== record.runId) throw new A2AError("internalError", "The resumed run does not match the task");
    } catch (error) {
      unreserve(caller.principalKey, context);
      throw error;
    }
    const release = arm(record, controller, context);
    record.pending = [];
    setState(record, "TASK_STATE_WORKING");
    if (listener) {
      record.listeners.add(listener);
      listener({ task: snapshot(record) }, false);
    }
    emit(record, statusFrame(record));
    void pump(record, iterator, release);
  }

  async function history(record: TaskRecord, length: number | undefined): Promise<readonly A2AMessage[] | undefined> {
    if (!length) return undefined;
    const context = await contexts.get(record.contextId)?.catch(() => undefined);
    if (!context) return undefined;
    const messages = await context.session.messages();
    const out: A2AMessage[] = [];
    for (let index = messages.length - 1; index >= 0 && out.length < Math.min(length, limits.maxHistory); index -= 1) {
      const message = messages[index];
      const mapped = message ? messageToA2A(message, index, record.contextId, record.id) : undefined;
      if (mapped) out.unshift(mapped);
    }
    return out;
  }

  // --- methods -----------------------------------------------------------------------------------

  async function sendMessage(rpc: JsonRpcRequest, caller: Caller, stream: SseStream | undefined): Promise<Response> {
    const params = parseSendMessageParams(rpc.params, limits.maxParts);
    const decisions = readDecisions(params.message, options.allowModifiedArguments === true, maxDecisions);
    let record: TaskRecord;
    if (params.message.taskId !== undefined) {
      record = await lookup(params.message.taskId, caller.principalKey, caller.ownership);
      if (params.message.contextId !== undefined && params.message.contextId !== record.contextId) {
        throw new A2AError("invalidParams", "message.contextId does not match the task");
      }
      if (TERMINAL_STATES.has(record.state)) throw new A2AError("unsupportedOperation", "The task is in a terminal state");
      if (record.state !== "TASK_STATE_INPUT_REQUIRED") throw new A2AError("invalidParams", "The task is still working");
      if (!decisions) throw new A2AError("invalidParams", "The task is waiting for decisions");
      const context = await contextFor(record.contextId, caller.principalKey, caller.ownership, false);
      await resumeTask(record, context, caller, decisions, stream?.listener);
    } else {
      if (decisions) throw new A2AError("invalidParams", "Decisions need the taskId they answer");
      const input = partsToMessage(params.message.parts, declaredInput);
      const contextId = params.message.contextId ?? randomUUID();
      if (!isA2AId(contextId)) throw new A2AError("invalidParams", "message.contextId is invalid");
      const context = await contextFor(contextId, caller.principalKey, caller.ownership, true);
      if (!context.busy && suspensionOf(await context.session.entries())) {
        throw new A2AError("invalidParams", "The context has a task waiting for decisions");
      }
      record = await startTask(context, caller, input, stream?.listener);
    }
    if (stream) {
      if (record.state !== "TASK_STATE_WORKING") stream.end();
      return stream.response(rpc.id);
    }
    if (!params.returnImmediately) await record.segment;
    return json(rpc.id, { task: snapshot(record, await history(record, params.historyLength)) });
  }

  async function getTask(rpc: JsonRpcRequest, caller: Caller): Promise<Response> {
    const params = parseTaskIdParams(rpc.params);
    const record = await lookup(params.id, caller.principalKey, caller.ownership);
    if (params.historyLength) await contextFor(record.contextId, caller.principalKey, caller.ownership, false);
    return json(rpc.id, snapshot(record, await history(record, params.historyLength)));
  }

  async function cancelTask(rpc: JsonRpcRequest, caller: Caller): Promise<Response> {
    const params = parseTaskIdParams(rpc.params);
    const record = await lookup(params.id, caller.principalKey, caller.ownership);
    if (record.state !== "TASK_STATE_WORKING") throw new A2AError("taskNotCancelable", "The task cannot be canceled in its current state");
    record.cancelRequested = true;
    const context = await contexts.get(record.contextId);
    context?.session.abort("A2A CancelTask");
    record.controller?.abort(new Error("A2A CancelTask"));
    await record.segment;
    return json(rpc.id, snapshot(record));
  }

  async function subscribeToTask(rpc: JsonRpcRequest, caller: Caller, stream: SseStream): Promise<Response> {
    const params = parseTaskIdParams(rpc.params);
    const record = await lookup(params.id, caller.principalKey, caller.ownership);
    if (TERMINAL_STATES.has(record.state)) throw new A2AError("unsupportedOperation", "The task is in a terminal state");
    stream.listener({ task: snapshot(record) }, INTERRUPTED_STATES.has(record.state));
    if (record.state === "TASK_STATE_WORKING") record.listeners.add(stream.listener);
    return stream.response(rpc.id);
  }

  async function dispatch(rpc: JsonRpcRequest, caller: Caller): Promise<Response> {
    switch (rpc.method) {
      case "SendMessage":
        return sendMessage(rpc, caller, undefined);
      case "SendStreamingMessage": {
        const stream = sseStream(limits);
        try {
          return await sendMessage(rpc, caller, stream);
        } catch (error) {
          stream.discard();
          throw error;
        }
      }
      case "GetTask":
        return getTask(rpc, caller);
      case "CancelTask":
        return cancelTask(rpc, caller);
      case "SubscribeToTask": {
        const stream = sseStream(limits);
        try {
          return await subscribeToTask(rpc, caller, stream);
        } catch (error) {
          stream.discard();
          throw error;
        }
      }
      case "ListTasks":
        throw new A2AError("unsupportedOperation", "ListTasks is not supported");
      case "CreateTaskPushNotificationConfig":
      case "GetTaskPushNotificationConfig":
      case "ListTaskPushNotificationConfig":
      case "ListTaskPushNotificationConfigs":
      case "DeleteTaskPushNotificationConfig":
        throw new A2AError("pushNotificationNotSupported", "Push notifications are not supported");
      case "GetExtendedAgentCard":
        throw new A2AError("extendedAgentCardNotConfigured", "No extended Agent Card is configured");
      default:
        throw new A2AError("methodNotFound", "Method not found");
    }
  }

  function json(id: JsonRpcId, result: unknown): Response {
    const body = jsonRpcResult(id, result);
    if (Buffer.byteLength(body) > limits.maxResponseBytes) {
      return new Response(jsonRpcError(id, new A2AError("internalError", "Response exceeds maxResponseBytes")), { headers: JSON_HEADERS });
    }
    return new Response(body, { headers: JSON_HEADERS });
  }

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === A2A_CARD_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      try {
        return new Response(await cardBody(), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      } catch {
        return new Response(JSON.stringify({ error: "Agent Card unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
    }
    if (url.pathname !== endpointPath) return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    let rpcId: JsonRpcId | null = null;
    try {
      const version = request.headers.get("a2a-version") ?? url.searchParams.get("A2A-Version") ?? "";
      // An empty or missing version means 0.3 (spec §3.6.2), which this server does not serve.
      if (!VERSION_PATTERN.test(version.trim())) throw new A2AError("versionNotSupported", "A2A version not supported");
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json" && contentType !== "application/a2a+json") {
        throw new A2AError("invalidRequest", "Content-Type must be application/json", 415);
      }
      const rpc = parseJsonRpcRequest(await readJson(request, limits.maxRequestBytes));
      rpcId = rpc.id;
      const caller = await authorizeCall(request, rpc.method);
      return await dispatch(rpc, caller);
    } catch (error) {
      const known = error instanceof A2AError ? error : new A2AError("internalError", "Internal error");
      return new Response(jsonRpcError(rpcId, known), { status: known.status, headers: JSON_HEADERS });
    }
  };

  async function authorizeCall(request: Request, method: string): Promise<Caller> {
    if (typeof options.authorize !== "function") throw new A2AError("invalidRequest", "Unauthorized", 401);
    let result: A2AAuthorization | false;
    try {
      result = await options.authorize({ request, method, signal: request.signal });
    } catch {
      throw new A2AError("invalidRequest", "Unauthorized", 401);
    }
    const principal = result ? result.principal : undefined;
    if (!result || !principal || typeof principal.kind !== "string" || typeof principal.id !== "string" || principal.id.length === 0) {
      throw new A2AError("invalidRequest", "Unauthorized", 401);
    }
    const ownership = result.ownership ?? options.ownershipFor?.(principal);
    return { principal, ownership, principalKey: `${principal.kind.length}:${principal.kind}:${principal.id}` };
  }

  async function close(): Promise<void> {
    const segments: Promise<void>[] = [];
    for (const record of tasks.values()) {
      if (record.state !== "TASK_STATE_WORKING") continue;
      record.cancelRequested = true;
      record.controller?.abort(new Error("A2A handler closed"));
      segments.push(record.segment);
    }
    for (const promise of contexts.values()) (await promise.catch(() => undefined))?.session.abort("A2A handler closed");
    await Promise.all(segments);
    for (const promise of contexts.values()) await (await promise.catch(() => undefined))?.session.close().catch(() => {});
    contexts.clear();
  }

  return Object.assign(handler, { card, close });
}

interface Caller {
  readonly principal: Principal;
  readonly ownership: OwnershipScope | undefined;
  readonly principalKey: string;
}

interface SseStream {
  readonly listener: Listener;
  end(): void;
  discard(): void;
  response(id: JsonRpcId): Response;
}

/**
 * One SSE response fed by a task listener. It closes at a terminal or interrupted state, at a stream limit,
 * or when the client goes away; the task itself keeps running and can be resubscribed.
 */
function sseStream(limits: ResolvedA2ALimits): SseStream {
  const queue: { frame: A2AStreamResponse; end: boolean }[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let detached = false;
  const listener: Listener = (frame, end) => {
    if (detached) return;
    queue.push({ frame, end });
    wake?.();
  };
  return {
    listener,
    end() {
      ended = true;
      wake?.();
    },
    discard() {
      detached = true;
    },
    response(id) {
      const encoder = new TextEncoder();
      let count = 0;
      let bytes = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const stop = () => {
        detached = true;
        if (timer) clearTimeout(timer);
      };
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            timer = setTimeout(() => {
              timedOut = true;
              wake?.();
            }, limits.maxStreamMs);
          },
          async pull(controller) {
            while (queue.length === 0 && !ended && !timedOut) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = undefined;
            }
            const next = queue.shift();
            if (!next) {
              stop();
              controller.close();
              return;
            }
            const chunk = encoder.encode(`data: ${jsonRpcResult(id, next.frame)}\n\n`);
            count += 1;
            bytes += chunk.byteLength;
            if (count > limits.maxStreamEvents || bytes > limits.maxStreamBytes) {
              controller.enqueue(encoder.encode(`data: ${jsonRpcError(id, new A2AError("internalError", "Stream limit exceeded"))}\n\n`));
              stop();
              controller.close();
              return;
            }
            controller.enqueue(chunk);
            if (next.end) {
              ended = true;
              if (queue.length === 0) {
                stop();
                controller.close();
              }
            }
          },
          cancel: stop,
        }),
        { status: 200, headers: SSE_HEADERS },
      );
    },
  };
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new A2AError("invalidRequest", "Request exceeds maxRequestBytes", 413);
  if (!request.body) throw new A2AError("invalidRequest", "Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new A2AError("invalidRequest", "Request exceeds maxRequestBytes", 413);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new A2AError("parseError", "Invalid JSON");
  }
}

function resolverOf(agent: Agent): CredentialResolver {
  const assigned = agent.config?.slots?.credentials;
  return typeof assigned === "object" ? assigned : createEnvRefCredentialResolver();
}

function notFound(): A2AError {
  return new A2AError("taskNotFound", "Task not found");
}

function nameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function codeOf(error: unknown): unknown {
  return error instanceof Error ? (error as { code?: unknown }).code : undefined;
}

function boundedText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
