import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCheckpointStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCheckpoints,
  defineWorkflow,
  loopNode,
  runWorkflow,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
} from "../index.js";
import { runCheckpointAdapterConformance, sampleValue } from "./checkpoint-conformance.js";

describe("createMemoryWorkflowCheckpoints", () => {
  it("passes shared adapter conformance", async () => {
    await runCheckpointAdapterConformance("memory", () => createMemoryWorkflowCheckpoints());
  });

  it("adapts the generic core CheckpointStore", async () => {
    await runCheckpointAdapterConformance("core", () =>
      createWorkflowCheckpoints({
        store: createMemoryCheckpointStore(),
      }),
    );
  });

  it("reads legacy checkpoints without an iteration ledger", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    await checkpoints.save({
      workflowId: "wf",
      runId: "legacy",
      version: 1,
      value: sampleValue({ nodes: { a: { nodeId: "a", status: "succeeded", output: { ok: true } } } }),
    });
    const loaded = await checkpoints.load({ workflowId: "wf", runId: "legacy" });
    assert.equal(loaded?.value.nodes.a?.iterations, undefined);
  });

  it("bounds checkpoint payload size", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ maxCheckpointBytes: 64 });
    await assert.rejects(
      () =>
        checkpoints.save({
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

  it("bounds and validates durable loop iteration records", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ maxNodeOutputBytes: 32 });
    await assert.rejects(
      () =>
        checkpoints.save({
          workflowId: "wf",
          runId: "run1",
          version: 1,
          value: sampleValue({
            nodes: {
              loop: {
                nodeId: "loop",
                status: "running",
                iteration: 1,
                iterations: [
                  {
                    schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
                    iteration: 0,
                    iterationId: "wf/run1/loop/0",
                    done: false,
                    output: "x".repeat(64),
                  },
                ],
              },
            },
          }),
        }),
      /max bytes/i,
    );
    await assert.rejects(
      () =>
        checkpoints.save({
          workflowId: "wf",
          runId: "run2",
          version: 1,
          value: sampleValue({
            runId: "run2",
            nodes: {
              loop: {
                nodeId: "loop",
                status: "running",
                iteration: 2,
                iterations: [
                  {
                    schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
                    iteration: 0,
                    iterationId: "wf/run2/loop/0",
                    done: false,
                    output: "ok",
                  },
                ],
              },
            },
          }),
        }),
      /does not match/i,
    );
  });

  it("runs bounded loops through memory and generic checkpoint adapters", async () => {
    const adapters = [
      ["memory", () => createMemoryWorkflowCheckpoints()],
      ["core", () => createWorkflowCheckpoints({ store: createMemoryCheckpointStore() })],
    ] as const;
    for (const [label, create] of adapters) {
      const checkpoints = create();
      let calls = 0;
      const workflow = defineWorkflow({
        revision: "1",
        id: `loop-conformance-${label}`,
        nodes: {
          loop: loopNode({
            execute: async (ctx) => {
              calls += 1;
              return ctx.iteration + 1;
            },
            until: (ctx) => ctx.previousOutput === 3,
            maxIterations: 3,
          }),
        },
      });
      const result = await runWorkflow(workflow, null, { checkpoints, runId: `run-${label}` });
      assert.equal(result.status, "succeeded", `${label}: status`);
      assert.equal(calls, 3, `${label}: calls`);
      const saved = await checkpoints.load({ workflowId: workflow.id, runId: result.runId });
      assert.deepEqual(
        saved?.value.nodes.loop?.iterations?.map((record) => [record.iteration, record.output, record.done]),
        [
          [0, 1, false],
          [1, 2, false],
          [2, 3, true],
        ],
        `${label}: iteration ledger`,
      );
    }
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
