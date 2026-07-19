import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryLeaseStore, type LeaseStore } from "@arnilo/prism";
import {
  cancelWorkflowRun,
  createMemoryWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  enqueueWorkflow,
  functionNode,
  getWorkflowRun,
  runWorkflow,
  suspend,
} from "../index.js";

function workflow(id: string, execute: () => unknown | Promise<unknown>) {
  return defineWorkflow({ revision: "1", id, nodes: { work: functionNode({ execute }) }, edges: [] });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("distributed workflow coordinator", () => {
  it("atomically claims a queued run across two coordinators", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    let executions = 0;
    const definition = workflow("claimed-once", async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return "done";
    });
    const queued = await enqueueWorkflow(definition, null, { checkpoints });
    const first = createWorkflowCoordinator({ coordinatorId: "one", workflows: { [definition.id]: definition }, checkpoints, leases, leaseTtlMs: 100, renewalIntervalMs: 20 });
    const second = createWorkflowCoordinator({ coordinatorId: "two", workflows: { [definition.id]: definition }, checkpoints, leases, leaseTtlMs: 100, renewalIntervalMs: 20 });

    const claims = await Promise.all([first.pollOnce(), second.pollOnce()]);
    assert.equal(claims[0]! + claims[1]!, 1);
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "succeeded");
    assert.equal(executions, 1);
  });

  it("bounds concurrent claimed runs", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const definition = workflow("bounded", async () => { await gate; return "done"; });
    const queued = await Promise.all([0, 1, 2].map((index) => enqueueWorkflow(definition, index, { checkpoints, runId: `bounded-${index}` })));
    const coordinator = createWorkflowCoordinator({ coordinatorId: "bounded-worker", workflows: { [definition.id]: definition }, checkpoints, leases, maxConcurrentRuns: 2, leaseTtlMs: 10_000, renewalIntervalMs: 1_000 });
    assert.equal(await coordinator.pollOnce(), 2);
    assert.equal(coordinator.activeRuns, 2);
    release();
    const statuses = () => Promise.all(queued.map(async (run) => (await getWorkflowRun(checkpoints, run))?.value.status));
    await waitFor(async () => coordinator.activeRuns === 0 && (await statuses()).filter((status) => status === "succeeded").length === 2);
    assert.equal(await coordinator.pollOnce(), 1);
    await waitFor(async () => (await statuses()).every((status) => status === "succeeded"));
  });

  it("does not poll or claim suspended runs", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const definition = workflow("await-human", () => suspend({ reason: "review" }));
    const result = await runWorkflow(definition, null, { checkpoints, runId: "await-human-1" });
    assert.equal(result.status, "suspended");
    const coordinator = createWorkflowCoordinator({
      coordinatorId: "idle-worker",
      workflows: { [definition.id]: definition },
      checkpoints,
      leases,
    });
    assert.equal(await coordinator.pollOnce(), 0);
    assert.equal(coordinator.activeRuns, 0);
  });

  it("persists cross-process cancellation requests", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const definition = workflow("cancel-distributed", () => new Promise((resolve) => setTimeout(() => resolve("late"), 100)));
    const queued = await enqueueWorkflow(definition, null, { checkpoints });
    const coordinator = createWorkflowCoordinator({ coordinatorId: "worker", workflows: { [definition.id]: definition }, checkpoints, leases, leaseTtlMs: 60, renewalIntervalMs: 5 });
    await coordinator.pollOnce();
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "running");
    await cancelWorkflowRun({ ...queued, workflow: definition, checkpoints });
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "aborted");
  });

  it("takes over expired work and fences the stale worker", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const sharedLeases = createMemoryLeaseStore();
    const losingLeases: LeaseStore = { ...sharedLeases, renewLease: async () => null };
    let executions = 0;
    const definition = workflow("takeover", async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, executions === 1 ? 40 : 1));
      return executions;
    });
    const queued = await enqueueWorkflow(definition, null, { checkpoints });
    const staleErrors: unknown[] = [];
    const stale = createWorkflowCoordinator({ coordinatorId: "stale", workflows: { [definition.id]: definition }, checkpoints, leases: losingLeases, leaseTtlMs: 15, renewalIntervalMs: 5, onError: (error) => staleErrors.push(error) });
    const replacement = createWorkflowCoordinator({ coordinatorId: "replacement", workflows: { [definition.id]: definition }, checkpoints, leases: sharedLeases, leaseTtlMs: 100, renewalIntervalMs: 20 });

    assert.equal(await stale.pollOnce(), 1);
    // In-process registry rejects duplicate exact runs; wait for stale local execution to unwind.
    await waitFor(() => stale.activeRuns === 0);
    assert.equal(await replacement.pollOnce(), 1);
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "succeeded");
    await waitFor(() => staleErrors.length > 0);
    const record = await getWorkflowRun(checkpoints, queued);
    assert.equal(record?.fencingToken, 2);
    assert.equal(executions, 2);
  });
});
