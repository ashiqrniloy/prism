import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineWorkflow,
  functionNode,
  WorkflowDefinitionError,
} from "../index.js";

describe("defineWorkflow", () => {
  it("rejects cycles", () => {
    const a = functionNode({ execute: async () => 1 });
    const b = functionNode({ execute: async () => 2 });
    assert.throws(
      () => defineWorkflow({
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
      () => defineWorkflow({ id: "x", nodes: { a }, edges: [["a", "missing"]] }),
      WorkflowDefinitionError,
    );
    assert.throws(
      () => defineWorkflow({ id: "x", nodes: { a }, edges: [["a", "a"]] }),
      WorkflowDefinitionError,
    );
  });

  it("rejects graphs over maxNodes", () => {
    const nodes: Record<string, ReturnType<typeof functionNode>> = {};
    for (let i = 0; i < 5; i += 1) nodes[`n${i}`] = functionNode({ execute: async () => i });
    assert.throws(
      () => defineWorkflow({ id: "big", nodes, limits: { maxNodes: 3 } }),
      /maxNodes/,
    );
  });

  it("freezes a valid DAG", () => {
    const research = functionNode({ execute: async () => "r" });
    const draft = functionNode({ execute: async (ctx) => ctx.upstream.research });
    const workflow = defineWorkflow({
      id: "ok",
      nodes: { research, draft },
      edges: [["research", "draft"]],
    });
    assert.equal(workflow.id, "ok");
    assert.equal(Object.isFrozen(workflow.nodes), true);
  });
});
