import { type AgentEvent, type Session } from "@arnilo/prism";
import { createEventMultiplexer } from "./event-multiplexer.js";
import { DEFAULT_EVENT_BUFFER } from "./limits.js";
import type { WorkflowStreamEvent } from "./parent-session.js";
import type { WorkflowEvent, WorkflowEventInput, WorkflowEventMergeOptions, WorkflowTransitionChannel } from "./types.js";
import { nowIso } from "./util.js";

/** Workflow event facade over Prism's generic bounded event multiplexer. */
export function createWorkflowTransitionChannel(options: WorkflowEventMergeOptions): WorkflowTransitionChannel {
  // Close on overflow: a merged stream with gaps would misrepresent the run, so the consumer is told once.
  const transitions = createEventMultiplexer<WorkflowStreamEvent>({
    maxQueuedEvents: options.maxQueuedEvents ?? DEFAULT_EVENT_BUFFER,
    overflow: "close",
    overflowEvent: ({ droppedEvents, maxQueuedEvents }) => ({
      type: "package.event",
      package: "@arnilo/prism-extensions/workflows",
      name: "workflow.notice",
      sessionId: options.parentSessionId ?? "",
      runId: options.runId,
      data: { workflowRunId: options.runId, status: "stream_overflow", reason: "slow_consumer", droppedEvents, maxQueuedEvents },
    }),
  });
  // Active child sessions per node (fan-out nodes hold several); one subscription feeds both channels.
  const active = new Map<string, Set<Session>>();
  let sequence = 0;
  const nextSequence = () => ++sequence;
  const mux = createEventMultiplexer<WorkflowEvent>({
    maxQueuedEvents: options.maxQueuedEvents ?? DEFAULT_EVENT_BUFFER,
    overflow: options.overflow ?? "drop_oldest",
    signal: options.signal,
    compare: (a, b) => {
      if (a.sequence !== b.sequence) return a.sequence - b.sequence;
      const aNode = "nodeId" in a ? a.nodeId : "";
      const bNode = "nodeId" in b ? b.nodeId : "";
      return aNode.localeCompare(bNode);
    },
    overflowEvent: ({ droppedEvents, maxQueuedEvents }) => ({
      type: "workflow_event_overflow",
      workflowId: options.workflowId,
      runId: options.runId,
      droppedEvents,
      maxQueuedEvents,
      timestamp: nowIso(),
      sequence: nextSequence(),
    }),
  });

  function emit(event: WorkflowEventInput): void {
    const eventSequence = event.sequence ?? nextSequence();
    sequence = Math.max(sequence, eventSequence);
    mux.publish({ ...event, sequence: eventSequence } as WorkflowEvent);
  }

  function observeAgentNode(input: { readonly nodeId: string; readonly session: Session }): () => void {
    const { nodeId, session } = input;
    let sessions = active.get(nodeId);
    if (!sessions) active.set(nodeId, (sessions = new Set()));
    sessions.add(session);
    async function* tee(): AsyncGenerator<AgentEvent> {
      for await (const event of session.subscribe(options.subscribeOptions)) {
        transitions.publish(event);
        yield event;
      }
    }
    const stop = mux.observe(tee(), (event: AgentEvent) => ({
      type: "agent_event",
      workflowId: options.workflowId,
      runId: options.runId,
      nodeId: input.nodeId,
      event,
      timestamp: nowIso(),
      sequence: nextSequence(),
    }));
    return () => {
      stop();
      sessions.delete(session);
      if (sessions.size === 0 && active.get(nodeId) === sessions) active.delete(nodeId);
    };
  }

  function steer(nodeId: string, text: string): boolean {
    let steered = false;
    for (const session of [...(active.get(nodeId) ?? [])]) {
      try {
        session.steer(text);
        steered = true;
      } catch {
        // Idle between open and run, or already finishing: not steerable.
      }
    }
    return steered;
  }

  function abort(reason?: unknown): void {
    for (const sessions of active.values()) for (const session of sessions) session.abort(reason);
  }

  return {
    steer,
    abort,
    emit,
    subscribe: mux.subscribe,
    observeAgentNode,
    stream: transitions.subscribe,
    publish: transitions.publish,
    close() {
      mux.close();
      transitions.close();
    },
    get sequence() {
      return sequence;
    },
  };
}
