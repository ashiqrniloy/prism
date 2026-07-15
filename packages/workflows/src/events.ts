import {
  createEventMultiplexer,
  type AgentEvent,
  type AgentSession,
} from "@arnilo/prism";
import { DEFAULT_EVENT_BUFFER } from "./limits.js";
import type {
  WorkflowEvent,
  WorkflowEventBus,
  WorkflowEventInput,
  WorkflowEventMergeOptions,
} from "./types.js";
import { nowIso } from "./util.js";

/** Workflow event facade over Prism's generic bounded event multiplexer. */
export function createWorkflowEventBus(options: WorkflowEventMergeOptions): WorkflowEventBus {
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

  function observeAgentNode(input: {
    readonly nodeId: string;
    readonly session: AgentSession;
  }): () => void {
    return mux.observe(input.session.subscribe(options.subscribeOptions), (event: AgentEvent) => ({
      type: "agent_event",
      workflowId: options.workflowId,
      runId: options.runId,
      nodeId: input.nodeId,
      event,
      timestamp: nowIso(),
      sequence: nextSequence(),
    }));
  }

  return {
    emit,
    subscribe: mux.subscribe,
    observeAgentNode,
    close: mux.close,
    get sequence() {
      return sequence;
    },
  };
}
