import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent } from "@arnilo/prism";
import type { WorkflowEvent } from "@arnilo/prism-workflows";
import { createInMemoryTelemetry } from "../instrumentation.js";
import { createWorkflowInstrumentation } from "../workflow-instrumentation.js";

const base = { workflowId: "build", runId: "wf1", timestamp: "2026-01-01T00:00:00.000Z" };

describe("workflow span parenting", () => {
  it("workflow_span_parents_child_session_spans", () => {
    const memory = createInMemoryTelemetry();
    const inst = createWorkflowInstrumentation({ tracer: memory.tracer, meter: memory.meter });
    let sequence = 0;
    const push = (event: Record<string, unknown>) => inst.handleWorkflowEvent({ ...base, sequence: ++sequence, ...event } as WorkflowEvent);
    const agent = (nodeId: string, event: Record<string, unknown>) =>
      push({ type: "agent_event", nodeId, event: { sessionId: `child-${nodeId}`, runId: `run-${nodeId}`, ...event } as AgentEvent });
    const origin = { kind: "external", agent: "ui-engineer", agentId: "x", depth: 0, executedBy: "external" };

    push({ type: "workflow_started" });
    push({ type: "node_started", nodeId: "ui" });
    push({ type: "node_started", nodeId: "plan" });
    agent("ui", { type: "run.started", origin });
    agent("ui", { type: "tool.started", call: { id: "t", name: "edit", arguments: {} }, origin });
    agent("plan", { type: "run.started" });
    agent("ui", { type: "run.completed" });
    agent("plan", { type: "run.completed" });
    push({ type: "node_finished", nodeId: "ui" });
    push({ type: "node_finished", nodeId: "plan" });
    push({ type: "workflow_finished", status: "succeeded" });

    const node = (id: string) => memory.spans.find((s) => s.name === `prism.workflow.node ${id}`)!;
    const agents = memory.spans.filter((s) => s.name.startsWith("invoke_agent"));
    assert.equal(agents.length, 2);
    const ui = agents.find((s) => s.attributes["prism.session_id"] === "child-ui")!;
    const plan = agents.find((s) => s.attributes["prism.session_id"] === "child-plan")!;
    assert.equal(ui.parentSpanId, node("ui").spanId);
    assert.equal(plan.parentSpanId, node("plan").spanId);
    assert.equal(ui.attributes["prism.origin.agent"], "ui-engineer");
    const tool = memory.spans.find((s) => s.name === "execute_tool edit")!;
    assert.equal(tool.parentSpanId, ui.spanId);
    // One trace covers the whole run.
    assert.equal(new Set(memory.spans.map((s) => s.traceId)).size, 1);
  });
});
