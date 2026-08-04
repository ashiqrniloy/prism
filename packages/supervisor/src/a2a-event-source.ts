import type { AgentEventSource, AgentRunRef, DurableAgentEventRecord } from "@arnilo/prism";
import { A2AError } from "./errors.js";
import type { A2AAuthorization, A2ATask, A2ATaskEvent } from "./a2a-types.js";

export type A2ATaskEventPayload =
  | { readonly task: A2ATask }
  | {
      readonly statusUpdate: Extract<A2ATaskEvent, { readonly statusUpdate: unknown }>["statusUpdate"];
    }
  | {
      readonly artifactUpdate: Extract<A2ATaskEvent, { readonly artifactUpdate: unknown }>["artifactUpdate"];
    };

export interface A2AAgentEventTask {
  readonly task: A2ATask;
  readonly run: AgentRunRef;
}

export interface A2AAgentEventSourceOptions {
  readonly source: AgentEventSource;
  /** Resolves only host-owned task state and its exact Prism run. */
  readonly resolveTask: (input: {
    readonly id: string;
    readonly authorization: A2AAuthorization;
    readonly signal: AbortSignal;
  }) => A2AAgentEventTask | undefined | Promise<A2AAgentEventTask | undefined>;
  /** Maps at most one durable Prism record to one A2A update. Event IDs stay source-owned cursors. */
  readonly map: (input: {
    readonly record: DurableAgentEventRecord;
    readonly task: A2ATask;
    readonly authorization: A2AAuthorization;
  }) => A2ATaskEventPayload | undefined | Promise<A2ATaskEventPayload | undefined>;
}

export interface A2AAgentEventSource {
  subscribe(input: {
    readonly id: string;
    readonly afterEventId?: string;
    readonly authorization: A2AAuthorization;
    readonly signal: AbortSignal;
  }): AsyncIterable<A2ATaskEvent>;
}

/** Host-selected durable task stream over AgentEventSource; owns no task database or worker. */
export function createA2AAgentEventSource(options: A2AAgentEventSourceOptions): A2AAgentEventSource {
  return {
    subscribe(input) {
      return {
        async *[Symbol.asyncIterator]() {
          input.signal.throwIfAborted();
          const resolved = await options.resolveTask(input);
          if (!resolved?.run.sessionId || resolved.task.id !== input.id) {
            throw new A2AError("Task unavailable", 404, "ERR_PRISM_A2A_TASK");
          }
          let first = true;
          for await (const item of options.source.subscribe({
            ownership: input.authorization.ownership,
            sessionId: resolved.run.sessionId,
            runId: resolved.run.runId,
            after: input.afterEventId,
            signal: input.signal,
          })) {
            if (!item.record.redacted) throw new A2AError("Task event unavailable", 500, "ERR_PRISM_A2A_TASK");
            const payload = await options.map({ record: item.record, task: resolved.task, authorization: input.authorization });
            if (!payload) continue;
            if (first && input.afterEventId === undefined && !("task" in payload)) {
              throw new A2AError("Initial task event required", 500, "ERR_PRISM_A2A_TASK");
            }
            first = false;
            yield { eventId: item.cursor, ...payload } as A2ATaskEvent;
          }
          if (first && input.afterEventId === undefined) {
            throw new A2AError("Initial task event required", 500, "ERR_PRISM_A2A_TASK");
          }
        },
      };
    },
  };
}
