import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineWorkflow,
  functionNode,
  HARD_MAX_CHECKPOINT_BYTES,
  HARD_MAX_CONCURRENCY,
  HARD_MAX_FAN_OUT,
  HARD_MAX_NESTED_DEPTH,
  HARD_MAX_NODES,
  HARD_MAX_NODE_OUTPUT_BYTES,
  HARD_MAX_NODE_RETRIES,
  HARD_MAX_NODE_TIMEOUT_MS,
  HARD_MAX_REPLAY_DEPTH,
  HARD_MAX_STATE_BYTES,
  HARD_MAX_STATE_HISTORY,
  runWorkflow,
  WorkflowDefinitionError,
} from "../index.js";

describe("defineWorkflow", () => {
  it("requires a non-empty explicit revision", () => {
    const nodes = { a: functionNode({ execute: async () => 1 }) };
    assert.throws(
      () => defineWorkflow({ id: "missing", nodes } as unknown as Parameters<typeof defineWorkflow>[0]),
      /revision is required/i,
    );
    assert.throws(() => defineWorkflow({ revision: " ", id: "empty", nodes }), /revision is required/i);
    assert.equal(defineWorkflow({ revision: " 2 ", id: "ok", nodes }).revision, "2");
  });

  it("rejects every invalid workflow limit and runtime concurrency", async () => {
    const nodes = { a: functionNode({ execute: async () => 1 }) };
    const caps = {
      maxNodes: HARD_MAX_NODES,
      maxFanOut: HARD_MAX_FAN_OUT,
      maxConcurrency: HARD_MAX_CONCURRENCY,
      maxNodeOutputBytes: HARD_MAX_NODE_OUTPUT_BYTES,
      maxCheckpointBytes: HARD_MAX_CHECKPOINT_BYTES,
      maxNestedDepth: HARD_MAX_NESTED_DEPTH,
      maxStateBytes: HARD_MAX_STATE_BYTES,
      maxStateHistory: HARD_MAX_STATE_HISTORY,
      maxReplayDepth: HARD_MAX_REPLAY_DEPTH,
    } as const;
    for (const [name, cap] of Object.entries(caps)) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, Number.MAX_SAFE_INTEGER + 1, cap + 1]) {
        assert.throws(
          () => defineWorkflow({ revision: "1", id: name, nodes, limits: { [name]: value } }),
          WorkflowDefinitionError,
          `${name} accepted ${value}`,
        );
      }
      assert.doesNotThrow(() => defineWorkflow({ revision: "1", id: name, nodes, limits: { [name]: cap } }));
    }
    for (const retries of [-1, Number.NaN, Number.POSITIVE_INFINITY, HARD_MAX_NODE_RETRIES + 1]) {
      assert.throws(() => defineWorkflow({ revision: "1", id: "retries", nodes: { a: functionNode({ retries, execute: () => 1 }) } }), WorkflowDefinitionError);
    }
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, HARD_MAX_NODE_TIMEOUT_MS + 1]) {
      assert.throws(() => defineWorkflow({ revision: "1", id: "timeout", nodes: { a: functionNode({ timeoutMs, execute: () => 1 }) } }), WorkflowDefinitionError);
    }
    assert.doesNotThrow(() => defineWorkflow({ revision: "1", id: "node-bounds", nodes: {
      a: functionNode({ retries: HARD_MAX_NODE_RETRIES, timeoutMs: HARD_MAX_NODE_TIMEOUT_MS, execute: () => 1 }),
    } }));

    const workflow = defineWorkflow({ revision: "1", id: "runtime", nodes });
    for (const concurrency of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, Number.MAX_SAFE_INTEGER + 1, HARD_MAX_CONCURRENCY + 1]) {
      await assert.rejects(runWorkflow(workflow, null, { concurrency }), WorkflowDefinitionError);
    }
    assert.equal((await runWorkflow(workflow, null, { concurrency: HARD_MAX_CONCURRENCY })).status, "succeeded");
  });

  it("rejects cycles", () => {
    const a = functionNode({ execute: async () => 1 });
    const b = functionNode({ execute: async () => 2 });
    assert.throws(
      () => defineWorkflow({
        revision: "1",
        id: "cycle",
        nodes: { a, b },
        edges: [["a", "b"], ["b", "a"]],
      }),
      (error: unknown) => error instanceof WorkflowDefinitionError && /cycle/i.test(String(error)),
    );
  });

  it("rejects unknown edge endpoints and self-edges", () => {
    const a = functionNode({ execute: async () => 1 });
    assert.throws(
      () => defineWorkflow({ revision: "1", id: "x", nodes: { a }, edges: [["a", "missing"]] }),
      WorkflowDefinitionError,
    );
    assert.throws(
      () => defineWorkflow({ revision: "1", id: "x", nodes: { a }, edges: [["a", "a"]] }),
      WorkflowDefinitionError,
    );
  });

  it("rejects graphs over maxNodes", () => {
    const nodes: Record<string, ReturnType<typeof functionNode>> = {};
    for (let i = 0; i < 5; i += 1) nodes[`n${i}`] = functionNode({ execute: async () => i });
    assert.throws(
      () => defineWorkflow({ revision: "1", id: "big", nodes, limits: { maxNodes: 3 } }),
      /maxNodes/,
    );
  });

  it("freezes a valid DAG", () => {
    const research = functionNode({ execute: async () => "r" });
    const draft = functionNode({ execute: async (ctx) => ctx.upstream.research });
    const workflow = defineWorkflow({
      revision: "1",
      id: "ok",
      nodes: { research, draft },
      edges: [["research", "draft"]],
    });
    assert.equal(workflow.id, "ok");
    assert.equal(Object.isFrozen(workflow.nodes), true);
  });
});
