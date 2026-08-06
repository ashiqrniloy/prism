import { type AGUIEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import type { AgentEvent, AgentEventSource, AgentSession, SecretRedactor } from "@arnilo/prism";
import type {
  A2AAgentCard,
  A2AAgentEventTask,
  A2AAuthorization,
  A2AAuthorizer,
  A2AMessage,
  A2APartPolicy,
  A2APushProvider,
  A2ALimits,
  A2ATask,
  A2ATaskEvent,
  A2ATaskEventPayload,
  A2ATaskLifecycle,
  A2ATextPart,
  ResolvedA2ALimits,
} from "@arnilo/prism-supervisor";
import { createAgUiEventMapper, truncateUtf8 } from "./ag-ui-mapper.js";
import type { AgUiA2UiOptions } from "./a2ui.js";
import { AgUiError } from "./errors.js";
import type { AgUiInputOptions, AgUiPreparedInput } from "./handler.js";
import { assertBoundedJson, defaultAgUiInput, type ParsedAgUiInput, parseAgUiInput } from "./input.js";
import { type AgUiLimitOptions, type ResolvedAgUiLimits, resolveAgUiLimits } from "./limits.js";
import type { AgUiProjection } from "./projection.js";

type SupervisorA2AError = typeof import("@arnilo/prism-supervisor").A2AError;

/**
 * A2A server-side exposure: fronts one host-selected local AG-UI agent as an A2A 1.0
 * server. Reuses `@arnilo/prism-supervisor` `createA2AHandler` transport/lifecycle
 * (agent card, `SendMessage`/`SendStreamingMessage`, task operations, push, frozen
 * `A2ALimits`) and maps A2A messages through the AG-UI input allow-list and event
 * mapper, so remote A2A clients see the same projected, redacted, byte-bounded output
 * as the AG-UI SSE path. No second runtime, task store, or worker is created; a bounded
 * in-memory registry covers tasks started on this instance, and an optional durable
 * source replays finished runs.
 */
export type AgUiA2AServer = (request: Request) => Promise<Response>;

export interface AgUiA2AServerTaskInput {
  readonly message: A2AMessage;
  readonly contextId: string;
  readonly authorization: A2AAuthorization;
  readonly signal: AbortSignal;
}

export interface CreateAgUiA2AServerOptions {
  /** Host agent card; streaming capability must match the built-in task lifecycle. */
  readonly card: A2AAgentCard;
  /**
   * A2A request authorizer. The returned authorization (ownership, identity, metadata)
   * is also the AG-UI authorization passed to every AG-UI surface; hosts with richer
   * AG-UI authorization must perform their identity checks here.
   */
  readonly authorize: A2AAuthorizer;
  /** AG-UI session factory; receives projected input exactly like `createAgUiHandler`. */
  readonly sessionFactory: (input: {
    readonly threadId: string;
    readonly authorization: A2AAuthorization;
    readonly signal: AbortSignal;
    readonly input: AgUiPreparedInput;
  }) => AgentSession | Promise<AgentSession>;
  /** AG-UI full-input allow-list. Omit it to keep the last-text/default-deny boundary. */
  readonly input?: AgUiInputOptions<A2AAuthorization>;
  readonly projection?: AgUiProjection;
  readonly redactor?: SecretRedactor;
  /** Opt-in A2UI painting middleware, matching the AG-UI handler option. */
  readonly a2ui?: AgUiA2UiOptions;
  /**
   * Durable replay for `GetTask`/`SubscribeToTask` after a run finishes. `resolveTask`
   * maps an A2A task id to its exact run (host-owned correlation); the source replays
   * it with cursor event ids. Omit it to keep task lifecycle limited to live tasks.
   */
  readonly durable?: {
    readonly source: AgentEventSource;
    readonly resolveTask: (input: {
      readonly id: string;
      readonly authorization: A2AAuthorization;
      readonly signal: AbortSignal;
    }) => A2AAgentEventTask | undefined | Promise<A2AAgentEventTask | undefined>;
  };
  /** Host-owned full A2A task lifecycle; overrides the built-in one. */
  readonly tasks?: A2ATaskLifecycle;
  readonly push?: A2APushProvider;
  readonly parts?: A2APartPolicy;
  readonly endpointPath?: string;
  /** AG-UI caps for the mapped event pipeline (defaults/hards from `limits.ts`). */
  readonly limits?: AgUiLimitOptions;
  /** A2A caps for the server handler (defaults/hards from supervisor `a2a-parts.ts`). */
  readonly a2aLimits?: A2ALimits;
  /** Host-owned A2A task id for a new run; default `task-<uuid>`. */
  readonly selectTaskId?: (input: AgUiA2AServerTaskInput) => string | Promise<string>;
}

/** ponytail: fixed live-task registry cap; per-tenant maps if a host ever needs eviction fairness. */
const MAX_LIVE_TASKS = 512;

interface LiveTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly controller: AbortController;
  events: AsyncGenerator<A2ATaskEvent> | undefined;
  readonly startedAt: number;
  terminal: A2ATask | undefined;
  consumed: boolean;
}

/**
 * Fronts a local AG-UI-fronted agent as an A2A 1.0 server. Requires the optional
 * `@arnilo/prism-supervisor` peer, imported lazily so plain `@arnilo/prism-ag-ui`
 * imports keep working without it.
 */
export async function createAgUiA2AServer(options: CreateAgUiA2AServerOptions): Promise<AgUiA2AServer> {
  const supervisor = await import("@arnilo/prism-supervisor").catch(() => {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "createAgUiA2AServer requires the optional @arnilo/prism-supervisor peer");
  });
  const agUiLimits = resolveAgUiLimits(options.limits);
  const a2aLimits = supervisor.resolveA2ALimits(options.a2aLimits);
  const tasks = options.tasks ?? createBuiltinTasks(options, agUiLimits, a2aLimits, supervisor.A2AError);
  return supervisor.createA2AHandler({
    card: options.card,
    authorize: options.authorize,
    parts: options.parts,
    push: options.push,
    endpointPath: options.endpointPath,
    limits: options.a2aLimits,
    redactor: options.redactor,
    exposure: {
      sessionFactory: () => {
        throw new supervisor.A2AError("Direct text exposure is unavailable; the task lifecycle is active", 500, "ERR_PRISM_A2A_CONFIG");
      },
    },
    tasks,
  });
}

function createBuiltinTasks(
  options: CreateAgUiA2AServerOptions,
  agUiLimits: ResolvedAgUiLimits,
  a2aLimits: ResolvedA2ALimits,
  A2AError: SupervisorA2AError,
): A2ATaskLifecycle {
  const live = new Map<string, LiveTask>();

  const register = (entry: LiveTask): void => {
    live.set(entry.taskId, entry);
    if (live.size > MAX_LIVE_TASKS) {
      const oldestId = live.keys().next().value as string;
      const oldest = live.get(oldestId)!;
      live.delete(oldestId);
      oldest.controller.abort(new Error("A2A live task evicted"));
    }
  };

  const working = (taskId: string, contextId: string): A2ATask => ({
    id: taskId,
    contextId,
    status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() },
  });

  return {
    async start({ message, authorization, signal, returnImmediately }) {
      const contextId = message.contextId ?? `context-${crypto.randomUUID()}`;
      const taskId = options.selectTaskId
        ? await options.selectTaskId({ message, contextId, authorization, signal })
        : `task-${crypto.randomUUID()}`;
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason ?? new Error("A2A task aborted"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      const entry: LiveTask = {
        taskId,
        contextId,
        controller,
        events: undefined,
        startedAt: Date.now(),
        terminal: undefined,
        consumed: false,
      };
      register(entry);
      const run = runPipeline(entry, message, authorization, options, agUiLimits, a2aLimits);
      entry.events = run;
      if (returnImmediately) return working(taskId, contextId);
      let terminal: A2ATask | undefined;
      try {
        for await (const event of run) if ("task" in event) terminal = event.task;
      } catch (error) {
        terminal = failedTask(taskId, contextId, error);
      }
      return terminal ?? failedTask(taskId, contextId, "Run ended without a terminal event");
    },
    async get({ id, authorization, signal }) {
      const entry = live.get(id);
      if (entry) return entry.terminal ?? working(entry.taskId, entry.contextId);
      if (!options.durable) return undefined;
      const resolved = await options.durable.resolveTask({ id, authorization, signal });
      return resolved?.task.id === id ? resolved.task : undefined;
    },
    async list({ pageSize, pageToken, contextId }) {
      const start = pageToken === undefined ? 0 : pageIndex(pageToken, A2AError);
      const entries = [...live.values()].filter((entry) => contextId === undefined || entry.contextId === contextId);
      const tasks = entries.slice(start, start + pageSize).map((entry) => entry.terminal ?? working(entry.taskId, entry.contextId));
      const next = start + tasks.length < entries.length ? `i:${start + tasks.length}` : undefined;
      return { tasks, nextPageToken: next };
    },
    async cancel({ id, authorization, signal }) {
      const entry = live.get(id);
      if (!entry) {
        if (!options.durable) return undefined;
        const resolved = await options.durable.resolveTask({ id, authorization, signal });
        return resolved?.task.id === id ? resolved.task : undefined;
      }
      const canceled: A2ATask = {
        id: entry.taskId,
        contextId: entry.contextId,
        status: { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() },
      };
      entry.terminal = canceled;
      entry.controller.abort(new Error("A2A task canceled"));
      return canceled;
    },
    subscribe({ id, afterEventId, authorization, signal }) {
      const entry = live.get(id);
      if (entry) {
        if (entry.terminal) {
          return oneTask(`${id}:terminal`, entry.terminal);
        }
        if (!entry.consumed) {
          entry.consumed = true;
          return skipEvents(entry.events!, afterEventId);
        }
        // The single live consumer is active; fall through to durable replay.
      }
      return durableSubscribe(id, afterEventId, authorization, signal, options, a2aLimits, A2AError);
    },
  };
}

/** Runs the local AG-UI pipeline and maps its events to A2A task events. */
async function* runPipeline(
  entry: LiveTask,
  message: A2AMessage,
  authorization: A2AAuthorization,
  options: CreateAgUiA2AServerOptions,
  agUiLimits: ResolvedAgUiLimits,
  a2aLimits: ResolvedA2ALimits,
): AsyncGenerator<A2ATaskEvent> {
  const { taskId, contextId, controller } = entry;
  const signal = controller.signal;
  const status = (state: A2ATask["status"]["state"]): A2ATask => ({
    id: taskId,
    contextId,
    status: { state, timestamp: new Date().toISOString() },
  });
  const failed = (error: unknown): A2ATask => {
    const messageText = (error instanceof Error ? error.message : String(error)).slice(0, 1024);
    return {
      id: taskId,
      contextId,
      status: { state: "TASK_STATE_FAILED", timestamp: new Date().toISOString() },
      ...(messageText ? { metadata: { error: messageText } } : {}),
    };
  };
  const mapper = createAgUiEventMapper({
    redactor: options.redactor,
    projection: options.projection,
    a2ui: options.a2ui,
    limits: options.limits,
    threadId: () => contextId,
    runId: () => taskId,
  });
  const artifacts = new Map<string, string>();
  let seq = 1;
  yield { eventId: "1", task: status("TASK_STATE_WORKING") };
  let terminal: A2ATask | undefined;
  try {
    const parsed = a2aMessageToAgUiInput(message, contextId, taskId, agUiLimits);
    const prepared = await prepareAgUiInput(parsed, authorization, options, agUiLimits, signal);
    const session = await options.sessionFactory({ threadId: contextId, authorization, signal, input: prepared });
    for await (const prismEvent of session.stream(prepared.messages, {
      ownership: authorization.ownership,
      redactor: options.redactor,
      signal,
      maxQueuedEvents: agUiLimits.maxQueuedEvents,
      overflow: "close",
    })) {
      if (prismEvent.type === "agent_finished") {
        terminal = status("TASK_STATE_COMPLETED");
        break;
      }
      if (prismEvent.type === "agent_suspended") {
        terminal = status("TASK_STATE_INPUT_REQUIRED");
        break;
      }
      if (prismEvent.type === "agent_denied") {
        terminal = failed("Run denied");
        break;
      }
      if (prismEvent.type === "error") {
        terminal = failed(prismEvent.error);
        break;
      }
      for (const agui of await mapper.map(prismEvent)) {
        const payload = mapAgUiToA2A(agui, taskId, contextId, a2aLimits, artifacts);
        if (payload) {
          seq += 1;
          yield { eventId: String(seq), ...payload };
        }
      }
    }
  } catch (error) {
    terminal = signal.aborted ? status("TASK_STATE_CANCELED") : failed(error);
  }
  if (!terminal) terminal = signal.aborted ? status("TASK_STATE_CANCELED") : failed("Run ended without a terminal event");
  const final: A2ATask = {
    ...terminal,
    ...(artifacts.size > 0 ? { artifacts: [...artifacts].map(([artifactId, text]) => ({ artifactId, parts: [{ text }] })) } : {}),
  };
  entry.terminal = final;
  seq += 1;
  yield { eventId: String(seq), task: final };
}

/** One AG-UI event → one bounded A2A task payload; text is also accumulated for the terminal task. */
function mapAgUiToA2A(
  event: AGUIEvent,
  taskId: string,
  contextId: string,
  limits: ResolvedA2ALimits,
  artifacts: Map<string, string>,
): A2ATaskEventPayload | undefined {
  const partText = (value: string): string => truncateUtf8(value, Math.min(limits.maxPartBytes, limits.maxEventBytes - 512));
  const artifactId = (prefix: string, id: string): string => `${prefix}-${truncateUtf8(id, 200)}`;
  const accumulate = (artifactId: string, value: string, replace: boolean): void => {
    if (replace) artifacts.set(artifactId, partText(value));
    else if (artifacts.size < limits.maxArtifacts || artifacts.has(artifactId)) {
      artifacts.set(artifactId, partText((artifacts.get(artifactId) ?? "") + value));
    }
  };
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CONTENT: {
      const id = artifactId("msg", event.messageId);
      accumulate(id, event.delta, false);
      return {
        artifactUpdate: { taskId, contextId, artifact: { artifactId: id, parts: [{ text: partText(event.delta) }] }, append: true },
      };
    }
    case EventType.ACTIVITY_SNAPSHOT: {
      const id = artifactId("activity", event.messageId);
      const text = JSON.stringify(event.content);
      accumulate(id, text, true);
      return { artifactUpdate: { taskId, contextId, artifact: { artifactId: id, parts: [{ text: partText(text) }] }, append: false } };
    }
    case EventType.ACTIVITY_DELTA: {
      const id = artifactId("activity", event.messageId);
      const text = JSON.stringify(event.patch);
      accumulate(id, text, false);
      return { artifactUpdate: { taskId, contextId, artifact: { artifactId: id, parts: [{ text: partText(text) }] }, append: true } };
    }
    case EventType.STATE_SNAPSHOT: {
      const text = JSON.stringify(event.snapshot);
      artifacts.set("state", partText(text));
      return { artifactUpdate: { taskId, contextId, artifact: { artifactId: "state", parts: [{ text: partText(text) }] }, append: false } };
    }
    default:
      return undefined;
  }
}

/** Durable replay for finished runs: prepend the resolved task, then replay source records. */
async function* durableSubscribe(
  id: string,
  afterEventId: string | undefined,
  authorization: A2AAuthorization,
  signal: AbortSignal,
  options: CreateAgUiA2AServerOptions,
  a2aLimits: ResolvedA2ALimits,
  A2AError: SupervisorA2AError,
): AsyncGenerator<A2ATaskEvent> {
  if (!options.durable) throw new A2AError("Task stream is unavailable", 503, "ERR_PRISM_A2A_TASK");
  const resolved = await options.durable.resolveTask({ id, authorization, signal });
  if (!resolved?.run.sessionId || resolved.task.id !== id) throw new A2AError("Task unavailable", 404, "ERR_PRISM_A2A_TASK");
  const mapper = createAgUiEventMapper({
    redactor: options.redactor,
    projection: options.projection,
    a2ui: options.a2ui,
    limits: options.limits,
    threadId: () => resolved.task.contextId,
    runId: () => id,
  });
  const artifacts = new Map<string, string>();
  yield { eventId: `${id}:task`, task: resolved.task };
  for await (const item of options.durable.source.subscribe({
    ownership: authorization.ownership,
    sessionId: resolved.run.sessionId,
    runId: resolved.run.runId,
    after: afterEventId,
    signal,
  })) {
    if (!item.record.redacted) throw new A2AError("Task event unavailable", 500, "ERR_PRISM_A2A_TASK");
    // A page may contain records appended after the terminal record (append-order sequences);
    // the stream contract ends at a terminal event, so stop there.
    if (isTerminalRecord(item.record.event)) break;
    for (const agui of await mapper.map(item.record.event)) {
      const payload = mapAgUiToA2A(agui, id, resolved.task.contextId, a2aLimits, artifacts);
      if (payload) yield { eventId: item.cursor, ...payload };
    }
  }
}

/** Live stream with cursor skip: event ids are "1".."N", so a numeric `afterEventId` skips seen events. */
async function* skipEvents(events: AsyncIterable<A2ATaskEvent>, afterEventId: string | undefined): AsyncGenerator<A2ATaskEvent> {
  if (afterEventId === undefined) {
    yield* events;
    return;
  }
  const threshold = Number(afterEventId);
  const numeric = Number.isSafeInteger(threshold) && threshold > 0;
  for await (const event of events) {
    const n = Number(event.eventId);
    if (!numeric || !Number.isSafeInteger(n) || n > threshold) yield event;
  }
}

async function* oneTask(eventId: string, task: A2ATask): AsyncGenerator<A2ATaskEvent> {
  yield { eventId, task };
}

function isTerminalRecord(event: AgentEvent): boolean {
  return event.type === "agent_finished" || event.type === "agent_denied" || event.type === "error";
}

function pageIndex(pageToken: string, A2AError: SupervisorA2AError): number {
  if (!/^i:\d+$/.test(pageToken)) throw new A2AError("Invalid A2A page token", 400, "ERR_PRISM_A2A_REQUEST");
  return Number(pageToken.slice(2));
}

/** A2A message → schema-validated AG-UI input; text parts become the user message, other parts stay in `forwardedProps` for `input.project`. */
function a2aMessageToAgUiInput(message: A2AMessage, threadId: string, runId: string, limits: ResolvedAgUiLimits): ParsedAgUiInput {
  const text = message.parts
    .filter((part): part is A2ATextPart => "text" in part)
    .map((part) => part.text)
    .join("\n");
  const nonText = message.parts.filter((part) => !("text" in part));
  const input: RunAgentInput = {
    threadId,
    runId,
    messages: text ? [{ id: sanitizeMessageId(message.messageId), role: "user", content: text }] : [],
    tools: [],
    context: [],
    state: {},
    // JSON round-trip drops undefined-valued keys (e.g. absent mediaType/filename) that the AG-UI bounded check rejects.
    forwardedProps:
      nonText.length > 0 ? { a2a: { messageId: message.messageId, parts: nonText.map((part) => JSON.parse(JSON.stringify(part))) } } : {},
  };
  return parseAgUiInput(input, limits);
}

async function prepareAgUiInput(
  parsed: ParsedAgUiInput,
  authorization: A2AAuthorization,
  options: CreateAgUiA2AServerOptions,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): Promise<AgUiPreparedInput> {
  if (!options.input?.project) {
    return { messages: defaultAgUiInput(parsed, limits), frontendTools: [], serverTools: [] };
  }
  const projected = await options.input.project({ request: parsed, authorization, signal, frontendTools: [] });
  if (!projected) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Input is unavailable");
  assertBoundedJson(projected.messages, limits.maxInputTextBytes, limits, "projected messages");
  return { messages: projected.messages, frontendTools: [], serverTools: [] };
}

/** A2A message ids are host strings; AG-UI ids must match the bounded `[A-Za-z0-9._:-]` shape. */
function sanitizeMessageId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._:-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return truncateUtf8(cleaned || "a2a-message", 128);
}

function failedTask(taskId: string, contextId: string, error: unknown): A2ATask {
  const text = (error instanceof Error ? error.message : String(error)).slice(0, 1024);
  return {
    id: taskId,
    contextId,
    status: { state: "TASK_STATE_FAILED", timestamp: new Date().toISOString() },
    ...(text ? { metadata: { error: text } } : {}),
  };
}
