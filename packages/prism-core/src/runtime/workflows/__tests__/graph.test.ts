import assert from "node:assert/strict";
import test from "node:test";
import { defineWorkflow } from "../define.js";
import { WorkflowDefinitionError } from "../errors.js";
import { collectWorkflowGraphs, createWorkflowGraphRunFolder, projectWorkflowGraphRun, serializeWorkflowGraph } from "../graph.js";
import { workflowGraphToDot, workflowGraphToMermaid } from "../graph-export.js";
import type { WorkflowCheckpointValue, WorkflowDefinition } from "../types.js";

// ─── Test 1: Linear 2-node ───────────────────────────────────────────────────

test("linear 2-node: mermaid contains both ids and one arrow; DOT parseable-enough (quoted ids)", () => {
  const wf = defineWorkflow({
    id: "linear-wf",
    revision: "v1",
    nodes: {
      stepA: {
        kind: "function",
        execute: () => "resultA",
      },
      stepB: {
        kind: "tool",
        tool: "dummy",
        args: () => ({}),
      },
    },
    edges: [["stepA", "stepB"]],
  });

  const view = serializeWorkflowGraph(wf);

  assert.equal(view.schemaVersion, 1);
  assert.equal(view.workflowId, "linear-wf");
  assert.equal(view.revision, "v1");
  assert.equal(view.nodes.length, 2);
  assert.equal(view.edges.length, 1);
  assert.equal(view.edges[0]?.kind, "always");

  // Mermaid check
  const mermaid = workflowGraphToMermaid(view);
  assert.ok(mermaid.includes("stepA"));
  assert.ok(mermaid.includes("stepB"));
  assert.ok(mermaid.includes("stepA --> stepB"));

  // DOT check (quoted ids)
  const dot = workflowGraphToDot(view);
  assert.ok(dot.includes('"stepA"'));
  assert.ok(dot.includes('"stepB"'));
  assert.ok(dot.includes('"stepA" -> "stepB";'));
});

// ─── Test 2: Conditional then/else & skipped node on overlay ─────────────────

test("conditional then/else: two edge kinds; skipped node skipped on overlay", () => {
  const wf = defineWorkflow({
    id: "cond-wf",
    revision: "v1",
    nodes: {
      check: {
        kind: "conditional",
        when: () => true,
        then: ["handleTrue"],
        else: ["handleFalse"],
      },
      handleTrue: {
        kind: "function",
        execute: () => "trueBranch",
      },
      handleFalse: {
        kind: "function",
        execute: () => "falseBranch",
      },
    },
    edges: [
      ["check", "handleTrue"],
      ["check", "handleFalse"],
    ],
  });

  const view = serializeWorkflowGraph(wf);

  // Check edge kinds
  const thenEdge = view.edges.find((e) => e.to === "handleTrue");
  const elseEdge = view.edges.find((e) => e.to === "handleFalse");
  assert.ok(thenEdge);
  assert.equal(thenEdge.kind, "then");
  assert.ok(elseEdge);
  assert.equal(elseEdge.kind, "else");

  // Mermaid renders edge text
  const mermaid = workflowGraphToMermaid(view);
  assert.ok(mermaid.includes("check -->|then| handleTrue"));
  assert.ok(mermaid.includes("check -->|else| handleFalse"));

  // Checkpoint with skipped node
  const checkpoint: WorkflowCheckpointValue = {
    schemaVersion: 1,
    workflowId: "cond-wf",
    runId: "run-cond-1",
    definitionHash: view.definitionHash,
    status: "succeeded",
    readyNodeIds: [],
    completedNodeIds: ["check", "handleTrue"],
    nodes: {
      check: { nodeId: "check", status: "succeeded" },
      handleTrue: { nodeId: "handleTrue", status: "succeeded" },
      handleFalse: { nodeId: "handleFalse", status: "skipped" },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    redacted: false,
  };

  const overlay = projectWorkflowGraphRun(view, checkpoint);
  assert.equal(overlay.runId, "run-cond-1");
  assert.equal(overlay.runStatus, "succeeded");
  assert.equal(overlay.nodeStates.handleFalse?.status, "skipped");
  assert.equal(overlay.nodeStates.handleTrue?.status, "succeeded");
  assert.equal(overlay.nodes.find((n) => n.id === "handleFalse")?.run?.status, "skipped");
});

// ─── Test 3: Loop node metadata & iteration events ───────────────────────────

test("loop node: loop.maxIterations on view; iteration events do not duplicate graph nodes", () => {
  const wf = defineWorkflow({
    id: "loop-wf",
    revision: "v1",
    nodes: {
      loop1: {
        kind: "loop",
        execute: () => ({ done: true }),
        until: () => true,
        maxIterations: 5,
      },
    },
    edges: [],
  });

  const view = serializeWorkflowGraph(wf);
  const loopNode = view.nodes.find((n) => n.id === "loop1");
  assert.ok(loopNode);
  assert.equal(loopNode.kind, "loop");
  assert.deepStrictEqual(loopNode.loop, { maxIterations: 5 });

  // Mermaid loop node shape: {{...}}
  const mermaid = workflowGraphToMermaid(view);
  assert.ok(mermaid.includes('loop1{{"loop1"}}'));

  // Live folder with iteration events
  const folder = createWorkflowGraphRunFolder(view);
  folder.push({
    type: "workflow_started",
    workflowId: "loop-wf",
    runId: "run-loop-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    sequence: 1,
  });
  folder.push({
    type: "node_started",
    workflowId: "loop-wf",
    runId: "run-loop-1",
    nodeId: "loop1",
    timestamp: "2026-01-01T00:00:00.100Z",
    sequence: 2,
  });
  folder.push({
    type: "node_iteration_started",
    workflowId: "loop-wf",
    runId: "run-loop-1",
    nodeId: "loop1",
    iteration: 1,
    iterationId: "iter-1",
    timestamp: "2026-01-01T00:00:00.200Z",
    sequence: 3,
  });
  folder.push({
    type: "node_iteration_finished",
    workflowId: "loop-wf",
    runId: "run-loop-1",
    nodeId: "loop1",
    iteration: 1,
    iterationId: "iter-1",
    done: true,
    timestamp: "2026-01-01T00:00:00.300Z",
    sequence: 4,
  });
  folder.push({
    type: "node_finished",
    workflowId: "loop-wf",
    runId: "run-loop-1",
    nodeId: "loop1",
    timestamp: "2026-01-01T00:00:00.400Z",
    sequence: 5,
  });

  const snapshot = folder.snapshot();
  // Exactly 1 node in the graph, not duplicated by iterations
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(snapshot.nodeStates.loop1?.status, "succeeded");
  assert.equal(snapshot.nodeStates.loop1?.durationMs, 300);
});

// ─── Test 4: Nested workflow & collectWorkflowGraphs ─────────────────────────

test("nested workflow: nestedWorkflowId set; collectWorkflowGraphs size 2", () => {
  const childWf = defineWorkflow({
    id: "child-wf",
    revision: "v1",
    nodes: {
      childTask: {
        kind: "function",
        execute: () => "childDone",
      },
    },
    edges: [],
  });

  const parentWf = defineWorkflow({
    id: "parent-wf",
    revision: "v1",
    nodes: {
      subflow: {
        kind: "workflow",
        workflow: childWf,
      },
    },
    edges: [],
  });

  const parentView = serializeWorkflowGraph(parentWf);
  const subflowNode = parentView.nodes.find((n) => n.id === "subflow");
  assert.ok(subflowNode);
  assert.equal(subflowNode.kind, "workflow");
  assert.equal(subflowNode.nestedWorkflowId, "child-wf");

  // Collect all graphs
  const graphMap = collectWorkflowGraphs(parentWf);
  assert.equal(graphMap.size, 2);
  assert.ok(graphMap.has("parent-wf"));
  assert.ok(graphMap.has("child-wf"));

  const childView = graphMap.get("child-wf");
  assert.ok(childView);
  assert.equal(childView.workflowId, "child-wf");
  assert.equal(childView.nodes.length, 1);
});

// ─── Test 5: Label with quotes/--> escaped in mermaid ────────────────────────

test("label with quotes/--> escaped in mermaid", () => {
  const wf = defineWorkflow({
    id: "escape-wf",
    revision: "v1",
    nodes: {
      complexNode: {
        kind: "function",
        execute: () => {},
        metadata: {
          title: 'Say "hello" --> next step',
        },
      },
    },
    edges: [],
  });

  const view = serializeWorkflowGraph(wf);
  assert.equal(view.nodes[0]?.label, 'Say "hello" --> next step');

  const mermaid = workflowGraphToMermaid(view);
  // Quotes must be escaped as #quot;
  assert.ok(!mermaid.includes('"hello"'), "Unescaped quotes must not appear inside mermaid node label");
  assert.ok(mermaid.includes("#quot;hello#quot;"));
  // Literal arrow must have > escaped so it does not parse as edge arrow
  assert.ok(!mermaid.includes("--> next"), "Literal --> must be escaped");
  assert.ok(mermaid.includes("--#gt;"));

  // DOT export should escape quotes with backslash
  const dot = workflowGraphToDot(view);
  assert.ok(dot.includes('\\"hello\\"'));
});

// ─── Test 6: Overlay live folder: node_started -> running; node_failed -> failed + errorCode ───

test("overlay live folder: node_started -> running; node_failed -> failed + errorCode", () => {
  const wf = defineWorkflow({
    id: "fail-wf",
    revision: "v1",
    nodes: {
      taskA: {
        kind: "function",
        execute: () => {},
      },
      taskB: {
        kind: "function",
        execute: () => {},
      },
    },
    edges: [["taskA", "taskB"]],
  });

  const view = serializeWorkflowGraph(wf);
  const folder = createWorkflowGraphRunFolder(view);

  // Initially pending
  let snapshot = folder.snapshot();
  assert.equal(snapshot.runStatus, "pending");
  assert.equal(snapshot.nodeStates.taskA?.status, "pending");
  assert.equal(snapshot.nodeStates.taskB?.status, "pending");

  // Workflow started & node_started
  folder.push({
    type: "workflow_started",
    workflowId: "fail-wf",
    runId: "run-f-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    sequence: 1,
  });
  folder.push({
    type: "node_started",
    workflowId: "fail-wf",
    runId: "run-f-1",
    nodeId: "taskA",
    timestamp: "2026-01-01T00:00:01.000Z",
    sequence: 2,
  });

  snapshot = folder.snapshot();
  assert.equal(snapshot.runStatus, "running");
  assert.equal(snapshot.nodeStates.taskA?.status, "running");
  assert.deepStrictEqual(snapshot.activeNodeIds, ["taskA"]);

  // node_failed
  folder.push({
    type: "node_failed",
    workflowId: "fail-wf",
    runId: "run-f-1",
    nodeId: "taskA",
    error: { message: "connection refused", code: "ERR_NETWORK_FAIL" },
    timestamp: "2026-01-01T00:00:02.500Z",
    sequence: 3,
  });

  snapshot = folder.snapshot();
  assert.equal(snapshot.nodeStates.taskA?.status, "failed");
  assert.equal(snapshot.nodeStates.taskA?.errorCode, "ERR_NETWORK_FAIL");
  assert.equal(snapshot.nodeStates.taskA?.durationMs, 1500);
  assert.deepStrictEqual(snapshot.activeNodeIds, []);
});

// ─── Test 7: Byte-identical mermaid for shuffled nodes insertion (sort) ───────

test("byte-identical mermaid for shuffled nodes record insertion (sort)", () => {
  const wf1: WorkflowDefinition = {
    id: "shuffled-wf",
    revision: "v1",
    nodes: {
      charlie: { kind: "function", execute: () => {} },
      alpha: { kind: "function", execute: () => {} },
      bravo: { kind: "function", execute: () => {} },
    },
    edges: [
      ["bravo", "charlie"],
      ["alpha", "bravo"],
    ],
  };

  const wf2: WorkflowDefinition = {
    id: "shuffled-wf",
    revision: "v1",
    nodes: {
      alpha: { kind: "function", execute: () => {} },
      bravo: { kind: "function", execute: () => {} },
      charlie: { kind: "function", execute: () => {} },
    },
    edges: [
      ["alpha", "bravo"],
      ["bravo", "charlie"],
    ],
  };

  const view1 = serializeWorkflowGraph(wf1);
  const view2 = serializeWorkflowGraph(wf2);

  const mermaid1 = workflowGraphToMermaid(view1);
  const mermaid2 = workflowGraphToMermaid(view2);

  assert.equal(mermaid1, mermaid2, "Mermaid strings must be byte-identical regardless of insertion order");

  const dot1 = workflowGraphToDot(view1);
  const dot2 = workflowGraphToDot(view2);

  assert.equal(dot1, dot2, "DOT strings must be byte-identical regardless of insertion order");
});

// ─── Test 8: Max nodes boundary validation ───────────────────────────────────

test("serializeWorkflowGraph rejects graphs exceeding maxNodes", () => {
  const nodes: Record<string, any> = {};
  for (let i = 0; i < 5; i++) {
    nodes[`n${i}`] = { kind: "function", execute: () => {} };
  }

  const wf: WorkflowDefinition = {
    id: "big-wf",
    revision: "v1",
    nodes,
    edges: [],
    limits: { maxNodes: 3 },
  };

  assert.throws(
    () => serializeWorkflowGraph(wf),
    (err: unknown) => err instanceof WorkflowDefinitionError,
  );
});

// ─── Test 9: Overlay projection from timeline source ─────────────────────────

test("projectWorkflowGraphRun from timeline source", () => {
  const wf = defineWorkflow({
    id: "timeline-run-wf",
    revision: "v1",
    nodes: {
      n1: { kind: "function", execute: () => {} },
      n2: { kind: "function", execute: () => {} },
    },
    edges: [["n1", "n2"]],
  });

  const view = serializeWorkflowGraph(wf);
  const timelineSource = {
    runId: "run-tl-1",
    status: "succeeded",
    steps: [
      {
        id: "wfnode:n1",
        kind: "workflow_node",
        name: "n1",
        status: "succeeded",
        durationMs: 120,
      },
      {
        id: "wfnode:n2",
        kind: "workflow_node",
        name: "n2",
        status: "skipped",
        metadata: { skippedReason: "condition not met" },
      },
    ],
  };

  const overlay = projectWorkflowGraphRun(view, timelineSource);
  assert.equal(overlay.runId, "run-tl-1");
  assert.equal(overlay.runStatus, "succeeded");
  assert.equal(overlay.nodeStates.n1?.status, "succeeded");
  assert.equal(overlay.nodeStates.n1?.durationMs, 120);
  assert.equal(overlay.nodeStates.n2?.status, "skipped");
  assert.equal(overlay.nodeStates.n2?.skippedReason, "condition not met");
});
