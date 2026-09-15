import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryLeaseStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  enqueueWorkflow,
  functionNode,
  getWorkflowRun,
  type WorkflowAdmissionMetric,
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

describe("workflow admission", () => {
  it("serves a second tenant while 32 noisy-neighbor runs saturate the first page", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const definition = workflow("fair", async () => "ok");
    await enqueueWorkflow(definition, null, {
      checkpoints,
      runId: "quiet",
      ownership: { tenantId: "b", userId: "u" },
      metadata: { workloadClass: "batch" },
    });
    await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        enqueueWorkflow(definition, index, {
          checkpoints,
          runId: `noisy-${index}`,
          ownership: { tenantId: "a", userId: "u" },
          metadata: { workloadClass: "interactive" },
        }),
      ),
    );
    const metrics: WorkflowAdmissionMetric[] = [];
    const worker = (id: string) =>
      createWorkflowCoordinator({
        coordinatorId: id,
        workflows: { [definition.id]: definition },
        checkpoints,
        leases,
        maxConcurrentRuns: 2,
        pageSize: 8,
        admission: { perTenant: 1, maxPagesPerPoll: 8, onMetric: (event) => metrics.push(event) },
        leaseTtlMs: 10_000,
        renewalIntervalMs: 1_000,
      });
    const first = worker("w1");
    const second = worker("w2");
    const claimed = (await first.pollOnce()) + (await second.pollOnce());
    assert.ok(claimed >= 2);
    await waitFor(
      async () =>
        (await getWorkflowRun(checkpoints, { workflowId: definition.id, runId: "quiet", ownership: { tenantId: "b", userId: "u" } }))?.value
          .status === "succeeded",
    );
    assert.ok(metrics.some((event) => event.outcome === "skipped_quota"));
    assert.equal(
      metrics.every((event) => !("tenant" in event) && event.class.length <= 32),
      true,
    );
  });

  it("wraps past an unavailable first page to claim later work", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = workflow("blocked", async () => {
      await gate;
      return "late";
    });
    const later = workflow("later", async () => "soon");
    await enqueueWorkflow(later, null, { checkpoints, runId: "later-1" });
    await enqueueWorkflow(blocked, null, { checkpoints, runId: "hold-1" });
    await enqueueWorkflow(blocked, null, { checkpoints, runId: "hold-2" });
    const holder = createWorkflowCoordinator({
      coordinatorId: "holder",
      workflows: { [blocked.id]: blocked, [later.id]: later },
      checkpoints,
      leases,
      maxConcurrentRuns: 2,
      pageSize: 2,
      admission: { maxPagesPerPoll: 4 },
      leaseTtlMs: 10_000,
      renewalIntervalMs: 1_000,
    });
    assert.equal(await holder.pollOnce(), 2);
    const hunter = createWorkflowCoordinator({
      coordinatorId: "hunter",
      workflows: { [blocked.id]: blocked, [later.id]: later },
      checkpoints,
      leases,
      maxConcurrentRuns: 1,
      pageSize: 2,
      admission: { maxPagesPerPoll: 4 },
      leaseTtlMs: 10_000,
      renewalIntervalMs: 1_000,
    });
    assert.equal(await hunter.pollOnce(), 1);
    await waitFor(
      async () => (await getWorkflowRun(checkpoints, { workflowId: later.id, runId: "later-1" }))?.value.status === "succeeded",
    );
    release();
    await waitFor(() => holder.activeRuns === 0);
  });

  it("skips deadline-expired queued runs", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const definition = workflow("stale", async () => "nope");
    await enqueueWorkflow(definition, null, { checkpoints, runId: "old" });
    const now = Date.now() + 60_000;
    const coordinator = createWorkflowCoordinator({
      coordinatorId: "expiry",
      workflows: { [definition.id]: definition },
      checkpoints,
      leases,
      admission: { deadlineMs: 1_000, clock: () => now },
    });
    assert.equal(await coordinator.pollOnce(), 0);
    assert.equal((await getWorkflowRun(checkpoints, { workflowId: definition.id, runId: "old" }))?.value.status, "queued");
  });

  it("stops claiming while draining and aborts in-flight after the drain deadline", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const now = 1_000_000;
    const drain = {
      isDraining: false,
      deadlineAt: undefined as string | undefined,
      snapshot() {
        const expired = this.deadlineAt !== undefined && now >= Date.parse(this.deadlineAt);
        return { draining: this.isDraining, expired, deadlineAt: this.deadlineAt };
      },
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const definition = workflow("drain-me", async () => {
      await gate;
      return "done";
    });
    await enqueueWorkflow(definition, null, { checkpoints, runId: "d1" });
    await enqueueWorkflow(definition, null, { checkpoints, runId: "d2" });
    const coordinator = createWorkflowCoordinator({
      coordinatorId: "drain-worker",
      workflows: { [definition.id]: definition },
      checkpoints,
      leases,
      maxConcurrentRuns: 1,
      leaseTtlMs: 50,
      renewalIntervalMs: 5,
      admission: { drain, clock: () => now },
    });
    assert.equal(await coordinator.pollOnce(), 1);
    drain.isDraining = true;
    drain.deadlineAt = new Date(now + 10).toISOString();
    assert.equal(await coordinator.pollOnce(), 0);
    release();
    await waitFor(() => coordinator.activeRuns === 0);
  });
});
