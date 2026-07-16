import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  replayWorkflow,
  runWorkflow,
  suspend,
  toolNode,
  workflowNode,
  WorkflowCheckpointError,
  WorkflowRuntimeError,
} from "../index.js";

const ownership = { tenantId: "tenant-a", userId: "user-a" } as const;

describe("workflow composition and state", () => {
  test("shares validated bounded state through a nested workflow", async () => {
    const validated: unknown[] = [];
    const child = defineWorkflow({
      id: "child",
      nodes: {
        update: functionNode({ execute: async (ctx) => {
          await ctx.updateState({ child: true });
          return ctx.stateVersion;
        } }),
      },
    });
    const parent = defineWorkflow({
      id: "parent",
      state: { initial: { count: 1 }, schema: { type: "object" } },
      nodes: {
        nested: workflowNode({ workflow: child }),
        finish: functionNode({ execute: (ctx) => ctx.state }),
      },
      edges: [["nested", "finish"]],
    });

    const result = await runWorkflow(parent, null, {
      validateState: ({ value }) => { validated.push(value); },
    });
    assert.deepEqual(result.state, { count: 1, child: true });
    assert.deepEqual(result.outputs.finish, { count: 1, child: true });
    assert.ok(validated.length >= 2);
  });

  test("bubbles nested suspension and resumes child with parent approval", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let effects = 0;
    const child = defineWorkflow({
      id: "review-child",
      nodes: {
        review: functionNode({ execute: (ctx) => ctx.resume ? ++effects : suspend({ reason: "approve child" }) }),
      },
    });
    const parent = defineWorkflow({
      id: "review-parent",
      nodes: { child: workflowNode({ workflow: child }) },
    });
    const first = await runWorkflow(parent, null, { checkpoints, ownership });
    assert.equal(first.status, "suspended");
    const resumed = await (await import("../index.js")).resumeWorkflow(parent, { runId: first.runId }, {
      checkpoints,
      ownership,
      resume: { decision: "approve", expectedVersion: first.version },
    });
    assert.equal(resumed.status, "succeeded");
    assert.equal(effects, 1);

    const deniedFirst = await runWorkflow(parent, null, { checkpoints, ownership, runId: "deny-parent" });
    const denied = await (await import("../index.js")).resumeWorkflow(parent, { runId: deniedFirst.runId }, {
      checkpoints,
      ownership,
      resume: { decision: "deny", expectedVersion: deniedFirst.version },
    });
    assert.equal(denied.status, "denied");
    const childRecord = await checkpoints.load({
      workflowId: child.id,
      runId: "deny-parent~child",
      ownership,
    });
    assert.equal(childRecord?.value.status, "denied");
  });

  test("enforces inherited nesting and state-history ceilings", async () => {
    const leaf = defineWorkflow({ id: "leaf", nodes: { done: functionNode({ execute: () => true }) } });
    const child = defineWorkflow({ id: "middle", nodes: { leaf: workflowNode({ workflow: leaf }) } });
    const parent = defineWorkflow({
      id: "top",
      limits: { maxNestedDepth: 1 },
      nodes: { child: workflowNode({ workflow: child }) },
    });
    await assert.rejects(runWorkflow(parent, null), (error: unknown) =>
      error instanceof WorkflowRuntimeError && error.code === "ERR_PRISM_WORKFLOW_NESTED_DEPTH");

    const stateful = defineWorkflow({
      id: "history",
      limits: { maxStateHistory: 2 },
      nodes: {
        update: functionNode({ execute: async (ctx) => {
          await ctx.updateState({ one: true });
          await ctx.updateState({ two: true });
        } }),
      },
    });
    await assert.rejects(runWorkflow(stateful, null), (error: unknown) =>
      error instanceof WorkflowRuntimeError && error.code === "ERR_PRISM_WORKFLOW_STATE_HISTORY");

    const bounded = defineWorkflow({
      id: "bounded-state",
      limits: { maxStateBytes: 32 },
      nodes: { update: functionNode({ execute: (ctx) => ctx.updateState({ value: "x".repeat(64) }) }) },
    });
    await assert.rejects(runWorkflow(bounded, null), /Workflow state exceeds max bytes/);

    const secret = defineWorkflow({
      id: "redacted-state",
      state: { initial: { token: "state-canary" } },
      nodes: { done: functionNode({ execute: (ctx) => ctx.state }) },
    });
    const safe = await runWorkflow(secret, null, { redactor: createSecretRedactor(["state-canary"]) });
    assert.doesNotMatch(JSON.stringify(safe), /state-canary/);
  });
});

describe("workflow replay", () => {
  test("reruns only selected downstream nodes with immutable lineage and pre-node state", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const calls = { prepare: 0, review: 0, publish: 0 };
    const workflow = defineWorkflow({
      id: "replayable",
      state: { initial: { version: 0 } },
      nodes: {
        prepare: functionNode({ execute: async (ctx) => {
          calls.prepare += 1;
          await ctx.updateState({ version: 1 });
          return "prepared";
        } }),
        review: functionNode({ execute: async (ctx) => {
          calls.review += 1;
          await ctx.updateState({ reviewed: calls.review });
          return ctx.state;
        } }),
        publish: functionNode({ execute: () => ++calls.publish }),
      },
      edges: [["prepare", "review"], ["review", "publish"]],
    });
    const source = await runWorkflow(workflow, null, { checkpoints, ownership });
    const before = await checkpoints.load({ workflowId: workflow.id, runId: source.runId, ownership });
    const replay = await replayWorkflow(workflow, {
      sourceRunId: source.runId,
      fromNodeId: "review",
    }, { checkpoints, ownership });
    const after = await checkpoints.load({ workflowId: workflow.id, runId: source.runId, ownership });

    assert.deepEqual(calls, { prepare: 1, review: 2, publish: 2 });
    assert.deepEqual(replay.state, { version: 1, reviewed: 2 });
    assert.equal(replay.lineage?.sourceRunId, source.runId);
    assert.equal(replay.lineage?.fromNodeId, "review");
    assert.deepEqual(after, before);
  });

  test("rejects replay that would copy prior approval or cross ownership", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      id: "approval-replay",
      nodes: {
        approval: toolNode({
          tool: { name: "safe", description: "safe", parameters: {}, execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "safe", value: true }) },
          args: () => ({}),
          approval: { reason: "approve" },
        }),
        after: functionNode({ execute: () => true }),
      },
      edges: [["approval", "after"]],
    });
    const first = await runWorkflow(workflow, null, { checkpoints, ownership });
    const source = await (await import("../index.js")).resumeWorkflow(workflow, { runId: first.runId }, {
      checkpoints,
      ownership,
      resume: { decision: "approve", expectedVersion: first.version },
    });
    await assert.rejects(
      replayWorkflow(workflow, { sourceRunId: source.runId, fromNodeId: "after" }, { checkpoints, ownership }),
      WorkflowCheckpointError,
    );
    await assert.rejects(
      replayWorkflow(workflow, { sourceRunId: source.runId, fromNodeId: "approval" }, {
        checkpoints,
        ownership: { tenantId: "tenant-b", userId: "user-b" },
      }),
    );
  });
});
