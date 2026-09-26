import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { defineWorkflow } from "../define.js";
import { WorkflowDefinitionError } from "../errors.js";
import { functionNode, routeNode } from "../nodes.js";
import { runWorkflow } from "../run.js";
import { createScopedState, scopedSubgraphNode, validateScopeKey, withNodeScope, type ScopedWorkflowNodeContext } from "../scoped.js";

describe("Workflow Scoped State", () => {
  describe("validateScopeKey", () => {
    it("accepts valid alphanumeric scope keys", () => {
      assert.doesNotThrow(() => validateScopeKey("agent_a"));
      assert.doesNotThrow(() => validateScopeKey("researcher-1"));
      assert.doesNotThrow(() => validateScopeKey("Worker123"));
    });

    it("rejects prototype pollution and dangerous keys", () => {
      assert.throws(() => validateScopeKey("__proto__"), WorkflowDefinitionError);
      assert.throws(() => validateScopeKey("constructor"), WorkflowDefinitionError);
      assert.throws(() => validateScopeKey("prototype"), WorkflowDefinitionError);
    });

    it("rejects empty or invalid character keys", () => {
      assert.throws(() => validateScopeKey(""), WorkflowDefinitionError);
      assert.throws(() => validateScopeKey("agent.sub"), WorkflowDefinitionError);
      assert.throws(() => validateScopeKey("agent/sub"), WorkflowDefinitionError);
      assert.throws(() => validateScopeKey("agent name"), WorkflowDefinitionError);
    });
  });

  describe("createScopedState", () => {
    it("extracts state slice safely", () => {
      const rootState = {
        workerA: { count: 42, done: false },
        workerB: { items: ["x"] },
        invalid: "not an object",
      };

      const scopedA = createScopedState<{ count: number; done: boolean }>(rootState, "workerA");
      assert.deepEqual(scopedA, { count: 42, done: false });

      const scopedB = createScopedState<{ items: string[] }>(rootState, "workerB");
      assert.deepEqual(scopedB, { items: ["x"] });

      const scopedInvalid = createScopedState(rootState, "invalid");
      assert.deepEqual(scopedInvalid, {});

      const scopedMissing = createScopedState(rootState, "workerC");
      assert.deepEqual(scopedMissing, {});
    });

    it("handles undefined or null rootState gracefully", () => {
      assert.deepEqual(createScopedState(undefined, "workerA"), {});
      assert.deepEqual(createScopedState(null as unknown as undefined, "workerA"), {});
    });
  });

  describe("withNodeScope", () => {
    it("isolates node state reads and updates to the specified scope", async () => {
      const nodeA = withNodeScope(
        "worker_a",
        functionNode({
          execute: async (ctx) => {
            const scopedCtx = ctx as ScopedWorkflowNodeContext;
            // ctx.state should be scoped to worker_a
            assert.deepEqual(scopedCtx.state, {});
            // ctx.rootState should show the un-scoped root state
            assert.deepEqual(scopedCtx.rootState, { initialFlag: true });

            await scopedCtx.updateState({ count: 1, step: "init" });
            return "a_done";
          },
        }),
      );

      const nodeB = withNodeScope(
        "worker_b",
        functionNode({
          execute: async (ctx) => {
            const scopedCtx = ctx as ScopedWorkflowNodeContext;
            // ctx.state should be scoped to worker_b, not seeing worker_a's keys directly in ctx.state
            assert.deepEqual(scopedCtx.state, {});
            // ctx.rootState should show root state including worker_a's written state
            assert.equal((scopedCtx.rootState as Record<string, unknown>).initialFlag, true);
            assert.deepEqual((scopedCtx.rootState as Record<string, unknown>).worker_a, { count: 1, step: "init" });

            await scopedCtx.updateState({ count: 100, status: "ready" });
            return "b_done";
          },
        }),
      );

      const inspectNode = functionNode({
        execute: (ctx) => {
          // Parent/root view of state
          return ctx.state;
        },
      });

      const workflow = defineWorkflow({
        id: "scoped-state-workflow",
        revision: "1",
        nodes: {
          nodeA,
          nodeB,
          inspectNode,
        },
        edges: [
          ["nodeA", "nodeB"],
          ["nodeB", "inspectNode"],
        ],
      });

      const result = await runWorkflow(workflow, null, {
        initialState: { initialFlag: true },
      });

      assert.equal(result.status, "succeeded");
      assert.deepEqual(result.state, {
        initialFlag: true,
        worker_a: { count: 1, step: "init" },
        worker_b: { count: 100, status: "ready" },
      });
      assert.deepEqual(result.outputs.inspectNode, {
        initialFlag: true,
        worker_a: { count: 1, step: "init" },
        worker_b: { count: 100, status: "ready" },
      });
    });

    it("works with routeNode to inspect scoped state for routing", async () => {
      const triage = withNodeScope(
        "triage",
        functionNode({
          execute: async (ctx) => {
            await ctx.updateState({ route: "fast_track" });
          },
        }),
      );

      const router = withNodeScope(
        "triage",
        routeNode({
          select: (ctx) => {
            const state = ctx.state as { route?: string };
            if (state.route === "fast_track") {
              return ["express"];
            }
            return ["standard"];
          },
        }),
      );

      const express = functionNode({ execute: () => "express_finished" });
      const standard = functionNode({ execute: () => "standard_finished" });

      const workflow = defineWorkflow({
        id: "scoped-route-workflow",
        revision: "1",
        nodes: {
          triage,
          router,
          express,
          standard,
        },
        edges: [
          ["triage", "router"],
          ["router", "express"],
          ["router", "standard"],
        ],
      });

      const result = await runWorkflow(workflow, null);
      assert.equal(result.status, "succeeded");
      assert.equal(result.outputs.express, "express_finished");
      assert.equal(result.outputs.standard, undefined);
    });

    it("throws on invalid scopeKey during node wrapping", () => {
      assert.throws(() => withNodeScope("__proto__", functionNode({ execute: () => "x" })), WorkflowDefinitionError);
    });
  });

  describe("scopedSubgraphNode", () => {
    it("executes child workflow within isolated scope and records output", async () => {
      const childWorker = functionNode({
        execute: async (ctx) => {
          await ctx.updateState({ findings: ["item1", "item2"], confidence: 0.95 });
          return { summary: "findings ok" };
        },
      });

      const childWf = defineWorkflow({
        id: "child-research-workflow",
        revision: "1",
        nodes: {
          childWorker,
        },
        edges: [],
      });

      const parentSubgraph = scopedSubgraphNode({
        scope: "research",
        workflow: childWf,
      });

      const finalNode = functionNode({
        execute: (ctx) => {
          return {
            researchFindings: (ctx.state as Record<string, unknown>).research,
          };
        },
      });

      const parentWf = defineWorkflow({
        id: "parent-wf",
        revision: "1",
        nodes: {
          research: parentSubgraph,
          finalNode,
        },
        edges: [["research", "finalNode"]],
      });

      const result = await runWorkflow(parentWf, null, {
        initialState: { query: "Prism cyclic workflows" },
      });

      assert.equal(result.status, "succeeded");
      assert.equal(result.state?.query, "Prism cyclic workflows");
      assert.deepEqual((result.state?.research as Record<string, unknown>)?.findings, ["item1", "item2"]);
      assert.equal((result.state?.research as Record<string, unknown>)?.confidence, 0.95);
      assert.deepEqual(result.outputs.finalNode, {
        researchFindings: {
          findings: ["item1", "item2"],
          confidence: 0.95,
        },
      });
    });

    it("allows custom input and output mappers on scopedSubgraphNode", async () => {
      const childWf = defineWorkflow({
        id: "calc-child",
        revision: "1",
        nodes: {
          calc: functionNode({
            execute: (ctx) => {
              const num = typeof ctx.workflowInput === "number" ? ctx.workflowInput : 0;
              return num * 2;
            },
          }),
        },
        edges: [],
      });

      const setupNode = functionNode({
        execute: async (ctx) => {
          await ctx.updateState({ factor: 21 });
        },
      });

      const childNode = scopedSubgraphNode({
        scope: "math_subsystem",
        workflow: childWf,
        input: (scopedCtx) => {
          return (scopedCtx.state as { factor?: number }).factor ?? 0;
        },
        output: (childResult, scopedCtx) => {
          return {
            doubled: childResult.outputs.calc,
            scopedOriginal: (scopedCtx.state as { factor?: number }).factor,
          };
        },
      });

      const parentWf = defineWorkflow({
        id: "calc-parent",
        revision: "1",
        nodes: {
          setup: withNodeScope("math_subsystem", setupNode),
          child: childNode,
        },
        edges: [["setup", "child"]],
      });

      const result = await runWorkflow(parentWf, null);
      assert.equal(result.status, "succeeded");
      assert.deepEqual(result.outputs.child, {
        doubled: 42,
        scopedOriginal: 21,
      });
    });
  });
});
