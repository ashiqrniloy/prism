import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCommands,
  createWorkflowCoordinator,
  createWorkflowSchedules,
  defineWorkflow,
  functionNode,
  getWorkflowRun,
  WorkflowRuntimeError,
} from "../index.js";

const ownership = { tenantId: "tenant-a", userId: "user-a" } as const;

function fixture(ownerId = "scheduler-a") {
  const store = createMemoryCheckpointStore();
  const leases = createMemoryLeaseStore();
  const checkpoints = createMemoryWorkflowCheckpoints();
  let executions = 0;
  const workflow = defineWorkflow({
    id: "scheduled",
    nodes: { execute: functionNode({ execute: () => ++executions }) },
  });
  const schedules = createWorkflowSchedules({
    store,
    leases,
    checkpoints,
    workflows: { scheduled: workflow },
    ownership,
    ownerId,
  });
  return { store, leases, checkpoints, workflow, schedules, executions: () => executions };
}

describe("durable workflow schedules", () => {
  test("fires a one-time schedule once across concurrent pollers and executes in the existing coordinator", async () => {
    const value = fixture();
    const second = createWorkflowSchedules({
      store: value.store,
      leases: value.leases,
      checkpoints: value.checkpoints,
      workflows: { scheduled: value.workflow },
      ownership,
      ownerId: "scheduler-b",
    });
    await value.schedules.create({
      id: "once",
      workflowId: "scheduled",
      nextRunAt: "2026-01-01T00:00:00.000Z",
      input: { source: "timer" },
    });
    const fired = await Promise.all([
      value.schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") }),
      second.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") }),
    ]);
    assert.equal(fired.reduce((sum, count) => sum + count, 0), 1);
    const schedule = await value.schedules.get("once");
    assert.equal(schedule?.status, "completed");
    assert.ok(schedule?.lastRunId);

    const coordinator = createWorkflowCoordinator({
      coordinatorId: "worker",
      workflows: { scheduled: value.workflow },
      checkpoints: value.checkpoints,
      leases: value.leases,
      ownership,
    });
    assert.equal(await coordinator.pollOnce(), 1);
    while (coordinator.activeRuns > 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const run = await getWorkflowRun(value.checkpoints, {
      workflowId: "scheduled",
      runId: schedule!.lastRunId!,
      ownership,
    });
    assert.equal(run?.value.status, "succeeded");
    assert.equal(value.executions(), 1);
  });

  test("supports interval, calculator, pause/resume, idempotent trigger, delete, and restart", async () => {
    const value = fixture();
    await value.schedules.create({
      id: "interval",
      workflowId: "scheduled",
      nextRunAt: "2026-01-01T00:00:00.000Z",
      intervalMs: 60_000,
    });
    assert.equal((await value.schedules.pause("interval")).status, "paused");
    assert.equal(await value.schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") }), 0);
    await value.schedules.resume("interval", "2026-01-01T00:00:00.000Z");
    assert.equal(await value.schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") }), 1);
    assert.equal((await value.schedules.get("interval"))?.nextRunAt, "2026-01-02T00:01:00.000Z");

    const first = await value.schedules.trigger("interval", { idempotencyKey: "manual-1" });
    const duplicate = await value.schedules.trigger("interval", { idempotencyKey: "manual-1" });
    assert.equal(first.runId, duplicate.runId);

    const restarted = createWorkflowSchedules({
      store: value.store,
      leases: value.leases,
      checkpoints: value.checkpoints,
      workflows: { scheduled: value.workflow },
      ownership,
      ownerId: "scheduler-restarted",
      calculators: { tomorrow: ({ firedAt }) => new Date(Date.parse(firedAt) + 86_400_000) },
    });
    await restarted.create({
      id: "calculated",
      workflowId: "scheduled",
      nextRunAt: "2026-01-01T00:00:00.000Z",
      calculatorId: "tomorrow",
    });
    assert.equal(await restarted.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") }), 1);
    assert.equal((await restarted.get("calculated"))?.nextRunAt, "2026-01-03T00:00:00.000Z");
    assert.equal(await restarted.delete("calculated"), true);
    assert.equal(await restarted.get("calculated"), null);
  });

  test("redacts persisted inputs and fails closed on ownership and limits", async () => {
    const value = fixture();
    const redacted = createWorkflowSchedules({
      store: value.store,
      leases: value.leases,
      checkpoints: value.checkpoints,
      workflows: { scheduled: value.workflow },
      ownership,
      ownerId: "secure",
      secrets: ["sekrit"],
      maxInputBytes: 64,
    });
    await redacted.create({
      id: "secure",
      workflowId: "scheduled",
      nextRunAt: new Date(Date.now() + 60_000),
      input: { token: "sekrit" },
    });
    assert.doesNotMatch(JSON.stringify(await redacted.get("secure")), /sekrit/);

    assert.throws(() => createWorkflowSchedules({
      store: value.store,
      leases: value.leases,
      checkpoints: value.checkpoints,
      workflows: { scheduled: value.workflow },
      ownership: {},
      ownerId: "bad",
    }), WorkflowRuntimeError);
    await assert.rejects(redacted.create({
      id: "large",
      workflowId: "scheduled",
      nextRunAt: new Date(),
      input: { value: "x".repeat(100) },
    }));
    await assert.rejects(value.schedules.create({
      id: "bad",
      workflowId: "scheduled",
      nextRunAt: "not-a-date",
    }));

    const other = createWorkflowSchedules({
      store: value.store,
      leases: value.leases,
      checkpoints: value.checkpoints,
      workflows: { scheduled: value.workflow },
      ownership: { tenantId: "tenant-b", userId: "user-b" },
      ownerId: "other",
    });
    await assert.rejects(other.get("secure"));
  });

  test("registers schedule commands only when a schedule service is selected", async () => {
    const value = fixture();
    const without = createWorkflowCommands({ workflows: { scheduled: value.workflow }, checkpoints: value.checkpoints });
    assert.equal(without.some((command) => command.name.startsWith("schedule.")), false);
    const withSchedules = createWorkflowCommands({
      workflows: { scheduled: value.workflow },
      checkpoints: value.checkpoints,
      schedules: value.schedules,
    });
    const names = withSchedules.map((command) => command.name);
    assert.deepEqual(names.slice(-6), ["schedule.create", "schedule.list", "schedule.pause", "schedule.resume", "schedule.trigger", "schedule.delete"]);
    const create = withSchedules.find((command) => command.name === "schedule.create")!;
    assert.equal((await create.execute({
      id: "command",
      workflowId: "scheduled",
      nextRunAt: "2026-01-01T00:00:00.000Z",
    }, {})).error, undefined);
  });

  test("stops idle polling on abort without a busy loop", async () => {
    const value = fixture();
    const controller = new AbortController();
    const running = value.schedules.run({ signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await running;
  });
});
