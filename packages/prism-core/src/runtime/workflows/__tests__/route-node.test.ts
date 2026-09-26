import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AIProvider, createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { agentNode, defineWorkflow, functionNode, routeNode, runWorkflow, type WorkflowEvent, WorkflowRuntimeError } from "../index.js";

describe("routeNode dynamic routing (Plan 130 Task 4)", () => {
  it("routes to selected subset; other successors never run; deduplicates targets", async () => {
    const events: WorkflowEvent[] = [];
    let bRan = false;

    const start = functionNode({
      execute: async () => ({ value: 42 }),
    });

    const router = routeNode({
      select: async (_ctx) => {
        // Return subset ["a", "c"] with a duplicate "a" to verify deduplication
        return ["a", "c", "a"];
      },
    });

    const a = functionNode({
      execute: async () => "node-a-result",
    });

    const b = functionNode({
      execute: async () => {
        bRan = true;
        return "node-b-result";
      },
    });

    const c = functionNode({
      execute: async () => "node-c-result",
    });

    const workflow = defineWorkflow({
      id: "route-subset",
      revision: "1",
      nodes: { start, router, a, b, c },
      edges: [
        ["start", "router"],
        ["router", "a"],
        ["router", "b"],
        ["router", "c"],
      ],
    });

    const result = await runWorkflow(workflow, null, {
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.status, "succeeded");
    assert.equal(bRan, false);
    assert.equal(result.outputs.a, "node-a-result");
    assert.equal(result.outputs.b, undefined);
    assert.equal(result.outputs.c, "node-c-result");
    // Verify route node output records deduplicated chosen targets for audit
    assert.deepEqual(result.outputs.router, ["a", "c"]);

    // Verify events: a and c finished, b was skipped
    assert.ok(events.some((e) => e.type === "node_finished" && e.nodeId === "a"));
    assert.ok(events.some((e) => e.type === "node_finished" && e.nodeId === "c"));
    assert.ok(events.some((e) => e.type === "node_skipped" && e.nodeId === "b"));
    assert.ok(!events.some((e) => e.type === "node_started" && e.nodeId === "b"));
  });

  it("empty selection drains to success", async () => {
    const events: WorkflowEvent[] = [];
    let target1Ran = false;
    let target2Ran = false;

    const router = routeNode({
      select: async () => [],
    });

    const target1 = functionNode({
      execute: async () => {
        target1Ran = true;
        return "t1";
      },
    });

    const target2 = functionNode({
      execute: async () => {
        target2Ran = true;
        return "t2";
      },
    });

    const workflow = defineWorkflow({
      id: "empty-route-drain",
      revision: "1",
      nodes: { router, target1, target2 },
      edges: [
        ["router", "target1"],
        ["router", "target2"],
      ],
    });

    const result = await runWorkflow(workflow, null, {
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.router, []);
    assert.equal(target1Ran, false);
    assert.equal(target2Ran, false);
    assert.equal(result.outputs.target1, undefined);
    assert.equal(result.outputs.target2, undefined);

    // Both successors drained to skipped
    assert.ok(events.some((e) => e.type === "node_skipped" && e.nodeId === "target1"));
    assert.ok(events.some((e) => e.type === "node_skipped" && e.nodeId === "target2"));
  });

  it("unknown target fails closed with the exact code; no downstream side effects", async () => {
    let sideEffectRan = false;

    const router = routeNode({
      select: async () => ["validTarget", "unknownTarget"],
    });

    const validTarget = functionNode({
      execute: async () => {
        sideEffectRan = true;
        return "should-not-run";
      },
    });

    const workflow = defineWorkflow({
      id: "unknown-target-fail",
      revision: "1",
      nodes: { router, validTarget },
      edges: [["router", "validTarget"]],
    });

    let thrownError: unknown;
    try {
      await runWorkflow(workflow, null);
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError instanceof WorkflowRuntimeError);
    assert.equal(thrownError.code, "ERR_PRISM_WORKFLOW_ROUTE_TARGET");
    assert.match(thrownError.message, /selected undeclared successor "unknownTarget"/);
    // Assert zero side effects
    assert.equal(sideEffectRan, false);
  });

  it("select returning non-array fails closed with ERR_PRISM_WORKFLOW_ROUTE_TARGET", async () => {
    const router = routeNode({
      select: (async () => "invalid-non-array") as unknown as () => string[],
    });

    const nextNode = functionNode({ execute: async () => "next" });

    const workflow = defineWorkflow({
      id: "invalid-select-return",
      revision: "1",
      nodes: { router, nextNode },
      edges: [["router", "nextNode"]],
    });

    let thrownError: unknown;
    try {
      await runWorkflow(workflow, null);
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError instanceof WorkflowRuntimeError);
    assert.equal(thrownError.code, "ERR_PRISM_WORKFLOW_ROUTE_TARGET");
    assert.match(thrownError.message, /select\(\) must return an array/);
  });

  it("select returning non-string target fails closed with ERR_PRISM_WORKFLOW_ROUTE_TARGET", async () => {
    const router = routeNode({
      select: (async () => [123]) as unknown as () => string[],
    });

    const nextNode = functionNode({ execute: async () => "next" });

    const workflow = defineWorkflow({
      id: "invalid-target-type",
      revision: "1",
      nodes: { router, nextNode },
      edges: [["router", "nextNode"]],
    });

    let thrownError: unknown;
    try {
      await runWorkflow(workflow, null);
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError instanceof WorkflowRuntimeError);
    assert.equal(thrownError.code, "ERR_PRISM_WORKFLOW_ROUTE_TARGET");
  });

  it("async select reading agent-written state (LangGraph Command equivalence demo)", async () => {
    // Model-driven routing: agentNode runs, writes triage result into workflow state.
    // Downstream routeNode reads ctx.state.decision and selects the path.
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        // Return JSON structured decision
        yield providerTextDelta(JSON.stringify({ triage: "escalate", urgency: "high" }));
        yield providerDone();
      },
    };
    const agent = createAgent({ provider, model: { provider: "mock", model: "test-model" } });

    const triageAgent = agentNode({
      agent: "triage",
      input: () => "Customer report: database unresponsive",
    });

    const parseDecision = functionNode({
      execute: async (ctx) => {
        const text = ctx.upstream.triageAgent as string;
        const parsed = JSON.parse(text);
        await ctx.updateState({ decision: parsed });
        return parsed;
      },
    });

    const router = routeNode({
      select: async (ctx) => {
        const decision = ctx.state.decision as { triage?: string };
        if (decision?.triage === "escalate") {
          return ["escalate"];
        }
        return ["autoResolve"];
      },
    });

    let autoResolveRan = false;
    const autoResolve = functionNode({
      execute: async () => {
        autoResolveRan = true;
        return "auto-resolved";
      },
    });

    const escalate = functionNode({
      execute: async (ctx) => {
        return {
          status: "escalated_to_tier3",
          reason: (ctx.state.decision as { urgency?: string })?.urgency,
        };
      },
    });

    const workflow = defineWorkflow({
      id: "langgraph-command-equivalence",
      revision: "1",
      nodes: { triageAgent, parseDecision, router, autoResolve, escalate },
      edges: [
        ["triageAgent", "parseDecision"],
        ["parseDecision", "router"],
        ["router", "autoResolve"],
        ["router", "escalate"],
      ],
    });

    const result = await runWorkflow(workflow, null, {
      agentFactory: async () => agent.createSession({ id: "s-triage" }),
    });

    assert.equal(result.status, "succeeded");
    assert.equal(autoResolveRan, false);
    assert.equal(result.outputs.autoResolve, undefined);
    assert.deepEqual(result.outputs.router, ["escalate"]);
    assert.deepEqual(result.outputs.escalate, {
      status: "escalated_to_tier3",
      reason: "high",
    });
  });
});
