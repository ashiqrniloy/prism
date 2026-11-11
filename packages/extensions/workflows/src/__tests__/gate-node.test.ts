import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type ModelProvider } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  gateNode,
  humanGate,
  runWorkflow,
  WorkflowDefinitionError,
  WorkflowLoopLimitError,
  WorkflowRuntimeError,
  WorkflowSuperstepLimitError,
} from "../index.js";

const planner = (rounds: { n: number }) =>
  functionNode({
    execute: async (ctx) => {
      const round = ((ctx.state.round as number) ?? 0) + 1;
      rounds.n = round;
      await ctx.updateState({ round });
      return `plan-v${round}`;
    },
  });

describe("gateNode", () => {
  it("gate_failure_routes_back_once_then_passes", async () => {
    const rounds = { n: 0 };
    const wf = defineWorkflow({
      id: "gate-back",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        research: functionNode({ execute: () => "r" }),
        plan: { ...planner(rounds), activation: "any" as const },
        planOk: gateNode({
          check: (ctx) => ((ctx.state.round as number) >= 2 ? { pass: true, output: "ok" } : { pass: false, reason: "too thin" }),
        }),
        execute: functionNode({ execute: () => "executed" }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
        ["planOk", "execute"],
      ],
    });
    const result = await runWorkflow(wf, null);
    assert.equal(result.status, "succeeded");
    assert.equal(rounds.n, 2);
    assert.equal(result.outputs.execute, "executed");
    assert.deepEqual(result.outputs.planOk, { pass: true, output: "ok" });
  });

  it("gate_loop_exceeds_max_supersteps", async () => {
    const wf = defineWorkflow({
      id: "gate-forever",
      revision: "1",
      limits: { maxSupersteps: 5 },
      nodes: {
        research: functionNode({ execute: () => "r" }),
        plan: functionNode({ activation: "any", execute: () => "p" }),
        planOk: gateNode({ check: () => ({ pass: false, reason: "never" }) }),
        execute: functionNode({ execute: () => "x" }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
        ["planOk", "execute"],
      ],
    });
    await assert.rejects(() => runWorkflow(wf, null), WorkflowSuperstepLimitError);
  });

  it("gate_exceeds_max_iterations", async () => {
    const wf = defineWorkflow({
      id: "gate-iter",
      revision: "1",
      limits: { maxSupersteps: 30 },
      nodes: {
        research: functionNode({ execute: () => "r" }),
        plan: functionNode({ activation: "any", execute: () => "p" }),
        planOk: gateNode({ maxIterations: 2, check: () => ({ pass: false, reason: "never" }) }),
        execute: functionNode({ execute: () => "x" }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
        ["planOk", "execute"],
      ],
    });
    await assert.rejects(() => runWorkflow(wf, null), WorkflowLoopLimitError);
  });

  it("gate_never_calls_model", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        calls += 1;
        throw new Error("model must not be called");
      },
    };
    await createAgent({ model: { provider: "mock", model: "m" }, packages: [providerPackage("throwing", [provider])] });
    const wf = defineWorkflow({
      id: "gate-model",
      revision: "1",
      limits: { maxSupersteps: 6 },
      nodes: {
        research: functionNode({ execute: () => "r" }),
        plan: functionNode({ activation: "any", execute: () => "p" }),
        planOk: gateNode({ check: () => ({ pass: true }) }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
      ],
    });
    const result = await runWorkflow(wf, null);
    assert.equal(result.status, "succeeded");
    assert.equal(calls, 0);
  });

  it("gate_check_throw_is_failure", async () => {
    let checks = 0;
    const wf = defineWorkflow({
      id: "gate-throw",
      revision: "1",
      limits: { maxSupersteps: 6 },
      nodes: {
        research: functionNode({ execute: () => "r" }),
        plan: functionNode({ activation: "any", execute: () => "p" }),
        planOk: gateNode({
          check: () => {
            checks += 1;
            if (checks === 1) throw new Error("boom with secret-token");
            return { pass: true };
          },
        }),
        execute: functionNode({ execute: () => "x" }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
        ["planOk", "execute"],
      ],
    });
    const result = await runWorkflow(wf, null, { checkpoints: createMemoryWorkflowCheckpoints() });
    assert.equal(checks, 2);
    assert.equal(result.outputs.execute, "x");
    assert.ok(!JSON.stringify(result).includes("secret-token"));
  });

  it("gate_without_back_edge_fails_closed", async () => {
    const wf = defineWorkflow({
      id: "gate-noedge",
      revision: "1",
      nodes: {
        plan: functionNode({ execute: () => "p" }),
        planOk: gateNode({ check: () => ({ pass: false, reason: "no" }) }),
      },
      edges: [["plan", "planOk"]],
    });
    await assert.rejects(
      () => runWorkflow(wf, null),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "ERR_PRISM_WORKFLOW_ROUTE_TARGET",
    );
  });

  it("human_gate_rejects_secret_kind", () => {
    assert.throws(() => humanGate({ request: { kind: "secret", title: "t", ref: "env:X" } as never }), WorkflowDefinitionError);
    assert.throws(() => humanGate({ request: { kind: "terminal", title: "t", command: ["ls"] } as never }), WorkflowDefinitionError);
  });
});
