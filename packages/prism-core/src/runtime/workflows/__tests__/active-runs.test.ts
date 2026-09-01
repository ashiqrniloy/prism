import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVE_WORKFLOW_RUNS_OVERFLOW_CODE,
  abortActiveWorkflowRun,
  cancelWorkflowRun,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  getActiveWorkflowRun,
  listActiveWorkflowRuns,
  MAX_ACTIVE_WORKFLOW_RUNS,
  registerActiveWorkflowRun,
  runWorkflow,
  suspend,
  sweepActiveWorkflowRuns,
  unregisterActiveWorkflowRun,
  WorkflowAbortError,
  WorkflowCheckpointError,
  WorkflowRuntimeError,
} from "../index.js";

const victim = { tenantId: "tenant", userId: "victim" } as const;
const attacker = { tenantId: "tenant", userId: "attacker" } as const;

describe("owned active workflow runs", () => {
  it("keys exact ownership, rejects duplicates, and isolates list/abort/unregister", () => {
    const victimController = new AbortController();
    const attackerController = new AbortController();
    registerActiveWorkflowRun({ workflowId: "same", runId: "same", ownership: victim, definitionHash: "v1", controller: victimController });
    registerActiveWorkflowRun({
      workflowId: "same",
      runId: "same",
      ownership: attacker,
      definitionHash: "v1",
      controller: attackerController,
    });
    try {
      assert.throws(
        () =>
          registerActiveWorkflowRun({
            workflowId: "same",
            runId: "same",
            ownership: victim,
            definitionHash: "v1",
            controller: new AbortController(),
          }),
        (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "ERR_PRISM_WORKFLOW_ALREADY_ACTIVE",
      );
      assert.equal(listActiveWorkflowRuns({ ownership: victim }).length, 1);
      assert.equal(listActiveWorkflowRuns({ ownership: { tenantId: "tenant" } }).length, 0);
      assert.equal(abortActiveWorkflowRun("same", "same", { tenantId: "tenant" }, "v1"), false);
      assert.equal(victimController.signal.aborted, false);
      assert.throws(() => abortActiveWorkflowRun("same", "same", victim, "changed"), WorkflowCheckpointError);
      assert.equal(victimController.signal.aborted, false);
    } finally {
      unregisterActiveWorkflowRun("same", "same", victim);
      assert.equal(getActiveWorkflowRun("same", "same", victim), undefined);
      assert.ok(getActiveWorkflowRun("same", "same", attacker));
      unregisterActiveWorkflowRun("same", "same", attacker);
    }
  });

  it("authorizes exact owner and revision before active or durable cancellation", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const node = functionNode({
      execute: async (ctx) => {
        await new Promise<void>((_resolve, reject) =>
          ctx.signal?.addEventListener("abort", () => reject(new WorkflowAbortError()), { once: true }),
        );
      },
    });
    const workflow = defineWorkflow({ revision: "1", id: "owned", nodes: { node } });
    const changed = defineWorkflow({ revision: "2", id: "owned", nodes: { node } });
    const running = runWorkflow(workflow, null, { checkpoints, ownership: victim, runId: "active" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await assert.rejects(
      cancelWorkflowRun({ workflowId: "owned", runId: "active", workflow, checkpoints, ownership: { tenantId: "tenant" } }),
      WorkflowCheckpointError,
    );
    assert.ok(getActiveWorkflowRun("owned", "active", victim));
    await assert.rejects(
      cancelWorkflowRun({ workflowId: "owned", runId: "active", workflow: changed, checkpoints, ownership: victim }),
      /definition hash mismatch/i,
    );
    assert.ok(getActiveWorkflowRun("owned", "active", victim));
    await cancelWorkflowRun({ workflowId: "owned", runId: "active", workflow, checkpoints, ownership: victim });
    await assert.rejects(running, WorkflowAbortError);

    const suspendedWorkflow = defineWorkflow({
      revision: "1",
      id: "durable",
      nodes: { node: functionNode({ execute: () => suspend({ reason: "review" }) }) },
    });
    const suspended = await runWorkflow(suspendedWorkflow, null, { checkpoints, ownership: victim, runId: "suspended" });
    assert.equal(suspended.status, "suspended");
    await assert.rejects(
      cancelWorkflowRun({ workflowId: "durable", runId: "suspended", workflow: suspendedWorkflow, checkpoints, ownership: attacker }),
      WorkflowCheckpointError,
    );
    const changedDurable = defineWorkflow({ revision: "2", id: "durable", nodes: suspendedWorkflow.nodes });
    await assert.rejects(
      cancelWorkflowRun({ workflowId: "durable", runId: "suspended", workflow: changedDurable, checkpoints, ownership: victim }),
      /definition hash mismatch/i,
    );
    const cancelled = await cancelWorkflowRun({
      workflowId: "durable",
      runId: "suspended",
      workflow: suspendedWorkflow,
      checkpoints,
      ownership: victim,
    });
    assert.equal(cancelled.status, "aborted");
  });

  it("sweeps aborted registrations whose promise never settled, and re-admits the same run", () => {
    const controller = new AbortController();
    registerActiveWorkflowRun({ workflowId: "leaky", runId: "run-1", ownership: victim, definitionHash: "v1", controller });
    // The run was aborted but its finally never ran (hung host) — the entry leaks.
    controller.abort(new Error("host restarted"));
    assert.equal(getActiveWorkflowRun("leaky", "run-1", victim)?.controller.signal.aborted, true);
    assert.equal(sweepActiveWorkflowRuns(), 1);
    assert.equal(getActiveWorkflowRun("leaky", "run-1", victim), undefined);
    // Sweep also runs automatically on register: the re-admitted run is live again.
    registerActiveWorkflowRun({
      workflowId: "leaky",
      runId: "run-1",
      ownership: victim,
      definitionHash: "v1",
      controller: new AbortController(),
    });
    assert.ok(getActiveWorkflowRun("leaky", "run-1", victim));
    unregisterActiveWorkflowRun("leaky", "run-1", victim);
  });

  it("fails closed at the registry cap rather than evicting live entries", () => {
    const registered: Array<{ workflowId: string; runId: string; controller: AbortController }> = [];
    try {
      for (let index = 0; index < MAX_ACTIVE_WORKFLOW_RUNS; index += 1) {
        const controller = new AbortController();
        registerActiveWorkflowRun({
          workflowId: "busy",
          runId: `run-${index}`,
          ownership: victim,
          definitionHash: "v1",
          controller,
        });
        registered.push({ workflowId: "busy", runId: `run-${index}`, controller });
      }
      assert.throws(
        () =>
          registerActiveWorkflowRun({
            workflowId: "busy",
            runId: "overflow",
            ownership: victim,
            definitionHash: "v1",
            controller: new AbortController(),
          }),
        (error: unknown) => error instanceof WorkflowRuntimeError && error.code === ACTIVE_WORKFLOW_RUNS_OVERFLOW_CODE,
      );
      // Abort the oldest registration (simulating a leaked run): the next register's
      // automatic sweep frees the slot, so the overflow run is admitted.
      registered[0].controller.abort();
      registerActiveWorkflowRun({
        workflowId: "busy",
        runId: "overflow",
        ownership: victim,
        definitionHash: "v1",
        controller: new AbortController(),
      });
      assert.ok(getActiveWorkflowRun("busy", "run-0", victim) === undefined);
      assert.ok(getActiveWorkflowRun("busy", "overflow", victim));
    } finally {
      for (const entry of registered) unregisterActiveWorkflowRun(entry.workflowId, entry.runId, victim);
      unregisterActiveWorkflowRun("busy", "overflow", victim);
    }
  });
});
