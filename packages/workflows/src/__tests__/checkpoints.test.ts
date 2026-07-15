import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCheckpointStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCheckpoints,
} from "../index.js";
import { runCheckpointAdapterConformance, sampleValue } from "./checkpoint-conformance.js";

describe("createMemoryWorkflowCheckpoints", () => {
  it("passes shared adapter conformance", async () => {
    await runCheckpointAdapterConformance("memory", () => createMemoryWorkflowCheckpoints());
  });

  it("adapts the generic core CheckpointStore", async () => {
    await runCheckpointAdapterConformance("core", () => createWorkflowCheckpoints({
      store: createMemoryCheckpointStore(),
    }));
  });

  it("bounds checkpoint payload size", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ maxCheckpointBytes: 64 });
    await assert.rejects(
      () => checkpoints.save({
        workflowId: "wf",
        runId: "run1",
        version: 1,
        value: sampleValue({
          nodes: {
            a: { nodeId: "a", status: "succeeded", output: "x".repeat(200) },
          },
        }),
      }),
      /max bytes/i,
    );
  });

  it("redacts secrets before persist", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ secrets: ["super-secret"] });
    await checkpoints.save({
      workflowId: "wf",
      runId: "run1",
      version: 1,
      value: sampleValue({
        nodes: {
          a: { nodeId: "a", status: "succeeded", output: "token=super-secret" },
        },
      }),
    });
    const loaded = await checkpoints.load({ workflowId: "wf", runId: "run1" });
    assert.equal(loaded?.value.redacted, true);
    assert.notEqual(loaded?.value.nodes.a?.output, "token=super-secret");
    assert.match(String(loaded?.value.nodes.a?.output), /\[REDACTED\]|redacted|\*+/i);
  });

  it("paginates list results", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    for (let i = 0; i < 3; i += 1) {
      await checkpoints.save({
        workflowId: "wf",
        runId: `run${i}`,
        version: 1,
        value: sampleValue({ runId: `run${i}` }),
      });
    }
    const page1 = await checkpoints.list!({ limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await checkpoints.list!({ limit: 2, cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, undefined);
  });
});
