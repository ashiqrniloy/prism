import { type AGUIEvent, EventSchemas, EventType } from "@ag-ui/core";
import type { SecretRedactor } from "@arnilo/prism";
import type { A2AClient, A2AMessage, A2APart, A2AStreamEvent, A2ATask } from "@arnilo/prism-core/runtime/supervisor";
import { AgUiError } from "./errors.js";
import type { ParsedAgUiInput } from "./input.js";
import type { AgUiAuthorization } from "./types.js";

export type AgUiA2ASelection =
  | { readonly kind: "start"; readonly message: A2AMessage }
  | { readonly kind: "follow"; readonly taskId: string; readonly afterEventId?: string };

export interface AgUiA2ASelectionInput<Authorization> {
  readonly request: ParsedAgUiInput;
  readonly authorization: Authorization;
  readonly signal: AbortSignal;
}

export interface AgUiA2APartProjectionInput<Authorization> {
  readonly part: A2APart;
  readonly taskId: string;
  readonly contextId: string;
  readonly artifactId?: string;
  readonly authorization: Authorization;
}

export interface AgUiA2AAdapter<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  stream(input: AgUiA2ASelectionInput<Authorization> & { readonly threadId: string; readonly runId: string }): AsyncIterable<AGUIEvent>;
}

export interface CreateAgUiA2AAdapterOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  /** Existing client must have exact origin/card verification configured before it reaches this adapter. */
  readonly client: A2AClient;
  /** Host selects either a new remote message or an owner-checked persisted remote task. */
  readonly select: (input: AgUiA2ASelectionInput<Authorization>) => AgUiA2ASelection | Promise<AgUiA2ASelection>;
  /** Persist exact host run/thread ↔ verified remote task correlation before it is rendered. */
  readonly correlate: (input: {
    readonly task: A2ATask;
    readonly threadId: string;
    readonly runId: string;
    readonly authorization: Authorization;
    readonly signal: AbortSignal;
  }) => void | Promise<void>;
  /** Opt-in for non-text A2A parts such as tool/A2UI data. Output is schema-validated and bounded by handler SSE caps. */
  readonly projectPart?: (input: AgUiA2APartProjectionInput<Authorization>) => readonly AGUIEvent[] | undefined;
  readonly redactor?: SecretRedactor;
}

/** Maps one verified remote A2A task stream into standard AG-UI events; no local agent/session loop is created. */
export function createAgUiA2AAdapter<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  options: CreateAgUiA2AAdapterOptions<Authorization>,
): AgUiA2AAdapter<Authorization> {
  return {
    async *stream(input) {
      const selected = await options.select(input);
      const source = await selectSource(options.client, selected, input.signal);
      const seen = new Set<string>();
      let terminal = false;
      yield agui({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
      for await (const event of source) {
        if (seen.has(event.eventId)) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Duplicate A2A stream event");
        seen.add(event.eventId);
        if ("task" in event) await options.correlate({ task: event.task, ...input });
        for (const output of mapA2AEvent(event, input, options)) yield output;
        const state = taskState(event);
        if (!state) continue;
        if (state === "TASK_STATE_COMPLETED") {
          terminal = true;
          yield agui({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId, outcome: { type: "success" } });
          return;
        }
        if (state === "TASK_STATE_FAILED" || state === "TASK_STATE_CANCELED" || state === "TASK_STATE_REJECTED") {
          terminal = true;
          yield agui({ type: EventType.RUN_ERROR, message: `Remote A2A task ${state.toLowerCase()}`, code: "ERR_PRISM_A2A_REMOTE" });
          return;
        }
        if (state === "TASK_STATE_INPUT_REQUIRED" || state === "TASK_STATE_AUTH_REQUIRED") {
          terminal = true;
          yield agui({
            type: EventType.RUN_ERROR,
            message: `Remote A2A task requires host continuation: ${state}`,
            code: "ERR_PRISM_A2A_INTERRUPTED",
          });
          return;
        }
      }
      if (!terminal) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "Remote A2A stream ended before terminal state");
    },
  };
}

async function selectSource(client: A2AClient, selected: AgUiA2ASelection, signal: AbortSignal): Promise<AsyncIterable<A2AStreamEvent>> {
  if (selected.kind === "follow") return client.subscribeToTask(selected.taskId, { afterEventId: selected.afterEventId, signal });
  const card = await client.getCard({ signal });
  if (card.capabilities.streaming) return client.streamMessage(selected.message, { signal });
  const task = await client.sendMessage(selected.message, { signal, returnImmediately: false });
  return (async function* () {
    yield { eventId: `a2a-fallback:${task.id}`, task };
  })();
}

function* mapA2AEvent<Authorization extends AgUiAuthorization>(
  event: A2AStreamEvent,
  input: AgUiA2ASelectionInput<Authorization> & { readonly threadId: string; readonly runId: string },
  options: CreateAgUiA2AAdapterOptions<Authorization>,
): Generator<AGUIEvent> {
  if ("message" in event) {
    yield* messageEvents(event.message, input.runId, options.redactor);
    return;
  }
  if ("task" in event) {
    yield activity(event.task.id, event.task.contextId, event.task.status.state);
    if (event.task.status.message) yield* messageEvents(event.task.status.message, event.task.id, options.redactor);
    for (const artifact of event.task.artifacts ?? [])
      for (const part of artifact.parts) yield* projectPart(part, event.task, artifact.artifactId, input.authorization, options);
    return;
  }
  if ("statusUpdate" in event) {
    yield activity(event.statusUpdate.taskId, event.statusUpdate.contextId, event.statusUpdate.status.state);
    if (event.statusUpdate.status.message)
      yield* messageEvents(event.statusUpdate.status.message, event.statusUpdate.taskId, options.redactor);
    return;
  }
  yield activity(event.artifactUpdate.taskId, event.artifactUpdate.contextId, "artifact");
  for (const part of event.artifactUpdate.artifact.parts)
    yield* projectPart(
      part,
      { id: event.artifactUpdate.taskId, contextId: event.artifactUpdate.contextId } as A2ATask,
      event.artifactUpdate.artifact.artifactId,
      input.authorization,
      options,
    );
}

function* projectPart<Authorization extends AgUiAuthorization>(
  part: A2APart,
  task: A2ATask,
  artifactId: string | undefined,
  authorization: Authorization,
  options: CreateAgUiA2AAdapterOptions<Authorization>,
): Generator<AGUIEvent> {
  if ("text" in part && typeof part.text === "string") {
    yield* textEvents(`${task.id}:${artifactId ?? "message"}`, part.text, options.redactor);
    return;
  }
  const projected = options.projectPart?.({ part, taskId: task.id, contextId: task.contextId, artifactId, authorization });
  for (const value of projected ?? []) yield agui(value);
}

function* messageEvents(message: A2AMessage, fallbackId: string, redactor: SecretRedactor | undefined): Generator<AGUIEvent> {
  for (const part of message.parts)
    if ("text" in part && typeof part.text === "string") yield* textEvents(message.messageId || fallbackId, part.text, redactor);
}

function* textEvents(id: string, text: string, redactor: SecretRedactor | undefined): Generator<AGUIEvent> {
  const safe = redactor?.redact(text) ?? text;
  if (!safe) return;
  const messageId = truncate(id, 256);
  yield agui({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
  yield agui({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: truncate(safe, 64 * 1024) });
  yield agui({ type: EventType.TEXT_MESSAGE_END, messageId });
}

function activity(taskId: string, contextId: string, state: string): AGUIEvent {
  return agui({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: `a2a:${truncate(taskId, 128)}`,
    activityType: "a2a",
    content: { taskId: truncate(taskId, 256), contextId: truncate(contextId, 256), state: truncate(state, 128) },
    replace: true,
  });
}

function taskState(event: A2AStreamEvent): string | undefined {
  if ("task" in event) return event.task.status.state;
  if ("statusUpdate" in event) return event.statusUpdate.status.state;
  return undefined;
}

function agui(value: unknown): AGUIEvent {
  const parsed = EventSchemas.safeParse(value);
  if (!parsed.success) throw new AgUiError("ERR_PRISM_AG_UI_EVENT", "A2A mapping produced an invalid AG-UI event");
  return parsed.data;
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = "";
  for (const char of value) {
    if (Buffer.byteLength(output + char, "utf8") > maxBytes - 3) break;
    output += char;
  }
  return `${output}…`;
}
