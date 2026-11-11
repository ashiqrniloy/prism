import { createWorkflowTransitionChannel, type WorkflowEvent } from "@arnilo/prism-extensions/workflows";
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { defineWorkflow, functionNode, runWorkflow } from "@arnilo/prism-extensions/workflows";
import { createInMemoryTelemetry } from "../instrumentation.js";
import { createWorkflowInstrumentation } from "../workflow-instrumentation.js";

describe("workflow spans from the ported engine", () => {
  it("projects invoke_workflow and node spans from a real runWorkflow", async () => {
    const memory = createInMemoryTelemetry();
    const instrumentation = createWorkflowInstrumentation({ tracer: memory.tracer, meter: memory.meter });

    const workflow = defineWorkflow({
      revision: "1",
      id: "ported-pipeline",
      nodes: {
        fetch: functionNode({ execute: async () => "row" }),
        store: functionNode({ execute: async (ctx) => `stored:${ctx.upstream.fetch}` }),
      },
      edges: [["fetch", "store"]],
    });

    const result = await runWorkflow(workflow, null, {
      runId: "wf-run-1",
      transitions: workflowEvents((event) => instrumentation.handleWorkflowEvent(event)),
    });

    assert.equal(result.status, "succeeded");
    const names = memory.spans.map((span) => span.name);
    assert.deepEqual(names, ["invoke_workflow ported-pipeline", "prism.workflow.node fetch", "prism.workflow.node store"]);
    const root = memory.spans[0];
    assert.equal(root.attributes["prism.workflow.id"], "ported-pipeline");
    assert.equal(root.attributes["prism.run_id"], "wf-run-1");
    // Node spans parent the workflow span (no orphan spans from the engine's events).
    assert.equal(memory.spans[1].parentSpanId, root.spanId);
    assert.equal(memory.spans[2].parentSpanId, root.spanId);
    // Message text is never an attribute: the node outputs stay out of the spans.
    assert.equal(JSON.stringify(memory.spans).includes("stored:row"), false);
    assert.equal(
      memory.metrics.some((metric) => metric.name === "prism.workflow.duration"),
      true,
    );
  });
});

function workflowEvents(consume: (event: WorkflowEvent) => void) {
  const channel = createWorkflowTransitionChannel({ workflowId: "events", runId: "events" });
  void (async () => {
    for await (const event of channel.subscribe()) consume(event);
  })();
  return channel;
}
