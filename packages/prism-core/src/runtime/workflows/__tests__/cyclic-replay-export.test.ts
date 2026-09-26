import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  collectWorkflowGraphs,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  replayWorkflow,
  routeNode,
  runWorkflow,
  serializeWorkflowGraph,
  workflowGraphToDot,
  workflowGraphToMermaid,
  workflowNode,
  WorkflowCheckpointError,
} from "../index.js";

const ownership = { tenantId: "tenant-cyclic", userId: "user-cyclic" } as const;

describe("cyclic workflow replay, serialization, and graph export (Plan 130 Task 6)", () => {
  it("replay from reviewer in a 4-iteration reflection run copies worker's last iteration output as pre-state evidence", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let workerRuns = 0;
    let reviewerRuns = 0;
    let reviewerObservedWorkerInput: unknown = null;

    const wf = defineWorkflow({
      id: "reflection-replay",
      revision: "1",
      limits: { maxSupersteps: 16 },
      nodes: {
        worker: functionNode({
          activation: "any",
          execute: async () => {
            workerRuns += 1;
            return { draft: `draft-v${workerRuns}`, iteration: workerRuns };
          },
        }),
        reviewer: routeNode({
          select: async (ctx) => {
            reviewerRuns += 1;
            reviewerObservedWorkerInput = ctx.upstream.worker;
            const workerData = ctx.upstream.worker as { draft: string; iteration: number };
            // Approve on iteration 4
            if (workerData.iteration >= 4) {
              return ["done"];
            }
            return ["worker"];
          },
        }),
        done: functionNode({
          execute: () => ({ final: "approved" }),
        }),
      },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    const run1 = await runWorkflow(wf, null, { checkpoints, ownership, runId: "source-run-1" });
    assert.equal(run1.status, "succeeded");
    assert.equal(workerRuns, 4);
    assert.equal(reviewerRuns, 4);

    const sourceRecord = await checkpoints.load({ workflowId: wf.id, runId: run1.runId, ownership });
    assert.ok(sourceRecord);
    assert.equal(sourceRecord.value.status, "succeeded");
    assert.equal(sourceRecord.value.nodes.worker?.iteration, 4);
    assert.equal(sourceRecord.value.nodes.worker?.iterations?.length, 4);

    // Reset counters to track replay execution
    workerRuns = 0;
    reviewerRuns = 0;
    reviewerObservedWorkerInput = null;

    // Replay starting from "reviewer"
    const replayResult = await replayWorkflow(
      wf,
      {
        sourceRunId: run1.runId,
        fromNodeId: "reviewer",
        runId: "replay-run-1",
      },
      {
        checkpoints,
        ownership,
      },
    );

    assert.equal(replayResult.status, "succeeded");
    // Worker was NOT rerun initially; its 4th iteration draft was copied as pre-state evidence
    assert.equal(workerRuns, 0);
    assert.equal(reviewerRuns, 1);
    assert.deepEqual(reviewerObservedWorkerInput, { draft: "draft-v4", iteration: 4 });
    assert.deepEqual(replayResult.outputs.done, { final: "approved" });

    // Verify lineage
    assert.equal(replayResult.lineage?.sourceRunId, run1.runId);
    assert.equal(replayResult.lineage?.fromNodeId, "reviewer");
    assert.equal(replayResult.lineage?.rootRunId, run1.runId);
    assert.equal(replayResult.lineage?.depth, 1);

    // Verify source checkpoint is completely untouched
    const afterRecord = await checkpoints.load({ workflowId: wf.id, runId: run1.runId, ownership });
    assert.deepEqual(afterRecord, sourceRecord);
  });

  it("replay from a never-succeeded cyclic node fails closed", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({
      id: "cyclic-fail-closed",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        start: functionNode({ execute: () => "start" }),
        worker: functionNode({
          activation: "any",
          execute: () => {
            throw new Error("worker-failed");
          },
        }),
        reviewer: routeNode({
          select: () => ["done"],
        }),
        done: functionNode({ execute: () => "done" }),
      },
      edges: [
        ["start", "worker"],
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    let runFailed = false;
    try {
      await runWorkflow(wf, null, { checkpoints, ownership, runId: "failed-run-1" });
    } catch {
      runFailed = true;
    }
    assert.ok(runFailed);

    // Attempt replay from reviewer (which never succeeded)
    await assert.rejects(
      replayWorkflow(
        wf,
        {
          sourceRunId: "failed-run-1",
          fromNodeId: "reviewer",
        },
        { checkpoints, ownership },
      ),
      (err: unknown) => err instanceof WorkflowCheckpointError && /must be succeeded|Only succeeded/i.test((err as Error).message),
    );

    // Attempt replay from non-existent node
    await assert.rejects(
      replayWorkflow(
        wf,
        {
          sourceRunId: "failed-run-1",
          fromNodeId: "nonexistent",
        },
        { checkpoints, ownership },
      ),
      (err: unknown) => err instanceof WorkflowCheckpointError,
    );
  });

  it("mermaid/dot snapshots include back-edge and stay deterministic across two calls", () => {
    const wf = defineWorkflow({
      id: "reflection-export",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        worker: functionNode({
          activation: "any",
          metadata: { label: "Worker Agent" },
          execute: () => "draft",
        }),
        reviewer: routeNode({
          metadata: { label: "Reviewer Decision" },
          select: () => ["done"],
        }),
        done: functionNode({
          metadata: { label: "Finished" },
          execute: () => "done",
        }),
      },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    const view = serializeWorkflowGraph(wf);

    // Mermaid export determinism and content
    const mermaid1 = workflowGraphToMermaid(view);
    const mermaid2 = workflowGraphToMermaid(view);
    assert.equal(mermaid1, mermaid2);
    assert.ok(mermaid1.includes("reviewer --> worker"));
    assert.ok(mermaid1.includes("worker --> reviewer"));
    assert.ok(mermaid1.includes("reviewer --> done"));
    // Route node rendered with diamond/braces
    assert.ok(mermaid1.includes('reviewer{"Reviewer Decision"}'));

    // DOT export determinism and content
    const dot1 = workflowGraphToDot(view);
    const dot2 = workflowGraphToDot(view);
    assert.equal(dot1, dot2);
    assert.ok(dot1.includes('"reviewer" -> "worker";'));
    assert.ok(dot1.includes('"worker" -> "reviewer";'));
    assert.ok(dot1.includes('"reviewer" -> "done";'));
    // Route node rendered with shape=diamond
    assert.ok(dot1.includes('"reviewer" [label="Reviewer Decision", shape=diamond];'));
  });

  it("serializeWorkflowGraph round-trips maxSupersteps + activation + route nodes without functions", () => {
    let closureCaptured = false;
    const wf = defineWorkflow({
      id: "cyclic-serialization",
      revision: "2",
      limits: { maxSupersteps: 24 },
      nodes: {
        worker: functionNode({
          activation: "any",
          execute: () => "draft",
        }),
        router: routeNode({
          select: () => {
            closureCaptured = true;
            return ["worker"];
          },
        }),
        sink: functionNode({
          activation: "all",
          execute: () => "sink",
        }),
      },
      edges: [
        ["worker", "router"],
        ["router", "worker"],
        ["router", "sink"],
      ],
    });

    const view = serializeWorkflowGraph(wf);

    // Structural assertions
    assert.equal(view.schemaVersion, 1);
    assert.equal(view.workflowId, "cyclic-serialization");
    assert.equal(view.revision, "2");
    assert.equal(view.limits?.maxSupersteps, 24);

    const workerNode = view.nodes.find((n) => n.id === "worker");
    assert.ok(workerNode);
    assert.equal(workerNode.activation, "any");

    const sinkNode = view.nodes.find((n) => n.id === "sink");
    assert.ok(sinkNode);
    assert.equal(sinkNode.activation, "all");

    const routerNode = view.nodes.find((n) => n.id === "router");
    assert.ok(routerNode);
    assert.equal(routerNode.kind, "route");

    // Edges include the cyclic back-edge
    assert.ok(view.edges.some((e) => e.from === "router" && e.to === "worker"));
    assert.ok(view.edges.some((e) => e.from === "worker" && e.to === "router"));
    assert.ok(view.edges.some((e) => e.from === "router" && e.to === "sink"));

    // Security check: JSON serialization never emits functions/closures
    const serialized = JSON.stringify(view);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.limits.maxSupersteps, 24);
    assert.equal(parsed.nodes.find((n: { id: string }) => n.id === "router").kind, "route");
    assert.equal((parsed as Record<string, unknown>).select, undefined);
    assert.equal(closureCaptured, false);
  });

  it("collectWorkflowGraphs traverses nested definitions containing cyclic graphs", () => {
    const cyclicChild = defineWorkflow({
      id: "child-cyclic-loop",
      revision: "1",
      limits: { maxSupersteps: 8 },
      nodes: {
        stepA: functionNode({ activation: "any", execute: () => "A" }),
        stepB: routeNode({ select: () => ["stepA"] }),
      },
      edges: [
        ["stepA", "stepB"],
        ["stepB", "stepA"],
      ],
    });

    const parent = defineWorkflow({
      id: "parent-workflow",
      revision: "1",
      nodes: {
        sub: workflowNode({ workflow: cyclicChild }),
        end: functionNode({ execute: () => "done" }),
      },
      edges: [["sub", "end"]],
    });

    const views = collectWorkflowGraphs(parent);
    assert.equal(views.size, 2);
    assert.ok(views.has("parent-workflow"));
    assert.ok(views.has("child-cyclic-loop"));

    const childView = views.get("child-cyclic-loop");
    assert.ok(childView);
    assert.equal(childView.limits?.maxSupersteps, 8);
    assert.ok(childView.edges.some((e) => e.from === "stepB" && e.to === "stepA"));
  });

  it("replay from a specific historical iteration with state and input injection forks deterministically", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const observedIterations: number[] = [];
    const observedGuidance: string[] = [];

    const wf = defineWorkflow({
      id: "iteration-fork-demo",
      revision: "1",
      limits: { maxSupersteps: 16 },
      nodes: {
        worker: functionNode({
          activation: "any",
          execute: async (ctx) => {
            const currentIteration = typeof ctx.state.iteration === "number" ? ctx.state.iteration : 0;
            const guidance = (ctx.state.guidance as string) || "standard";
            observedIterations.push(currentIteration);
            observedGuidance.push(guidance);
            await ctx.updateState({
              iteration: currentIteration + 1,
              draft: `draft-${currentIteration}`,
            });
            return { draft: `draft-${currentIteration}`, iteration: currentIteration };
          },
        }),
        reviewer: routeNode({
          select: async (ctx) => {
            const currentIteration = (ctx.state.iteration as number) || 0;
            // If guidance is "accelerate", approve immediately on next round
            if (ctx.state.guidance === "accelerate" || currentIteration >= 4) {
              return ["done"];
            }
            return ["worker"];
          },
        }),
        done: functionNode({
          execute: (ctx) => ({ final: "approved", totalIterations: ctx.state.iteration }),
        }),
      },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    // 1. Initial run: completes in 4 iterations
    const initialRun = await runWorkflow(wf, { initial: "data" }, { checkpoints, ownership });
    assert.equal(initialRun.status, "succeeded");
    assert.equal(observedIterations.length, 4);

    // 2. Replay from worker at iteration 1 (0-indexed second iteration) with injected state
    observedIterations.length = 0;
    observedGuidance.length = 0;

    const replayed = await replayWorkflow(
      wf,
      {
        sourceRunId: initialRun.runId,
        fromNodeId: "worker",
        iteration: 1,
        injectState: { guidance: "accelerate" },
        injectInput: { initial: "replayed-data" },
      },
      { checkpoints, ownership },
    );

    assert.equal(replayed.status, "succeeded");
    // With "accelerate", worker runs with iteration 1, updates iteration to 2, reviewer sees "accelerate" and routes to "done"
    assert.equal(observedGuidance[0], "accelerate");
    assert.deepEqual(observedIterations, [1]);

    // Check replayed metadata
    const replayedCheckpoint = await checkpoints.load({
      workflowId: wf.id,
      runId: replayed.runId,
      ownership,
    });
    assert.deepEqual(replayedCheckpoint?.value.workflowInput, { initial: "replayed-data" });
    assert.equal(replayedCheckpoint?.value.metadata?.replayIteration, 1);
    assert.deepEqual(replayedCheckpoint?.value.metadata?.injectedStateKeys, ["guidance"]);
  });

  it("replay fails closed when requested iteration does not exist or is invalid", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({
      id: "invalid-iter-demo",
      revision: "1",
      limits: { maxSupersteps: 4 },
      nodes: {
        nodeA: functionNode({ execute: () => "A" }),
      },
      edges: [],
    });

    const initial = await runWorkflow(wf, {}, { checkpoints, ownership });
    assert.equal(initial.status, "succeeded");

    // Negative iteration
    await assert.rejects(
      () => replayWorkflow(wf, { sourceRunId: initial.runId, fromNodeId: "nodeA", iteration: -1 }, { checkpoints, ownership }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowCheckpointError);
        assert.match(err.message, /non-negative integer/);
        return true;
      },
    );

    // Non-existent iteration index 99
    await assert.rejects(
      () => replayWorkflow(wf, { sourceRunId: initial.runId, fromNodeId: "nodeA", iteration: 99 }, { checkpoints, ownership }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowCheckpointError);
        assert.match(err.message, /iteration 99 not found/);
        return true;
      },
    );
  });
});
