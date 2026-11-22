import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ContentBlock,
  Decision,
  ErrorInfo,
  EventOrigin,
  HostUi,
  HostUiRequest,
  HostUiResponse,
  JsonObject,
  Message,
  PendingDecision,
  RunOptions,
  RunResult,
  Session,
} from "@arnilo/prism";
import type { A2ATransport } from "./connect.js";
import {
  type A2AMessage,
  type A2APart,
  type A2AStreamResponse,
  type A2ATaskState,
  decisionsMessage,
  INTERRUPTED_STATES,
  parseA2AStreamResponse,
  parseA2ATask,
  partsText,
  readPendingParts,
  TERMINAL_STATES,
} from "./codec.js";
import { A2AClientError, A2AError } from "./errors.js";
import type { ResolvedA2ALimits } from "./limits.js";

type Input = string | Message | readonly Message[];
type SubscribeArgs = NonNullable<Parameters<Session["subscribe"]>[0]>;

/** Per context id, shared by every proxy session opened on it in this process. */
export interface A2AContextState {
  readonly contextId: string;
  /** The task waiting for decisions, if any. */
  task?: { readonly id: string; readonly pending: readonly PendingDecision[] };
  /** The local transcript: inputs sent and replies received. A2A keeps the peer's history on the peer. */
  readonly messages: Message[];
}

export interface A2AProxyEnv {
  readonly transport: A2ATransport;
  readonly origin: EventOrigin;
  readonly streaming: boolean;
  readonly limits: ResolvedA2ALimits;
  readonly scrub: (text: string) => string;
  readonly ui?: HostUi;
}

export interface A2ASessionHandle {
  readonly session: Session;
  dispose(): Promise<void>;
}

const DEFAULT_QUEUE = 1024;
const POLL_MS = 1_000;
const CANCEL_TIMEOUT_MS = 5_000;

const unsupported = (what: string): A2AClientError => new A2AClientError("a2a_unsupported", `${what} is not supported on an A2A session`);

interface Final {
  readonly state: A2ATaskState;
  readonly message?: A2AMessage;
}

interface ActiveRun {
  readonly controller: AbortController;
  taskId?: string;
  final?: Final;
  canceled: boolean;
  timedOut: boolean;
}

/** A bounded subscriber queue; a full queue ends the subscription. */
function subscriber(maxQueued: number, onReturn: () => void) {
  const queue: AgentEvent[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  return {
    push(event: AgentEvent) {
      if (ended) return;
      if (queue.length >= maxQueued) ended = true;
      else queue.push(event);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    get ended() {
      return ended;
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
      try {
        while (true) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      } finally {
        ended = true;
        onReturn();
      }
    },
  };
}

type Subscriber = ReturnType<typeof subscriber> & { readonly acrossRuns: boolean };

/** Maps a Prism input to the parts of one A2A user message. Media must be inline base64. */
function inputParts(input: Input, maxParts: number): { parts: A2APart[]; message: Message } {
  if (typeof input === "string") return { parts: [{ text: input }], message: { role: "user", content: [{ type: "text", text: input }] } };
  const messages: readonly Message[] = Array.isArray(input) ? input : [input as Message];
  const parts: A2APart[] = [];
  const content: ContentBlock[] = [];
  for (const message of messages) {
    if (message.role !== "user") throw new A2AClientError("a2a_unsupported", "only user messages can be sent to an A2A agent");
    for (const block of message.content) {
      content.push(block);
      if (block.type === "text") parts.push({ text: block.text });
      else if (block.type === "image" && typeof block.data === "string") {
        parts.push({ raw: block.data, mediaType: block.mimeType, ...(block.name ? { filename: block.name } : {}) });
      } else if ((block.type === "file" || block.type === "document" || block.type === "audio") && typeof block.data === "string") {
        parts.push({ raw: block.data, mediaType: block.mediaType, ...(block.name ? { filename: block.name } : {}) });
      } else throw new A2AClientError("a2a_unsupported", `a ${block.type} block cannot be sent to an A2A agent`);
    }
  }
  if (parts.length === 0 || parts.length > maxParts) throw new A2AClientError("a2a_unsupported", "input must hold 1 to maxParts parts");
  return { parts, message: { role: "user", content } };
}

function requestFor(sessionId: string, pending: PendingDecision): HostUiRequest {
  if (pending.kind === "elicitation") {
    return {
      kind: "input",
      sessionId,
      title: pending.reason,
      ...(pending.elicitationSchema ? { detail: JSON.stringify(pending.elicitationSchema) } : {}),
    };
  }
  return { kind: "confirm", sessionId, title: `Approve ${pending.scope.toolName ?? "tool call"}`, detail: pending.reason };
}

/** A host answer as a decision, or `undefined` to leave it pending (the run then suspends). */
function decisionFrom(pending: PendingDecision, answer: HostUiResponse): Decision | undefined {
  if (answer.status === "unavailable") return undefined;
  if (pending.kind === "elicitation") {
    if (answer.status !== "answered" || typeof answer.value !== "string") return undefined;
    try {
      const parsed: unknown = JSON.parse(answer.value);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      return { approvalId: pending.approvalId, outcome: "allow_once", elicitation: parsed as JsonObject };
    } catch {
      return undefined;
    }
  }
  if (answer.status === "dismissed") return { approvalId: pending.approvalId, outcome: "reject_once" };
  if (typeof answer.value !== "boolean") return undefined;
  return { approvalId: pending.approvalId, outcome: answer.value ? "allow_once" : "reject_once" };
}

/**
 * The proxy `Session` for one A2A context. `run`/`stream` send one message and follow the task it starts;
 * `resume` answers a `TASK_STATE_INPUT_REQUIRED` task; `abort` sends `CancelTask`. Members with no A2A
 * equivalent throw `A2AClientError` (`a2a_unsupported`).
 */
export function createA2ASession(env: A2AProxyEnv, state: A2AContextState, onClose: () => void): A2ASessionHandle {
  const { transport, limits, scrub } = env;
  const sessionId = state.contextId;
  const subscribers = new Set<Subscriber>();
  let active: ActiveRun | undefined;
  let closed = false;

  const closeSubscribers = (onlyRunScoped: boolean) => {
    for (const entry of [...subscribers]) {
      if (onlyRunScoped && entry.acrossRuns) continue;
      entry.end();
      subscribers.delete(entry);
    }
  };

  const tag = (event: Record<string, unknown>): AgentEvent => ({ ...event, origin: env.origin }) as unknown as AgentEvent;

  async function cancelRemote(taskId: string): Promise<void> {
    await transport.call("CancelTask", { id: taskId }, AbortSignal.timeout(CANCEL_TIMEOUT_MS)).catch(() => undefined);
  }

  /** Re-reads a task whose stream ended before a final state: `GetTask`, then `SubscribeToTask` (or a poll). */
  async function* recover(taskId: string, signal: AbortSignal): AsyncGenerator<A2AStreamResponse> {
    const task = parseA2ATask(await transport.call("GetTask", { id: taskId }, signal), limits.maxParts);
    yield { task };
    if (TERMINAL_STATES.has(task.status.state) || INTERRUPTED_STATES.has(task.status.state)) return;
    if (env.streaming) {
      try {
        yield* transport.stream("SubscribeToTask", { id: taskId }, signal);
      } catch (error) {
        // The task ended between the two calls: the next round reads it with `GetTask`.
        if (!(error instanceof A2AError && error.errorName === "unsupportedOperation")) throw error;
      }
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  function send(message: A2AMessage, signal: AbortSignal): AsyncIterable<A2AStreamResponse> {
    const params = { message: message as unknown as JsonObject };
    if (env.streaming) return transport.stream("SendStreamingMessage", params, signal);
    return (async function* () {
      const result = await transport.call("SendMessage", params, signal);
      const value = result !== null && typeof result === "object" && "status" in result && "id" in result ? { task: result } : result;
      yield parseA2AStreamResponse(value, limits.maxParts);
    })();
  }

  async function* drive(
    kickoff: { message: A2AMessage; user?: Message; resumed: boolean },
    options: RunOptions | undefined,
    sink: (result: RunResult) => void,
  ): AsyncGenerator<AgentEvent> {
    if (closed) throw new A2AClientError("a2a_unsupported", "the session is closed");
    if (active) throw new A2AClientError("a2a_busy", "session already has a run in progress");
    const run: ActiveRun = { controller: new AbortController(), canceled: false, timedOut: false };
    active = run;
    const signal = run.controller.signal;
    const external = options?.signal;
    const onExternalAbort = () => {
      run.canceled = true;
      run.controller.abort(external?.reason);
    };
    if (external?.aborted) onExternalAbort();
    else external?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      run.timedOut = true;
      run.controller.abort(new Error("A2A task reached taskTimeoutMs"));
    }, limits.taskTimeoutMs);

    const appended: Message[] = kickoff.user ? [kickoff.user] : [];
    if (kickoff.user) state.messages.push(kickoff.user);
    let text = "";
    let runId: string | undefined;
    let failure: ErrorInfo | undefined;
    const emit = (event: AgentEvent): AgentEvent => {
      for (const entry of subscribers) entry.push(event);
      return event;
    };
    const appendText = (chunk: string): string => {
      const clean = scrub(chunk);
      if (text.length + clean.length <= limits.maxResponseBytes) text += clean;
      return clean;
    };

    try {
      let frames: AsyncIterable<A2AStreamResponse> = send(kickoff.message, signal);
      while (true) {
        for await (const frame of frames) {
          if ("task" in frame) {
            run.taskId ??= frame.task.id;
            const status = frame.task.status;
            if ((TERMINAL_STATES.has(status.state) || INTERRUPTED_STATES.has(status.state)) && text.length === 0) {
              for (const artifact of frame.task.artifacts ?? []) appendText(partsText(artifact.parts));
            }
            if (TERMINAL_STATES.has(status.state) || INTERRUPTED_STATES.has(status.state)) {
              run.final = { state: status.state, ...(status.message ? { message: status.message } : {}) };
            }
          } else if ("statusUpdate" in frame) {
            run.taskId ??= frame.statusUpdate.taskId;
            const status = frame.statusUpdate.status;
            if (TERMINAL_STATES.has(status.state) || INTERRUPTED_STATES.has(status.state)) {
              run.final = { state: status.state, ...(status.message ? { message: status.message } : {}) };
            }
          } else if ("message" in frame) {
            // A message-only reply: the peer answered without a task.
            appendText(partsText(frame.message.parts));
            run.final = { state: "TASK_STATE_COMPLETED" };
          }
          if (runId === undefined) {
            runId = run.taskId ?? `a2a-message-${randomUUID()}`;
            yield emit(tag({ type: "run.started", sessionId, runId, ...(kickoff.resumed ? { resumed: true } : {}) }));
          }
          if ("artifactUpdate" in frame) {
            const chunk = appendText(partsText(frame.artifactUpdate.artifact.parts));
            if (chunk.length > 0) yield emit(tag({ type: "message.delta", sessionId, runId, content: { type: "text", text: chunk } }));
          }
          if (run.final) break;
        }
        if (run.final?.state === "TASK_STATE_INPUT_REQUIRED" && env.ui && run.taskId) {
          const decisions = await askHost(env.ui, sessionId, readPendingParts(run.final.message));
          if (decisions) {
            run.final = undefined;
            frames = send(decisionsMessage(randomUUID(), run.taskId, sessionId, decisions), signal);
            continue;
          }
        }
        if (run.final) break;
        if (!run.taskId) throw new A2AClientError("a2a_invalid_response", "The peer ended the response before naming a task");
        signal.throwIfAborted();
        frames = recover(run.taskId, signal);
      }
    } catch (error) {
      if (run.canceled || run.timedOut) {
        if (run.taskId) await cancelRemote(run.taskId);
      } else if (error instanceof A2AError) {
        failure = { name: "A2AError", code: error.code, message: scrub(error.message) };
      } else if (error instanceof A2AClientError) {
        failure = { name: "A2AClientError", code: error.code, message: scrub(error.message) };
      } else {
        failure = { name: "A2AClientError", code: "a2a_transport", message: "A2A request failed" };
      }
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    }

    runId ??= run.taskId ?? `a2a-failed-${randomUUID()}`;
    let message: Message | undefined;
    if (text.length > 0) {
      message = { role: "assistant", content: [{ type: "text", text }] };
      appended.push(message);
      state.messages.push(message);
      yield emit(tag({ type: "message.completed", sessionId, runId, message }));
    }
    const base = { sessionId, runId, text, content: message?.content ?? [], ...(message ? { message } : {}), messages: appended };
    let result: RunResult;
    state.task = undefined;
    const finalState = run.canceled ? "TASK_STATE_CANCELED" : run.timedOut || failure ? undefined : run.final?.state;
    const statusText = run.final?.message ? scrub(partsText(run.final.message.parts)).slice(0, 2048) : "";
    if (finalState === "TASK_STATE_COMPLETED") {
      result = { ...base, status: "completed" };
      yield emit(tag({ type: "run.completed", sessionId, runId, status: "completed" }));
    } else if (finalState === "TASK_STATE_REJECTED") {
      result = { ...base, status: "stopped", stopReason: "denied" };
      yield emit(tag({ type: "run.completed", sessionId, runId, status: "stopped", stopReason: "denied" }));
    } else if (finalState === "TASK_STATE_CANCELED") {
      const error: ErrorInfo = { name: "AbortError", code: "aborted", message: "The A2A task was canceled" };
      result = { ...base, status: "aborted", error, abortReason: "aborted" };
      yield emit(tag({ type: "run.failed", sessionId, runId, error }));
    } else if (finalState === "TASK_STATE_INPUT_REQUIRED" && readPendingParts(run.final?.message).length > 0) {
      const pending = readPendingParts(run.final?.message).map((decision) => ({ ...decision, reason: scrub(decision.reason) }));
      state.task = { id: run.taskId as string, pending };
      const first = pending[0] as PendingDecision;
      result = { ...base, status: "suspended", pending };
      yield emit(
        tag({
          type: "run.suspended",
          sessionId,
          runId,
          version: 1,
          interruption: {
            kind: first.kind === "elicitation" ? "elicitation" : "tool_approval",
            reason: first.reason,
            ...(first.scope.toolName ? { toolName: first.scope.toolName } : {}),
            pendingDecisions: pending,
          },
        }),
      );
    } else {
      const error: ErrorInfo =
        failure ??
        (run.timedOut
          ? { name: "A2AClientError", code: "a2a_timeout", message: "The A2A task reached taskTimeoutMs" }
          : finalState === "TASK_STATE_AUTH_REQUIRED"
            ? { name: "A2AClientError", code: "a2a_auth_required", message: "The A2A agent requires more authentication" }
            : finalState === "TASK_STATE_INPUT_REQUIRED"
              ? { name: "A2AClientError", code: "a2a_invalid_response", message: "The A2A task asked for input it did not describe" }
              : { name: "A2AClientError", code: "a2a_task_failed", message: statusText || "The A2A task failed" });
      result = { ...base, status: "failed", error };
      yield emit(tag({ type: "run.failed", sessionId, runId, error }));
    }
    if (active === run) active = undefined;
    closeSubscribers(true);
    sink(result);
  }

  /** Wraps `drive` so a consumer that stops early cancels the remote task. */
  function owned(
    kickoff: Parameters<typeof drive>[0],
    options: RunOptions | undefined,
    sink: (result: RunResult) => void,
  ): AsyncGenerator<AgentEvent> {
    const inner = drive(kickoff, options, sink);
    let done = false;
    return (async function* () {
      try {
        for await (const event of inner) yield event;
        done = true;
      } finally {
        if (!done && active) {
          const run = active;
          run.canceled = true;
          run.controller.abort(new Error("A2A stream consumer stopped"));
          // Drain so the remote task is canceled and the run settles.
          for await (const _ of inner) {
            // discard
          }
        }
      }
    })();
  }

  function sendInput(input: Input, options: RunOptions | undefined, sink: (result: RunResult) => void): AsyncGenerator<AgentEvent> {
    const { parts, message } = inputParts(input, limits.maxParts);
    return owned(
      { message: { messageId: randomUUID(), role: "ROLE_USER", contextId: sessionId, parts }, user: message, resumed: false },
      options,
      sink,
    );
  }

  const session: Session = {
    id: sessionId,
    leafId: undefined,
    async run(input: Input, options?: RunOptions) {
      let result: RunResult | undefined;
      for await (const _ of sendInput(input, options, (value) => {
        result = value;
      })) {
        // events go to subscribers
      }
      return result as RunResult;
    },
    stream: (input: Input, options) => sendInput(input, options, () => {}),
    resume(decisions: readonly Decision[], options) {
      const task = state.task;
      if (!task) throw new A2AClientError("a2a_no_pending_task", "no A2A task in this context is waiting for decisions");
      return owned({ message: decisionsMessage(randomUUID(), task.id, sessionId, decisions), resumed: true }, options, () => {});
    },
    async continue() {
      throw unsupported("continue()");
    },
    continueStream() {
      throw unsupported("continueStream()");
    },
    steer() {
      throw unsupported("steer()");
    },
    abort() {
      if (!active) return;
      active.canceled = true;
      active.controller.abort(new Error("A2A session aborted"));
    },
    subscribe(options?: SubscribeArgs) {
      const entry: Subscriber = Object.assign(
        subscriber(options?.maxQueuedEvents ?? DEFAULT_QUEUE, () => {
          subscribers.delete(entry);
        }),
        { acrossRuns: options?.acrossRuns === true },
      );
      subscribers.add(entry);
      return entry;
    },
    async close() {
      closed = true;
      closeSubscribers(false);
      onClose();
    },
    async messages() {
      return [...state.messages];
    },
    async entries() {
      throw unsupported("entries()");
    },
    async compact() {
      throw unsupported("compact()");
    },
    async checkout() {
      throw unsupported("checkout()");
    },
    async fork() {
      throw unsupported("fork()");
    },
    contextMeter() {
      throw unsupported("contextMeter()");
    },
    async limits() {
      throw unsupported("limits()");
    },
  };

  return {
    session,
    async dispose() {
      session.abort();
      await session.close();
    },
  };
}

async function askHost(ui: HostUi, sessionId: string, pending: readonly PendingDecision[]): Promise<Decision[] | undefined> {
  if (pending.length === 0) return undefined;
  const decisions: Decision[] = [];
  for (const decision of pending) {
    let answer: HostUiResponse;
    try {
      answer = await ui.request(requestFor(sessionId, decision));
    } catch {
      return undefined;
    }
    const mapped = decisionFrom(decision, answer);
    if (!mapped) return undefined;
    decisions.push(mapped);
  }
  return decisions;
}
