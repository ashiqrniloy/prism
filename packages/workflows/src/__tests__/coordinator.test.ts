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
} from "../index.js";

function workflow(id: string, execute: () => unknown | Promise<unknown>) {
  return defineWorkflow({ id, nodes: { work: functionNode({ execute }) }, edges: [] });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 500): Promise<void> {
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
    const coordinator = createWorkflowCoordinator({ coordinatorId: "bounded-worker", workflows: { [definition.id]: definition }, checkpoints, leases, maxConcurrentRuns: 2, leaseTtlMs: 100, renewalIntervalMs: 20 });
    assert.equal(await coordinator.pollOnce(), 2);
    assert.equal(coordinator.activeRuns, 2);
    release();
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued[0]!))?.value.status === "succeeded" && (await getWorkflowRun(checkpoints, queued[1]!))?.value.status === "succeeded");
    assert.equal(await coordinator.pollOnce(), 1);
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued[2]!))?.value.status === "succeeded");
  });

  it("persists cross-process cancellation requests", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const definition = workflow("cancel-distributed", () => new Promise((resolve) => setTimeout(() => resolve("late"), 100)));
    const queued = await enqueueWorkflow(definition, null, { checkpoints });
    const coordinator = createWorkflowCoordinator({ coordinatorId: "worker", workflows: { [definition.id]: definition }, checkpoints, leases, leaseTtlMs: 60, renewalIntervalMs: 5 });
    await coordinator.pollOnce();
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "running");
    await cancelWorkflowRun({ ...queued, checkpoints });
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await replacement.pollOnce(), 1);
    await waitFor(async () => (await getWorkflowRun(checkpoints, queued))?.value.status === "succeeded");
    await waitFor(() => staleErrors.length > 0);
    const record = await getWorkflowRun(checkpoints, queued);
    assert.equal(record?.fencingToken, 2);
    assert.equal(executions, 2);
  });
});
