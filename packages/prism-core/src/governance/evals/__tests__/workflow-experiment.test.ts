import assert from "node:assert/strict";
import test from "node:test";
import { defineWorkflow } from "../../../runtime/workflows/define.js";
import type { ExecutionStep, ExecutionTimeline } from "../../observability/timeline-types.js";
import { defaultCurateToItem } from "../curate.js";
import { defineDataset } from "../dataset.js";
import { scoreRun } from "../score.js";
import { defineScorer } from "../scorer.js";
import { assertEvaluationThreshold } from "../threshold.js";
import { runWorkflowExperiment } from "../workflow-experiment.js";

// ─── Test 1: defineDataset freezes expectedTrajectory ─────────────────────────

test("defineDataset freezes expectedTrajectory; duplicate item ids still fail", () => {
  const ds = defineDataset({
    id: "traj-ds",
    version: "1.0",
    items: [
      {
        id: "item-1",
        input: "do search",
        expectedTrajectory: [{ name: "search" }, { name: "read" }],
      },
    ],
  });

  const item = ds.items[0]!;
  assert.equal(item.expectedTrajectory?.length, 2);
  assert.ok(Object.isFrozen(item.expectedTrajectory));

  // Duplicate item id fails closed
  assert.throws(
    () =>
      defineDataset({
        id: "dup-ds",
        items: [
          { id: "same-id", input: "a" },
          { id: "same-id", input: "b" },
        ],
      }),
    /duplicate dataset item id/,
  );
});

// ─── Test 2: datasetFromRuns default items have no expectedTrajectory ────────

test("datasetFromRuns default items have no expectedTrajectory", () => {
  const mockRun: any = {
    run: { id: "run-test-1" },
    trace: { events: [], toolCalls: [], usage: [] },
    input: { role: "user", content: [{ type: "text", text: "query" }] },
    output: "result text",
  };

  const itemDraft = defaultCurateToItem(mockRun);
  assert.ok(itemDraft);
  assert.equal(itemDraft.id, "run-test-1");
  assert.equal((itemDraft as any).expectedTrajectory, undefined);
});

// ─── Test 3: forEach tool: step-scoped records and bounds cap ─────────────────

test("forEach tool: 3 tools -> 3 records with stepIds; 40 tools + max 32 -> 32 scored", async () => {
  // Case A: 3 tools -> 3 records with stepId
  const toolSteps3: ExecutionStep[] = [
    { id: "tool-1", kind: "tool", name: "t1", order: 0, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
    { id: "tool-2", kind: "tool", name: "t2", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
    { id: "tool-3", kind: "tool", name: "t3", order: 2, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
  ];
  const timeline3: ExecutionTimeline = {
    schemaVersion: 1,
    runId: "run-3",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00Z",
    steps: toolSteps3,
    redacted: false,
    content: "metadata",
  };

  const stepScorer = defineScorer({
    id: "step_check",
    score: () => ({ score: 1.0 }),
  });

  const records3 = await scoreRun({
    result: { sessionId: "s1", runId: "run-3", status: "succeeded", text: "", content: [] },
    scorers: [stepScorer],
    injectedTimeline: timeline3,
    forEach: "tool",
  });

  assert.equal(records3.length, 3);
  assert.equal(records3[0]?.stepId, "tool-1");
  assert.equal(records3[1]?.stepId, "tool-2");
  assert.equal(records3[2]?.stepId, "tool-3");

  // Case B: 40 tools + maxStepScores 32 -> 32 records
  const toolSteps40: ExecutionStep[] = Array.from({ length: 40 }, (_, i) => ({
    id: `tool-${i}`,
    kind: "tool",
    name: `tool_${i}`,
    order: i,
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00Z",
  }));
  const timeline40: ExecutionTimeline = {
    schemaVersion: 1,
    runId: "run-40",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00Z",
    steps: toolSteps40,
    redacted: false,
    content: "metadata",
  };

  const records40 = await scoreRun({
    result: { sessionId: "s1", runId: "run-40", status: "succeeded", text: "", content: [] },
    scorers: [stepScorer],
    injectedTimeline: timeline40,
    forEach: "tool",
    maxStepScores: 32,
  });

  assert.equal(records40.length, 32, "must score exactly up to maxStepScores cap without throwing");
  assert.equal(records40[0]?.stepId, "tool-0");
  assert.equal(records40[31]?.stepId, "tool-31");
});

// ─── Test 4: runWorkflowExperiment with functionNode DAG ──────────────────────

test("workflow experiment: functionNode DAG, scorer reads timeline.workflowId and node steps", async () => {
  const wf = defineWorkflow({
    id: "eval-wf",
    revision: "v1",
    nodes: {
      step1: {
        kind: "function",
        execute: (ctx) => `processed_${ctx.workflowInput}`,
      },
      step2: {
        kind: "function",
        execute: (ctx) => `finalized_${ctx.upstream.step1}`,
      },
    },
    edges: [["step1", "step2"]],
  });

  const dataset = defineDataset({
    id: "wf-ds",
    items: [
      { id: "row-1", input: "alpha" },
      { id: "row-2", input: "beta" },
    ],
  });

  let inspectedWorkflowId = "";
  const wfScorer = defineScorer({
    id: "wf_topology_scorer",
    score: (input) => {
      const tl = input.timeline;
      assert.ok(tl);
      inspectedWorkflowId = tl.workflowId ?? "";
      const nodeSteps = tl.steps.filter((s) => s.kind === "workflow_node");
      assert.equal(nodeSteps.length, 2);
      return { score: 1.0 };
    },
  });

  const report = await runWorkflowExperiment({
    workflow: wf,
    dataset,
    scorers: [wfScorer],
    timeline: "metadata",
  });

  assert.equal(report.status, "succeeded");
  assert.equal(report.items.length, 2);
  assert.equal(report.evaluations.length, 2);
  assert.equal(report.aggregate.meanScore, 1.0);
  assert.equal(inspectedWorkflowId, "eval-wf");

  // Verify threshold helper works on workflow report (Test 5 in acceptance criteria)
  assert.doesNotThrow(() => {
    assertEvaluationThreshold(report, {
      minimumMean: 1.0,
      maximumFailures: 0,
      minimumByScorer: { wf_topology_scorer: 1.0 },
    });
  });
});
