import type { AgentEvent } from "@arnilo/prism";
import {
  createInstrumentationParts,
  type OpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentationOptions,
  type PrismSpan,
  spanKey as key,
} from "./instrumentation.js";
import type { WorkflowEvent } from "@arnilo/prism-workflows";

/** Workflow spans built on the agent instrumentation in `./instrumentation.js`. */
export interface WorkflowInstrumentation extends OpenTelemetryInstrumentation {
  handleWorkflowEvent(event: WorkflowEvent): void;
  attachWorkflow(bus: { subscribe(): AsyncIterable<WorkflowEvent> } | AsyncIterable<WorkflowEvent>): () => void;
}

export function createWorkflowInstrumentation(options: OpenTelemetryInstrumentationOptions = {}): WorkflowInstrumentation {
  const { instrumentation, tracker } = createInstrumentationParts(options);
  const { enabled, tracer, meter, active, startedAt, safe, finish, finishWhere, rememberTrace, linkSession, startChild } = tracker;
  const workflowDuration = meter?.createHistogram("prism.workflow.duration", { description: "Workflow execution duration", unit: "s" });
  const handleAgentEvent = instrumentation.handleAgentEvent;

  const handleWorkflowEvent = (event: WorkflowEvent) => {
    if (!enabled) return;
    switch (event.type) {
      case "workflow_started":
        safe(() => {
          if (!tracer) return;
          const spanKey = key("workflow", event.runId);
          finish(spanKey, "error", "Duplicate workflow start");
          const parentContext =
            typeof options.parentContext === "function" ? options.parentContext(event as unknown as AgentEvent) : options.parentContext;
          const span: PrismSpan = tracer.startSpan(`invoke_workflow ${event.workflowId}`, {
            kind: "internal",
            parentContext,
            attributes: {
              "gen_ai.operation.name": "invoke_workflow",
              "prism.workflow.id": event.workflowId,
              "prism.run_id": event.runId,
            },
          });
          active.set(spanKey, { span, sessionId: event.runId, runId: event.runId });
          startedAt.set(event.runId, Date.now());
          rememberTrace(event.runId, span);
        });
        break;
      case "workflow_finished":
        safe(() => {
          finishWhere(
            (item) => item.runId === event.runId && item !== active.get(key("workflow", event.runId)),
            "Workflow finished with child span open",
          );
          finish(key("workflow", event.runId), event.status === "succeeded" ? "ok" : "error");
          const start = startedAt.get(event.runId);
          startedAt.delete(event.runId);
          if (start !== undefined) {
            workflowDuration?.record((Date.now() - start) / 1000, { "gen_ai.operation.name": "invoke_workflow" });
          }
        });
        break;
      case "workflow_suspended":
        safe(() => {
          finishWhere((item) => item.runId === event.runId, "Workflow suspended");
          startedAt.delete(event.runId);
        });
        break;
      case "node_started":
        safe(() => {
          const spanKey = key("workflow_node", event.runId, event.nodeId);
          startChild(spanKey, event.runId, event.runId, `prism.workflow.node ${event.nodeId}`, "internal", {
            "gen_ai.operation.name": "execute_node",
            "prism.workflow.id": event.workflowId,
            "prism.workflow.node_id": event.nodeId,
            "prism.run_id": event.runId,
          });
        });
        break;
      case "node_finished":
        safe(() => finish(key("workflow_node", event.runId, event.nodeId), "ok"));
        break;
      case "node_failed":
        safe(() => finish(key("workflow_node", event.runId, event.nodeId), "error", event.error?.message ?? event.error?.code));
        break;
      case "node_skipped":
        safe(() => {
          const spanKey = key("workflow_node", event.runId, event.nodeId);
          startChild(spanKey, event.runId, event.runId, `prism.workflow.node ${event.nodeId}`, "internal", {
            "gen_ai.operation.name": "execute_node",
            "prism.workflow.id": event.workflowId,
            "prism.workflow.node_id": event.nodeId,
            "prism.run_id": event.runId,
            "prism.workflow.skipped": true,
          });
          finish(spanKey, "ok");
        });
        break;
      case "node_iteration_started":
        safe(() => {
          active.get(key("workflow_node", event.runId, event.nodeId))?.span.addEvent?.("node_iteration_started", { iteration: event.iteration });
        });
        break;
      case "node_iteration_finished":
        safe(() => {
          active.get(key("workflow_node", event.runId, event.nodeId))?.span.addEvent?.("node_iteration_finished", { iteration: event.iteration });
        });
        break;
      case "agent_event":
        // A child run's invoke_agent span parents on its node span; the link is by the child's session id.
        safe(() => {
          if (event.event.type !== "run.started") return;
          const node = active.get(key("workflow_node", event.runId, event.nodeId));
          if (node) linkSession(event.event.sessionId, node.span);
        });
        safe(() => handleAgentEvent(event.event));
        break;
    }
  };

  return {
    ...instrumentation,
    handleWorkflowEvent,
    attachWorkflow(bus) {
      if (!enabled) return () => {};
      const iterable = "subscribe" in bus && typeof bus.subscribe === "function" ? bus.subscribe() : bus;
      const iterator = (iterable as AsyncIterable<WorkflowEvent>)[Symbol.asyncIterator]();
      let attached = true;
      void (async () => {
        try {
          while (attached) {
            const next = await iterator.next();
            if (!attached || next.done) break;
            handleWorkflowEvent(next.value);
          }
        } catch {}
      })();
      return () => {
        attached = false;
        void iterator.return?.();
      };
    },
  };
}
