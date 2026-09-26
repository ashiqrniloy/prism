import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type AIProvider, createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  agentNode,
  conditionalNode,
  defineWorkflow,
  fanOutNode,
  functionNode,
  joinNode,
  routeNode,
  runWorkflow,
  WorkflowAbortError,
  type WorkflowEvent,
  WorkflowSuperstepLimitError,
} from "../index.js";

describe("cyclic workflow execution (Plan 130 Task 3)", () => {
  it("worker→reviewer→worker reflection terminates on idle drain with status: 'succeeded'; each activation emitted a node_started/node_finished pair with iteration populated", async () => {
    const events: WorkflowEvent[] = [];

    const worker = functionNode({
      activation: "any",
      execute: async (ctx) => {
        const draft = (ctx.state.draft as string | undefined) ?? "";
        const nextDraft = draft ? `${draft}+rev` : "draft";
        await ctx.updateState({ draft: nextDraft });
        return nextDraft;
      },
    });

    const reviewer = routeNode({
      select: async (ctx) => {
        const draft = ctx.upstream.worker as string;
        if (draft === "draft+rev") {
          return []; // approve draft: activate nothing, triggers idle drain
        }
        return ["worker"]; // request revision
      },
    });

    const workflow = defineWorkflow({
      id: "reflection",
      revision: "1",
      nodes: { worker, reviewer },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
      ],
      limits: { maxSupersteps: 12 },
    });

    assert.equal(workflow.execution, "supersteps");

    const result = await runWorkflow(workflow, null, {
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.state.draft, "draft+rev");
    assert.equal(result.outputs.worker, "draft+rev");

    // Verify iteration numbers on node_started and node_finished pairs
    const isNodeStarted = (e: WorkflowEvent): e is Extract<WorkflowEvent, { type: "node_started" }> => e.type === "node_started";
    const isNodeFinished = (e: WorkflowEvent): e is Extract<WorkflowEvent, { type: "node_finished" }> => e.type === "node_finished";

    const workerStarts = events.filter(isNodeStarted).filter((e) => e.nodeId === "worker");
    const workerFinishes = events.filter(isNodeFinished).filter((e) => e.nodeId === "worker");
    const reviewerStarts = events.filter(isNodeStarted).filter((e) => e.nodeId === "reviewer");
    const reviewerFinishes = events.filter(isNodeFinished).filter((e) => e.nodeId === "reviewer");

    assert.equal(workerStarts.length, 2);
    assert.equal(workerFinishes.length, 2);
    assert.equal(reviewerStarts.length, 2);
    assert.equal(reviewerFinishes.length, 2);

    assert.equal(workerStarts[0]?.iteration, 0);
    assert.equal(workerFinishes[0]?.iteration, 0);
    assert.equal(workerStarts[1]?.iteration, 1);
    assert.equal(workerFinishes[1]?.iteration, 1);

    assert.equal(reviewerStarts[0]?.iteration, 0);
    assert.equal(reviewerFinishes[0]?.iteration, 0);
    assert.equal(reviewerStarts[1]?.iteration, 1);
    assert.equal(reviewerFinishes[1]?.iteration, 1);
  });

  it("reflection with agentNode terminates cleanly on idle drain", async () => {
    let callCount = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        callCount += 1;
        const text = callCount === 1 ? "NEEDS_REVISION" : "APPROVED";
        yield providerTextDelta(text);
        yield providerDone();
      },
    };
    const agent = createAgent({ provider, model: { provider: "mock", model: "test-model" } });

    const worker = functionNode({
      activation: "any",
      execute: async (ctx) => {
        const round = ((ctx.state.round as number) ?? 0) + 1;
        await ctx.updateState({ round });
        return `work-v${round}`;
      },
    });

    const reviewer = agentNode({
      agent: "reviewer",
      input: (ctx) => `Review: ${ctx.upstream.worker}`,
    });

    const gate = routeNode({
      select: async (ctx) => {
        const review = ctx.upstream.reviewer as string;
        if (review.includes("APPROVED")) return [];
        return ["worker"];
      },
    });

    const workflow = defineWorkflow({
      id: "agentic-reflection",
      revision: "1",
      nodes: { worker, reviewer, gate },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "gate"],
        ["gate", "worker"],
      ],
      limits: { maxSupersteps: 15 },
    });

    const result = await runWorkflow(workflow, null, {
      agentFactory: async () => agent.createSession({ id: "s-reviewer" }),
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.state.round, 2);
    assert.equal(result.outputs.reviewer, "APPROVED");
    assert.equal(callCount, 2);
  });

  it("activation: 'all' on a cycle member deadlocks-free only via explicit entry path; entry + back-edge with 'any' re-fires correctly", async () => {
    // Part 1: activation: "all" on cycle member cannot activate without all predecessors -> idle drain
    let allWorkerRan = false;
    let allReviewerRan = false;

    const deadlockWorkflow = defineWorkflow({
      id: "deadlock-free-drain",
      revision: "1",
      nodes: {
        entry: functionNode({ execute: async () => "seed" }),
        worker: functionNode({
          // activation is "all" by default
          execute: async () => {
            allWorkerRan = true;
            return "worker-ran";
          },
        }),
        reviewer: functionNode({
          execute: async () => {
            allReviewerRan = true;
            return "reviewer-ran";
          },
        }),
      },
      edges: [
        ["entry", "worker"],
        ["worker", "reviewer"],
        ["reviewer", "worker"],
      ],
      limits: { maxSupersteps: 10 },
    });

    const deadlockResult = await runWorkflow(deadlockWorkflow, null);
    assert.equal(deadlockResult.status, "succeeded");
    assert.equal(deadlockResult.outputs.entry, "seed");
    assert.equal(allWorkerRan, false);
    assert.equal(allReviewerRan, false);
    assert.equal(deadlockResult.outputs.worker, undefined);
    assert.equal(deadlockResult.outputs.reviewer, undefined);

    // Part 2: entry + back-edge with activation: "any" re-fires correctly
    let workerExecutionCount = 0;
    const refireWorkflow = defineWorkflow({
      id: "refire-any",
      revision: "1",
      nodes: {
        entry: functionNode({ execute: async () => "start" }),
        worker: functionNode({
          activation: "any",
          execute: async (ctx) => {
            workerExecutionCount += 1;
            const count = ((ctx.state.count as number) ?? 0) + 1;
            await ctx.updateState({ count });
            return count;
          },
        }),
        reviewer: functionNode({
          execute: async (ctx) => ctx.upstream.worker as number,
        }),
        gate: routeNode({
          select: async (ctx) => {
            const count = ctx.upstream.reviewer as number;
            if (count >= 3) return [];
            return ["worker"];
          },
        }),
      },
      edges: [
        ["entry", "worker"],
        ["worker", "reviewer"],
        ["reviewer", "gate"],
        ["gate", "worker"],
      ],
      limits: { maxSupersteps: 15 },
    });

    const refireResult = await runWorkflow(refireWorkflow, null);
    assert.equal(refireResult.status, "succeeded");
    assert.equal(refireResult.state.count, 3);
    assert.equal(workerExecutionCount, 3);
  });

  it("budget breach: maxSupersteps: N exceeded ⇒ WorkflowSuperstepLimitError, code asserted, no further provider/node calls after breach", async () => {
    let nodeACalls = 0;
    let nodeBCalls = 0;

    const infiniteWorkflow = defineWorkflow({
      id: "infinite-cycle",
      revision: "1",
      nodes: {
        a: functionNode({
          activation: "any",
          execute: async () => {
            nodeACalls += 1;
            return "from-a";
          },
        }),
        b: functionNode({
          execute: async () => {
            nodeBCalls += 1;
            return "from-b";
          },
        }),
      },
      edges: [
        ["a", "b"],
        ["b", "a"],
      ],
      limits: { maxSupersteps: 4 },
    });

    let thrownError: unknown;
    try {
      await runWorkflow(infiniteWorkflow, null);
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError instanceof WorkflowSuperstepLimitError);
    assert.equal(thrownError.code, "ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT");
    assert.equal(thrownError.supersteps, 4);
    assert.equal(thrownError.maxSupersteps, 4);

    // Wave 0: a runs (superstep 0 -> 1)
    // Wave 1: b runs (superstep 1 -> 2)
    // Wave 2: a runs (superstep 2 -> 3)
    // Wave 3: b runs (superstep 3 -> 4)
    // Wave 4: checked before scheduling (superstep 4 >= 4) -> fails closed!
    assert.equal(nodeACalls, 2);
    assert.equal(nodeBCalls, 2);
  });

  it("conditional back-edge: reviewer routes to worker while revising, to done when approved", async () => {
    const worker = functionNode({
      activation: "any",
      execute: async (ctx) => {
        const rev = ((ctx.state.rev as number) ?? 0) + 1;
        await ctx.updateState({ rev });
        return `rev-${rev}`;
      },
    });

    const reviewer = functionNode({
      execute: async (ctx) => `reviewed: ${ctx.upstream.worker}`,
    });

    const check = conditionalNode({
      when: async (ctx) => ((ctx.state.rev as number) ?? 0) < 3,
      then: ["worker"],
      else: ["done"],
    });

    const done = functionNode({
      execute: async (ctx) => `finished at rev ${ctx.state.rev}`,
    });

    const workflow = defineWorkflow({
      id: "conditional-cycle",
      revision: "1",
      nodes: { worker, reviewer, check, done },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "check"],
        ["check", "worker"],
        ["check", "done"],
      ],
      limits: { maxSupersteps: 20 },
    });

    const result = await runWorkflow(workflow, null);
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.done, "finished at rev 3");
    assert.equal(result.state.rev, 3);
  });

  it("fan_out/join inside a cycle consumes current-round items only", async () => {
    const generator = functionNode({
      activation: "any",
      execute: async (ctx) => {
        const round = (ctx.state.round as number) ?? 0;
        await ctx.updateState({ round: round + 1 });
        return [round * 10, round * 10 + 1];
      },
    });

    const fan = fanOutNode({
      items: async (ctx) => ctx.upstream.generator as number[],
      map: async (item) => (item as number) * 2,
    });

    const join = joinNode({
      reduce: async (items, ctx) => {
        const sum = (items as number[]).reduce((a, b) => a + b, 0);
        await ctx.updateState({ lastSum: sum });
        return sum;
      },
    });

    const check = conditionalNode({
      when: async (ctx) => ((ctx.state.round as number) ?? 0) < 2,
      then: ["generator"],
      else: ["done"],
    });

    const done = functionNode({
      execute: async (ctx) => ctx.state.lastSum,
    });

    const workflow = defineWorkflow({
      id: "fan-join-cycle",
      revision: "1",
      nodes: { generator, fan, join, check, done },
      edges: [
        ["generator", "fan"],
        ["fan", "join"],
        ["join", "check"],
        ["check", "generator"],
        ["check", "done"],
      ],
      limits: { maxSupersteps: 25 },
    });

    const result = await runWorkflow(workflow, null);
    assert.equal(result.status, "succeeded");
    // In round 0: generator returns [0, 1], fan returns [0, 2], join is 2.
    // In round 1: generator returns [10, 11], fan returns [20, 22], join is 42 (NOT 42 + 2 = 44).
    assert.equal(result.outputs.done, 42);
    assert.equal(result.state.round, 2);
  });

  it("abort mid-wave ⇒ status: 'aborted', sessions aborted", async () => {
    let sessionAborted = false;
    const controller = new AbortController();

    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        yield providerTextDelta("chunk1");
        await new Promise((resolve) => {
          if (request.signal?.aborted) return resolve(undefined);
          request.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
        });
        if (request.signal?.aborted) throw request.signal.reason ?? new WorkflowAbortError();
        yield providerDone();
      },
    };
    const agent = createAgent({ provider, model: { provider: "mock", model: "test-model" } });

    const entry = functionNode({
      activation: "any",
      execute: async () => "start",
    });

    const aborter = functionNode({
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.abort(new WorkflowAbortError("Mid-wave abort requested"));
        throw new WorkflowAbortError("Mid-wave abort requested");
      },
    });

    const agentStep = agentNode({
      agent: "agentStep",
      input: () => "ping",
    });

    const workflow = defineWorkflow({
      id: "abort-cycle",
      revision: "1",
      nodes: { entry, aborter, agentStep },
      edges: [
        ["entry", "aborter"],
        ["entry", "agentStep"],
        ["aborter", "entry"],
      ],
      limits: { maxSupersteps: 10, maxConcurrency: 2 },
    });

    let thrownError: unknown;
    try {
      await runWorkflow(workflow, null, {
        signal: controller.signal,
        concurrency: 2,
        agentFactory: async () => {
          const session = agent.createSession({ id: "s-abort" });
          const originalAbort = session.abort.bind(session);
          session.abort = (reason) => {
            sessionAborted = true;
            return originalAbort(reason);
          };
          return session;
        },
      });
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError instanceof WorkflowAbortError);
    assert.equal(sessionAborted, true);
  });

  it("acyclic definition with maxSupersteps runs on the wave engine and produces same outputs as the Kahn path would", async () => {
    const left = functionNode({ execute: async () => "L" });
    const right = functionNode({ execute: async () => "R" });
    const join = functionNode({
      execute: async (ctx) => `${ctx.upstream.left}:${ctx.upstream.right}`,
    });

    // Run 1: Kahn DAG path (no maxSupersteps declared)
    const kahnWorkflow = defineWorkflow({
      revision: "1",
      id: "diamond-kahn",
      nodes: { left, right, join },
      edges: [
        ["left", "join"],
        ["right", "join"],
      ],
    });
    assert.equal(kahnWorkflow.execution, undefined);
    const kahnResult = await runWorkflow(kahnWorkflow, null);

    // Run 2: Superstep wave engine (maxSupersteps declared on same acyclic graph)
    const superstepWorkflow = defineWorkflow({
      revision: "1",
      id: "diamond-superstep",
      nodes: { left, right, join },
      edges: [
        ["left", "join"],
        ["right", "join"],
      ],
      limits: { maxSupersteps: 10 },
    });
    assert.equal(superstepWorkflow.execution, "supersteps");
    const superstepResult = await runWorkflow(superstepWorkflow, null);

    assert.equal(kahnResult.status, "succeeded");
    assert.equal(superstepResult.status, "succeeded");
    assert.equal(kahnResult.outputs.join, "L:R");
    assert.equal(superstepResult.outputs.join, "L:R");
    assert.deepEqual(kahnResult.outputs, superstepResult.outputs);
  });
});
