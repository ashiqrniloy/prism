import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { defineWorkflow, functionNode, HARD_MAX_SUPERSTEPS, routeNode, WorkflowDefinitionError } from "../index.js";

describe("defineWorkflow cyclic and dynamic routing definition surface", () => {
  it("cyclic graph without maxSupersteps throws today's exact message", () => {
    const nodes = {
      worker: functionNode({ execute: async () => "draft" }),
      reviewer: functionNode({ execute: async () => "review" }),
    };
    const edges = [
      ["worker", "reviewer"],
      ["reviewer", "worker"],
    ] as const;

    assert.throws(
      () => defineWorkflow({ id: "cyclic-no-limit", revision: "1", nodes, edges }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, "Workflow graph contains a cycle");
        return true;
      },
    );
  });

  it("cyclic graph with maxSupersteps builds; execution marker present", () => {
    const nodes = {
      worker: functionNode({ execute: async () => "draft", activation: "any" }),
      reviewer: functionNode({ execute: async () => "review" }),
    };
    const edges = [
      ["worker", "reviewer"],
      ["reviewer", "worker"],
    ] as const;

    const wf = defineWorkflow({
      id: "cyclic-with-limit",
      revision: "1",
      nodes,
      edges,
      limits: { maxSupersteps: 12 },
    });

    assert.equal(wf.id, "cyclic-with-limit");
    assert.equal(wf.execution, "supersteps");
    assert.equal(wf.limits?.maxSupersteps, 12);
    assert.equal(wf.nodes.worker.activation, "any");
    assert.equal(wf.nodes.reviewer.activation, undefined);
  });

  it("maxSupersteps 0 / -1 / 1.5 / NaN / 257 rejected", () => {
    const nodes = { a: functionNode({ execute: async () => 1 }) };
    const invalidValues = [0, -1, 1.5, Number.NaN, HARD_MAX_SUPERSTEPS + 1, Number.POSITIVE_INFINITY];

    for (const value of invalidValues) {
      assert.throws(
        () => defineWorkflow({ id: "invalid-supersteps", revision: "1", nodes, limits: { maxSupersteps: value } }),
        WorkflowDefinitionError,
        `Expected maxSupersteps ${value} to be rejected`,
      );
    }

    assert.doesNotThrow(() => defineWorkflow({ id: "valid-supersteps-min", revision: "1", nodes, limits: { maxSupersteps: 1 } }));
    assert.doesNotThrow(() =>
      defineWorkflow({ id: "valid-supersteps-max", revision: "1", nodes, limits: { maxSupersteps: HARD_MAX_SUPERSTEPS } }),
    );
  });

  it("self-edge rejected on cyclic graphs too", () => {
    const nodes = {
      a: functionNode({ execute: async () => 1 }),
      b: functionNode({ execute: async () => 2, activation: "any" }),
    };
    const edges = [
      ["a", "b"],
      ["b", "a"],
      ["b", "b"],
    ] as const;

    assert.throws(
      () => defineWorkflow({ id: "self-edge-cyclic", revision: "1", nodes, edges, limits: { maxSupersteps: 10 } }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, 'Self-edge is not allowed on node "b"');
        return true;
      },
    );
  });

  it('activation: "any" with zero predecessors rejected; with predecessors accepted', () => {
    const nodesRootAny = {
      root: functionNode({ execute: async () => 1, activation: "any" }),
    };

    assert.throws(
      () => defineWorkflow({ id: "root-any", revision: "1", nodes: nodesRootAny }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, 'Node "root" has activation "any" but has zero predecessors');
        return true;
      },
    );

    const nodesInvalid = {
      a: functionNode({ execute: async () => 1, activation: "sometimes" as unknown as "all" }),
    };
    assert.throws(
      () => defineWorkflow({ id: "invalid-act", revision: "1", nodes: nodesInvalid }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, 'Node "a" activation must be "all" or "any"');
        return true;
      },
    );

    const nodesWithPred = {
      a: functionNode({ execute: async () => 1 }),
      b: functionNode({ execute: async () => 2, activation: "any" }),
    };
    assert.doesNotThrow(() =>
      defineWorkflow({
        id: "pred-any-accepted",
        revision: "1",
        nodes: nodesWithPred,
        edges: [["a", "b"]],
      }),
    );
  });

  it('routeNode factory produces kind: "route"; missing select rejected', () => {
    const route = routeNode({
      select: () => ["next-node"],
    });
    assert.equal(route.kind, "route");
    assert.equal(typeof route.select, "function");

    assert.throws(
      () => routeNode({} as unknown as Parameters<typeof routeNode>[0]),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, "Route node requires select()");
        return true;
      },
    );

    assert.throws(
      () => routeNode({ select: "not-a-fn" as unknown as () => string[] }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, "Route node requires select()");
        return true;
      },
    );

    assert.throws(
      () =>
        defineWorkflow({
          id: "route-missing-select-in-define",
          revision: "1",
          nodes: {
            r: { kind: "route" } as unknown as ReturnType<typeof routeNode>,
          },
        }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowDefinitionError);
        assert.equal(err.message, 'Route node "r" requires select()');
        return true;
      },
    );
  });

  it("acyclic definition with maxSupersteps declared still builds (opt-in on DAG is legal)", () => {
    const nodes = {
      a: functionNode({ execute: async () => 1 }),
      b: functionNode({ execute: async () => 2 }),
    };
    const edges = [["a", "b"]] as const;

    const optInDag = defineWorkflow({
      id: "dag-with-supersteps",
      revision: "1",
      nodes,
      edges,
      limits: { maxSupersteps: 10 },
    });
    assert.equal(optInDag.execution, "supersteps");
    assert.equal(optInDag.limits?.maxSupersteps, 10);

    const normalDag = defineWorkflow({
      id: "dag-default",
      revision: "1",
      nodes,
      edges,
    });
    assert.equal(normalDag.execution, undefined);
  });
});
