import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createProactiveScheduleCapabilities,
  createWorkflowSchedules,
  defineWorkflow,
  functionNode,
  WorkflowRuntimeError,
  type CapabilityActorRef,
  type ScheduleCapabilityEvent,
} from "../index.js";

const ownership = { tenantId: "tenant-a", userId: "user-a" } as const;
const actor: CapabilityActorRef = {
  tenantId: "tenant-a",
  userId: "user-a",
  principalId: "agent-1",
  principalKind: "agent",
};

function fixture() {
  const store = createMemoryCheckpointStore();
  const leases = createMemoryLeaseStore();
  const checkpoints = createMemoryWorkflowCheckpoints();
  let executions = 0;
  const workflow = defineWorkflow({
    revision: "1",
    id: "proactive",
    nodes: { execute: functionNode({ execute: () => ++executions }) },
  });
  const schedules = createWorkflowSchedules({
    store,
    leases,
    checkpoints,
    workflows: { proactive: workflow },
    ownership,
    ownerId: "scheduler-a",
  });
  const events: ScheduleCapabilityEvent[] = [];
  const capabilities = createProactiveScheduleCapabilities({
    schedules,
    store,
    ownership,
    ownerId: "scheduler-a",
    onCapability: (event) => events.push(event),
  });
  return { store, schedules, capabilities, events, executions: () => executions };
}

describe("proactive schedule capability tokens", () => {
  test("enable creates a schedule + scoped expiring token and fires while active", async () => {
    const { schedules, capabilities, events } = fixture();
    const token = await capabilities.enable({
      workflowId: "proactive",
      scope: "digest.daily",
      actor,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      ttlMs: 3_600_000,
    });
    assert.equal(token.revoked, false);
    assert.equal(token.scope, "digest.daily");
    assert.ok(Date.parse(token.expiresAt) > Date.parse(token.createdAt));

    const schedule = await schedules.get(token.scheduleId);
    assert.equal(schedule?.status, "active");
    assert.equal(schedule?.metadata?.capabilityScope, "digest.daily");

    const active = await capabilities.assertActive(token.tokenId);
    assert.equal(active.tokenId, token.tokenId);

    const fired = await schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") });
    assert.equal(fired, 1);
    assert.ok(events.some((event) => event.type === "capability_enabled"));
  });

  test("revocation pauses the schedule so polling never fires it (fail-closed)", async () => {
    const { schedules, capabilities, events, executions } = fixture();
    const token = await capabilities.enable({
      workflowId: "proactive",
      scope: "digest.daily",
      actor,
      nextRunAt: "2026-01-01T00:00:00.000Z",
    });

    const revoked = await capabilities.revoke(token.tokenId, actor);
    assert.equal(revoked.revoked, true);
    assert.ok(revoked.revokedAt);

    const schedule = await schedules.get(token.scheduleId);
    assert.equal(schedule?.status, "paused");

    const fired = await schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") });
    assert.equal(fired, 0, "revoked capability must not fire");
    assert.equal(executions(), 0);

    await assert.rejects(capabilities.assertActive(token.tokenId), WorkflowRuntimeError);
    assert.ok(events.some((event) => event.type === "capability_revoked"));
  });

  test("expired tokens fail closed at assert time", async () => {
    const { capabilities } = fixture();
    const token = await capabilities.enable({
      workflowId: "proactive",
      scope: "digest.daily",
      actor,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      ttlMs: 1, // expires almost immediately
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(capabilities.assertActive(token.tokenId), /expired/);
  });

  test("rejects missing actors and unknown tokens", async () => {
    const { capabilities } = fixture();
    await assert.rejects(
      capabilities.enable({
        workflowId: "proactive",
        scope: "x",
        actor: { tenantId: "", principalId: "", principalKind: "agent" },
        nextRunAt: "2026-01-01T00:00:00.000Z",
      }),
      WorkflowRuntimeError,
    );
    await assert.rejects(capabilities.assertActive("wfcap_missing"), WorkflowRuntimeError);
    assert.equal(await capabilities.get("wfcap_missing"), null);
  });

  test("capability tokens are ownership-scoped (foreign access fails closed)", async () => {
    const { store, capabilities, schedules } = fixture();
    const token = await capabilities.enable({
      workflowId: "proactive",
      scope: "digest.daily",
      actor,
      nextRunAt: "2026-01-01T00:00:00.000Z",
    });

    const foreign = createProactiveScheduleCapabilities({
      schedules,
      store,
      ownership: { tenantId: "tenant-b", userId: "user-b" },
      ownerId: "scheduler-b",
    });
    await assert.rejects(foreign.get(token.tokenId));
    await assert.rejects(foreign.assertActive(token.tokenId));
  });
});
