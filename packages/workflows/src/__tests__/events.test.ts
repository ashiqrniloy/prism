import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkflowEventBus } from "../index.js";

describe("createWorkflowEventBus", () => {
  it("assigns monotonic sequences and supports subscribe", async () => {
    const bus = createWorkflowEventBus({ workflowId: "wf", runId: "r1" });
    const seen: number[] = [];
    const reader = (async () => {
      for await (const event of bus.subscribe()) {
        seen.push(event.sequence);
        if (seen.length >= 3) break;
      }
    })();
    bus.emit({ type: "workflow_started", workflowId: "wf", runId: "r1", timestamp: new Date().toISOString() });
    bus.emit({ type: "node_started", workflowId: "wf", runId: "r1", nodeId: "a", timestamp: new Date().toISOString() });
    bus.emit({ type: "node_finished", workflowId: "wf", runId: "r1", nodeId: "a", timestamp: new Date().toISOString() });
    await reader;
    bus.close();
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("emits overflow and drops under drop_oldest", async () => {
    const bus = createWorkflowEventBus({
      workflowId: "wf",
      runId: "r1",
      maxQueuedEvents: 2,
      overflow: "drop_oldest",
    });
    bus.emit({ type: "workflow_started", workflowId: "wf", runId: "r1", timestamp: new Date().toISOString() });
    bus.emit({ type: "node_started", workflowId: "wf", runId: "r1", nodeId: "a", timestamp: new Date().toISOString() });
    bus.emit({ type: "node_finished", workflowId: "wf", runId: "r1", nodeId: "a", timestamp: new Date().toISOString() });
    const events = [];
    for await (const event of bus.subscribe()) {
      events.push(event.type);
      if (events.length >= 2) break;
    }
    bus.close();
    assert.ok(events.includes("workflow_event_overflow") || events.includes("node_finished"));
  });
});
