import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createMemoryLeaseStore, createSecretRedactor } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  functionNode,
  getWorkflowRun,
  resumeWorkflow,
  routeNode,
  runWorkflow,
  suspend,
  WorkflowCheckpointError,
  WorkflowSuperstepLimitError,
  type WorkflowCheckpointRecord,
  type WorkflowEvent,
} from "../index.js";
import { hashWorkflowDefinition } from "../util.js";
import { prepareCheckpointRecord } from "../checkpoint-core.js";

describe("cyclic workflow durability and checkpoint schema v2 (Plan 130 Task 5)", () => {
  it("suspend inside cyclic node body persists v2 checkpoint with execution block and resumes mid-cycle", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let workerInvocations = 0;
    let reviewerInvocations = 0;

    const wf = defineWorkflow({
      id: "cyclic-durability-suspend",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        worker: functionNode({
          activation: "any",
          execute: async () => {
            workerInvocations += 1;
            const iteration = workerInvocations;
            return { draft: `draft-v${iteration}` };
          },
        }),
        reviewer: routeNode({
          select: async (ctx) => {
            reviewerInvocations += 1;
            if (!ctx.resume) {
              return suspend({
                reason: "human-feedback-needed",
                data: { currentDraft: ctx.upstream.worker },
              });
            }
            const input = ctx.resume.input as { approved: boolean };
            return input.approved ? ["done"] : ["worker"];
          },
        }),
        done: functionNode({
          execute: () => "completed",
        }),
      },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    const result = await runWorkflow(wf, null, {
      checkpoints,
      runId: "run-suspend-v2",
    });

    assert.equal(result.status, "suspended");
    assert.equal(result.suspension?.reason, "human-feedback-needed");
    assert.equal(workerInvocations, 1);
    assert.equal(reviewerInvocations, 1);

    // Verify persisted checkpoint record has schemaVersion: 2 and execution block
    const stored = await getWorkflowRun(checkpoints, {
      workflowId: wf.id,
      runId: "run-suspend-v2",
    });
    assert.ok(stored);
    assert.equal(stored.value.schemaVersion, 2);
    assert.ok(stored.value.execution);
    assert.equal(stored.value.execution.mode, "supersteps");
    assert.equal(stored.value.execution.superstep, 1);
    assert.equal(stored.value.execution.maxSupersteps, 10);
    assert.equal(stored.value.nodes.worker?.status, "succeeded");
    assert.equal(stored.value.nodes.worker?.iteration, 1);
    assert.equal(stored.value.nodes.worker?.iterations?.length, 1);
    assert.equal(stored.value.nodes.reviewer?.status, "suspended");

    // Resume the suspended workflow: decisions are not re-executed
    const resumed = await resumeWorkflow(
      wf,
      { runId: "run-suspend-v2" },
      {
        checkpoints,
        resume: {
          decision: "approve",
          input: { approved: true },
          expectedVersion: result.version,
        },
      },
    );

    assert.equal(resumed.status, "succeeded");
    // Worker was not re-executed on resume; reviewer continued from suspension
    assert.equal(workerInvocations, 1);
    assert.equal(reviewerInvocations, 2);

    // Final checkpoint has schemaVersion: 2
    const finalStored = await getWorkflowRun(checkpoints, {
      workflowId: wf.id,
      runId: "run-suspend-v2",
    });
    assert.ok(finalStored);
    assert.equal(finalStored.value.schemaVersion, 2);
    assert.equal(finalStored.value.status, "succeeded");
  });

  it("kill and resume mid-wave achieves exactly-once node executions", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const executions: Record<string, number> = { a: 0, b: 0, c: 0 };
    const abortController = new AbortController();

    const wf = defineWorkflow({
      id: "cyclic-exactly-once",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        a: functionNode({
          execute: async () => {
            executions.a += 1;
            return { step: "a" };
          },
        }),
        b: functionNode({
          execute: async () => {
            executions.b += 1;
            return { step: "b" };
          },
        }),
        c: functionNode({
          execute: async () => {
            executions.c += 1;
            return { step: "c" };
          },
        }),
      },
      edges: [
        ["a", "b"],
        ["b", "c"],
      ],
    });

    const runEvents: WorkflowEvent[] = [];
    // Abort right after wave 0 (node a) completes and saves its checkpoint
    const runPromise = runWorkflow(wf, null, {
      checkpoints,
      runId: "run-kill-resume",
      signal: abortController.signal,
      onEvent: (event) => {
        runEvents.push(event);
        if (event.type === "checkpoint_saved" && event.version === 2) {
          abortController.abort();
        }
      },
    });

    await assert.rejects(runPromise, /aborted/i);
    assert.equal(executions.a, 1);
    assert.equal(executions.b, 0);
    assert.equal(executions.c, 0);

    // Resume the run with fresh options
    const resumeEvents: WorkflowEvent[] = [];
    const resumed = await resumeWorkflow(
      wf,
      { runId: "run-kill-resume" },
      {
        checkpoints,
        onEvent: (event) => {
          resumeEvents.push(event);
        },
      },
    );

    assert.equal(resumed.status, "succeeded");
    // Node a was not re-executed; b and c ran exactly once
    assert.equal(executions.a, 1);
    assert.equal(executions.b, 1);
    assert.equal(executions.c, 1);

    // Count finished events for node a across initial run and resumed run
    const aFinished = [...runEvents, ...resumeEvents].filter((e) => e.type === "node_finished" && e.nodeId === "a");
    assert.equal(aFinished.length, 1);
  });

  it("budget is re-checked on resume: resumed run at superstep 11 of 12 breaches WorkflowSuperstepLimitError", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let loops = 0;

    const wf = defineWorkflow({
      id: "cyclic-budget-resume",
      revision: "1",
      limits: { maxSupersteps: 12 },
      nodes: {
        stepA: functionNode({
          activation: "any",
          execute: async () => {
            loops += 1;
            return { loops };
          },
        }),
        stepB: functionNode({
          activation: "any",
          execute: async (ctx) => {
            if (!ctx.resume) {
              return suspend({ reason: "budget-check-test" });
            }
            return { ok: true };
          },
        }),
      },
      edges: [
        ["stepA", "stepB"],
        ["stepB", "stepA"],
      ],
    });

    // Create a checkpoint record simulating a run suspended/persisted at superstep 11 of 12
    const now = new Date().toISOString();
    const checkpoint: WorkflowCheckpointRecord = {
      workflowId: wf.id,
      runId: "run-budget-11",
      version: 5,
      updatedAt: now,
      value: {
        schemaVersion: 2,
        workflowId: wf.id,
        runId: "run-budget-11",
        definitionHash: hashWorkflowDefinition(wf),
        status: "suspended",
        readyNodeIds: ["stepB"],
        completedNodeIds: ["stepA"],
        nodes: {
          stepA: { nodeId: "stepA", status: "succeeded", output: { loops: 5 } },
          stepB: { nodeId: "stepB", status: "suspended" },
        },
        suspension: {
          nodeId: "stepB",
          reason: "budget-check-test",
          requestedAt: now,
        },
        createdAt: now,
        updatedAt: now,
        redacted: false,
        execution: {
          mode: "supersteps",
          superstep: 11,
          maxSupersteps: 12,
          pending: {},
        },
      },
    };

    await checkpoints.save({
      workflowId: wf.id,
      runId: "run-budget-11",
      version: 5,
      expectedVersion: 0,
      value: checkpoint.value,
    });

    // Resuming at superstep 11 executes wave 11 (stepB), triggers stepA for wave 12, advancing superstep to 12, breaching maxSupersteps: 12
    await assert.rejects(
      async () => {
        await resumeWorkflow(
          wf,
          { runId: "run-budget-11" },
          {
            checkpoints,
            resume: { decision: "approve", expectedVersion: 5 },
          },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof WorkflowSuperstepLimitError);
        assert.equal(error.code, "ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT");
        assert.equal(error.supersteps, 12);
        assert.equal(error.maxSupersteps, 12);
        return true;
      },
    );
  });

  it("v1 checkpoint loads and resumes on DAG path unchanged", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let step2Executed = false;

    const dagWf = defineWorkflow({
      id: "dag-v1-resume",
      revision: "1",
      nodes: {
        step1: functionNode({
          execute: () => ({ v1Output: "hello" }),
        }),
        step2: functionNode({
          execute: (ctx) => {
            step2Executed = true;
            return { received: ctx.upstream.step1 };
          },
        }),
      },
      edges: [["step1", "step2"]],
    });

    const now = new Date().toISOString();
    const v1Record: WorkflowCheckpointRecord = {
      workflowId: dagWf.id,
      runId: "run-v1-test",
      version: 1,
      updatedAt: now,
      value: {
        schemaVersion: 1,
        workflowId: dagWf.id,
        runId: "run-v1-test",
        definitionHash: hashWorkflowDefinition(dagWf),
        status: "suspended",
        readyNodeIds: [],
        completedNodeIds: ["step1"],
        nodes: {
          step1: { nodeId: "step1", status: "succeeded", output: { v1Output: "hello" } },
          step2: { nodeId: "step2", status: "suspended" },
        },
        suspension: {
          nodeId: "step2",
          reason: "needs approval",
          requestedAt: now,
        },
        createdAt: now,
        updatedAt: now,
        redacted: false,
      },
    };

    await checkpoints.save({
      workflowId: dagWf.id,
      runId: "run-v1-test",
      version: 1,
      expectedVersion: 0,
      value: v1Record.value,
    });

    const resumed = await resumeWorkflow(
      dagWf,
      { runId: "run-v1-test" },
      {
        checkpoints,
        resume: { decision: "approve", expectedVersion: 1 },
      },
    );

    assert.equal(resumed.status, "succeeded");
    assert.equal(step2Executed, true);
    assert.deepEqual(resumed.outputs.step2, { received: { v1Output: "hello" } });
  });

  it("schemaVersion 3 fixture fails closed with WorkflowCheckpointError", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({
      id: "future-schema",
      revision: "1",
      nodes: {
        step: functionNode({ execute: () => "ok" }),
      },
      edges: [],
    });

    const now = new Date().toISOString();
    const v3Record: WorkflowCheckpointRecord = {
      workflowId: wf.id,
      runId: "run-v3-test",
      version: 1,
      updatedAt: now,
      value: {
        schemaVersion: 3,
        workflowId: wf.id,
        runId: "run-v3-test",
        definitionHash: hashWorkflowDefinition(wf),
        status: "suspended",
        readyNodeIds: [],
        completedNodeIds: [],
        nodes: { step: { nodeId: "step", status: "suspended" } },
        suspension: { nodeId: "step", reason: "future", requestedAt: now },
        createdAt: now,
        updatedAt: now,
        redacted: false,
      },
    };

    // prepareCheckpointRecord fails closed on schemaVersion: 3
    assert.throws(
      () => {
        prepareCheckpointRecord(
          {
            workflowId: wf.id,
            runId: "run-v3-test",
            version: 1,
            value: v3Record.value,
          },
          { maxCheckpointBytes: 1024 * 1024, maxNodeOutputBytes: 1024 * 1024 },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof WorkflowCheckpointError);
        assert.match(error.message, /Unsupported checkpoint schemaVersion 3/);
        return true;
      },
    );

    // resumeWorkflow fails closed on schemaVersion: 3
    await checkpoints.save({
      workflowId: wf.id,
      runId: "run-v3-test",
      version: 1,
      expectedVersion: 0,
      value: { ...v3Record.value, schemaVersion: 2 }, // bypass adapter save to store record
    });

    // Mutate underlying store to schemaVersion 3
    const loaded = await checkpoints.load({ workflowId: wf.id, runId: "run-v3-test" });
    assert.ok(loaded);
    (loaded.value as { schemaVersion: number }).schemaVersion = 3;

    await assert.rejects(
      async () => {
        await resumeWorkflow(wf, { runId: "run-v3-test" }, { checkpoints, resume: { decision: "approve", expectedVersion: 1 } });
      },
      (error: unknown) => {
        assert.ok(error instanceof WorkflowCheckpointError);
        assert.match(error.message, /Unsupported checkpoint schemaVersion 3/);
        return true;
      },
    );
  });

  it("schemaVersion 0 fails closed with WorkflowCheckpointError", async () => {
    const wf = defineWorkflow({
      id: "schema-zero",
      revision: "1",
      nodes: {
        step: functionNode({ execute: () => "ok" }),
      },
      edges: [],
    });

    const now = new Date().toISOString();
    assert.throws(
      () => {
        prepareCheckpointRecord(
          {
            workflowId: wf.id,
            runId: "run-v0-test",
            version: 1,
            value: {
              schemaVersion: 0,
              workflowId: wf.id,
              runId: "run-v0-test",
              definitionHash: hashWorkflowDefinition(wf),
              status: "running",
              readyNodeIds: [],
              completedNodeIds: [],
              nodes: { step: { nodeId: "step", status: "pending" } },
              createdAt: now,
              updatedAt: now,
              redacted: false,
            },
          },
          { maxCheckpointBytes: 1024 * 1024, maxNodeOutputBytes: 1024 * 1024 },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof WorkflowCheckpointError);
        assert.match(error.message, /Unsupported checkpoint schemaVersion 0/);
        return true;
      },
    );
  });

  it("coordinator claims a suspended cyclic run and resumes it with lease fencing", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    let reviewerRuns = 0;

    const wf = defineWorkflow({
      id: "coordinator-cyclic",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        worker: functionNode({
          activation: "any",
          execute: () => ({ draft: "initial" }),
        }),
        reviewer: routeNode({
          select: (ctx) => {
            reviewerRuns += 1;
            if (!ctx.resume) {
              return suspend({ reason: "coordinator-review" });
            }
            return ["done"];
          },
        }),
        done: functionNode({
          execute: () => "ok",
        }),
      },
      edges: [
        ["worker", "reviewer"],
        ["reviewer", "worker"],
        ["reviewer", "done"],
      ],
    });

    // 1. Initial run suspends
    const suspended = await runWorkflow(wf, null, {
      checkpoints,
      runId: "coord-run-1",
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(reviewerRuns, 1);

    // 2. Coordinator configured to claim suspended runs with approve resume
    const coordinator = createWorkflowCoordinator({
      coordinatorId: "worker-coord",
      workflows: { [wf.id]: wf },
      checkpoints,
      leases,
      admission: { statuses: ["suspended"] },
      runOptions: {
        resume: { decision: "approve", input: { note: "claimed by coordinator" }, expectedVersion: suspended.version },
      },
    });

    const claimed = await coordinator.pollOnce();
    assert.equal(claimed, 1);

    // Wait for the run to complete
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const record = await getWorkflowRun(checkpoints, {
        workflowId: wf.id,
        runId: "coord-run-1",
      });
      if (record?.value.status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const finalRecord = await getWorkflowRun(checkpoints, {
      workflowId: wf.id,
      runId: "coord-run-1",
    });
    assert.equal(finalRecord?.value.status, "succeeded");
    assert.equal(reviewerRuns, 2);
  });

  it("redacts iteration outputs and pending payloads before checkpoint persistence", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const secret = "sk-super-secret-token-12345";

    const wf = defineWorkflow({
      id: "cyclic-redaction",
      revision: "1",
      limits: { maxSupersteps: 5 },
      nodes: {
        producer: functionNode({
          execute: () => ({ apiKey: secret }),
        }),
        consumer: functionNode({
          execute: (ctx) => ({ received: ctx.upstream.producer }),
        }),
      },
      edges: [["producer", "consumer"]],
    });

    const redactor = createSecretRedactor([secret]);

    const result = await runWorkflow(wf, null, {
      checkpoints,
      runId: "run-redact",
      redactor,
    });
    assert.equal(result.status, "succeeded");

    const record = await getWorkflowRun(checkpoints, {
      workflowId: wf.id,
      runId: "run-redact",
    });
    assert.ok(record);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(secret), "Secret must not appear in persisted checkpoint");
    assert.ok(serialized.includes("[REDACTED]"), "Redacted placeholder must appear in checkpoint");
  });

  it("definitionHash mismatch fails closed on resume", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();

    const wf1 = defineWorkflow({
      id: "hash-mismatch-test",
      revision: "1",
      limits: { maxSupersteps: 10 },
      nodes: {
        step: functionNode({
          execute: () => suspend({ reason: "check-hash" }),
        }),
      },
      edges: [],
    });

    const suspended = await runWorkflow(wf1, null, {
      checkpoints,
      runId: "run-hash-mismatch",
    });
    assert.equal(suspended.status, "suspended");

    // Definition changed (e.g. revision bumped or limit changed)
    const wf2 = defineWorkflow({
      id: "hash-mismatch-test",
      revision: "2",
      limits: { maxSupersteps: 20 },
      nodes: {
        step: functionNode({
          execute: () => "ok",
        }),
      },
      edges: [],
    });

    await assert.rejects(
      async () => {
        await resumeWorkflow(
          wf2,
          { runId: "run-hash-mismatch" },
          {
            checkpoints,
            resume: { decision: "approve", expectedVersion: suspended.version },
          },
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof WorkflowCheckpointError);
        assert.match(error.message, /Workflow definition hash mismatch on resume/);
        return true;
      },
    );
  });
});
