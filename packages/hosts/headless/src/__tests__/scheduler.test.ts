import { expect, test } from "bun:test";
import { createAgent, createMemorySessionStore, createSessionIndex, definePackage } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import workflows, { createMemoryCheckpointStore, defineWorkflow, functionNode, workflowCommand } from "@arnilo/prism-extensions/workflows";
import { createScheduler, type SchedulerClock } from "../index.js";
import { build } from "./fixtures/agent.js";

function fakeClock(onRead?: (reads: number) => void) {
  let now = Date.parse("2026-10-13T00:00:00Z");
  let reads = 0;
  const sleeps: number[] = [];
  const waiters = new Set<{ at: number; resolve(): void }>();
  const clock: SchedulerClock = {
    now: () => {
      onRead?.(++reads);
      return now;
    },
    sleep(ms, signal) {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        const done = () => {
          waiters.delete(waiter);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const waiter = { at: now + ms, resolve: done };
        waiters.add(waiter);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    },
  };
  return {
    clock,
    sleeps,
    advance(ms: number) {
      now += ms;
      for (const waiter of [...waiters]) if (waiter.at <= now) waiter.resolve();
    },
  };
}
async function until(check: () => Promise<boolean> | boolean) {
  // Wall-clock, not an iteration count: the full `bun run test` runs this package beside another
  // workspace leaf and the 200x1ms budget was exhausted under that load (2026-10-15, plan 174 Task 8).
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("scheduler did not settle");
}
async function setup(suspend = false) {
  const store = createMemorySessionStore();
  const { agent } = await build({ store, resumed: !suspend });
  const checkpoints = createMemoryCheckpointStore();
  const time = fakeClock();
  const scheduler = createScheduler({
    checkpoints,
    ownership: {},
    clock: time.clock,
    targets: { job: { kind: "agent", agent, input: "run" } },
  });
  return { scheduler, agent, store, checkpoints, ...time };
}

test("cron_schedule_fires_on_fake_clock_and_agent_firing_has_parent_link", async () => {
  const f = await setup();
  const schedule = await f.scheduler.schedule({ id: "daily", target: "job", cron: "0 2 * * *" });
  f.scheduler.start();
  await until(() => f.sleeps.length > 0);
  expect(f.sleeps).toEqual([7200000]);
  f.advance(7200000);
  await until(async () => (await f.scheduler.list())[0].lastFiring?.status === "completed");
  const row = (await f.scheduler.list())[0];
  expect(row.nextRunAt).toBe("2026-10-14T02:00:00.000Z");
  const children = await createSessionIndex(f.store).list({ parentSessionId: schedule.scheduleSessionId });
  expect(children.items.map((x) => x.sessionId)).toMatchObject([row.lastFiring?.sessionId]);
  await f.scheduler.stop();
  await f.agent.dispose();
});

test("a clock jump between an iteration's two readings still fires the due schedule", async () => {
  const store = createMemorySessionStore();
  const { agent } = await build({ store, resumed: true });
  // `schedule()` reads the clock once and `start()` once, so the fourth reading is the second of the
  // first loop iteration: the launch decision has already used the third. A jump landing there used to
  // leave the loop with no due and no upcoming schedule, parking it on an unrelated wake — the tick
  // never fired (scheduler-leases flaked on the same window with its jumpy clock file).
  let time: ReturnType<typeof fakeClock>;
  time = fakeClock((reads) => {
    if (reads === 4) time.advance(60000);
  });
  const scheduler = createScheduler({
    checkpoints: createMemoryCheckpointStore(),
    ownership: {},
    clock: time.clock,
    targets: { job: { kind: "agent", agent, input: "run" } },
  });
  await scheduler.schedule({ id: "ticks", target: "job", cron: "* * * * *" });
  scheduler.start();
  await until(() => time.sleeps.length > 0);
  time.advance(60000);
  await until(async () => (await scheduler.list())[0].lastFiring?.status === "completed");
  await scheduler.stop();
  await agent.dispose();
});

test("one_off_fires_once_and_completes", async () => {
  const f = await setup();
  await f.scheduler.schedule({ id: "once", target: "job", at: f.clock.now() });
  f.scheduler.start();
  await until(async () => (await f.scheduler.list())[0].lastFiring?.status === "completed");
  const first = (await f.scheduler.list())[0];
  expect(first.status).toBe("completed");
  expect(first.nextRunAt).toBeNull();
  f.advance(86400000);
  await f.scheduler.stop();
  expect((await f.scheduler.list())[0].lastFiring).toEqual(first.lastFiring);
  await f.agent.dispose();
});

test("workflow_firing_starts_run_under_schedule_session_and_trigger_fires_immediately", async () => {
  const seen: unknown[] = [];
  const store = createMemorySessionStore();
  const workflow = defineWorkflow({
    id: "scheduled",
    revision: "1",
    nodes: {
      n: functionNode({
        execute: (ctx) => {
          seen.push(ctx.workflowInput);
          return "ok";
        },
      }),
    },
  });
  const host = definePackage({
    name: "scheduler-test",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["session-state"],
    setup(prism) {
      prism.commands.register(
        workflowCommand(prism, "nightly", workflow, { args: { type: "object", properties: { goal: { type: "string" } } } }),
      );
    },
  });
  const agent = await createAgent({
    model: { provider: "mock", model: "test" },
    slots: { store },
    packages: [mockProvider([]), workflows, host],
  });
  const time = fakeClock();
  const scheduler = createScheduler({
    checkpoints: createMemoryCheckpointStore(),
    ownership: {},
    clock: time.clock,
    targets: { job: { kind: "workflow", agent, command: "nightly", input: { goal: "nightly" } } },
  });
  const row = await scheduler.schedule({ id: "once", target: "job", at: time.clock.now() + 10 });
  scheduler.start();
  time.advance(10);
  await until(async () => (await scheduler.list())[0].lastFiring?.status === "succeeded");
  const firing = (await scheduler.list())[0].lastFiring;
  if (!firing?.workflowRunId) throw new Error("missing workflow firing");
  expect(firing.workflowRunId).toBeString();
  const entries = await store.list(row.scheduleSessionId);
  expect(JSON.stringify(entries)).toContain(firing.workflowRunId);
  const triggered = await scheduler.trigger("job", { input: { goal: "manual" } });
  expect(triggered.status).toBe("succeeded");
  expect(seen).toEqual([{ goal: "nightly" }, { goal: "manual" }]);
  expect((await scheduler.list()).length).toBe(1);
  await scheduler.stop();
  await agent.dispose();
});

test("suspended_firing_is_recorded", async () => {
  const f = await setup(true);
  const firing = await f.scheduler.trigger("job");
  expect(firing.status).toBe("suspended");
  if (!firing.sessionId) throw new Error("missing session id");
  expect((await f.agent.sessions.get(firing.sessionId))?.sessionId).toBe(firing.sessionId);
  await f.scheduler.stop();
  await f.agent.dispose();
});

test("scheduler_rejects_bad_input", async () => {
  const f = await setup();
  const cases = [
    [{ id: "x", target: "missing", cron: "* * * * *" }, "unknown_target"],
    [{ id: "x", target: "job", cron: "bad" }, "invalid_cron"],
    [{ id: "x", target: "job", cron: "0 0 30 2 *" }, "invalid_cron"],
    [{ id: "x", target: "job", cron: "* * * * *", tz: "Invalid/Zone" }, "invalid_timezone"],
    [{ id: "x", target: "job", at: f.clock.now() - 1 }, "past_one_off"],
    [{ id: "x", target: "job", at: NaN }, "invalid_schedule"],
    [{ id: "x", target: "job", at: Number.MAX_VALUE }, "invalid_schedule"],
    [{ id: "x", target: "job", cron: "* * * * *", at: f.clock.now() + 1 }, "invalid_schedule"],
  ] as const;
  for (const [input, code] of cases) await expect(f.scheduler.schedule(input as never)).rejects.toMatchObject({ code });
  await f.scheduler.schedule({ id: "x", target: "job", cron: "* * * * *" });
  await expect(f.scheduler.schedule({ id: "x", target: "job", cron: "* * * * *" })).rejects.toMatchObject({ code: "duplicate_schedule" });
  const limited = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
    limits: { maxSchedules: 1 },
  });
  await expect(limited.schedule({ id: "y", target: "job", cron: "* * * * *" })).rejects.toMatchObject({ code: "schedule_limit" });
  expect(() => createScheduler({ checkpoints: f.checkpoints, ownership: {}, targets: {}, limits: { maxSchedules: 10001 } })).toThrow();
  await f.agent.dispose();
});

test("foreign_scope_schedules_are_invisible_including_wildcard_queries", async () => {
  const f = await setup();
  await f.checkpoints.saveCheckpoint({
    tenantId: "foreign",
    namespace: "headless.schedules",
    key: "foreign",
    version: 1,
    value: { schemaVersion: 99 },
  });
  expect(await f.scheduler.list()).toEqual([]);
  f.scheduler.start();
  await f.scheduler.stop();
  expect(() =>
    createScheduler({
      checkpoints: f.checkpoints,
      ownership: { tenantId: "foreign" },
      targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
    }),
  ).toThrow();
  await f.agent.dispose();
});

test("single_timer_no_polling_and_pause_resume_delete_rearm", async () => {
  const f = await setup();
  await f.scheduler.schedule({ id: "x", target: "job", at: f.clock.now() + 10000 });
  f.scheduler.start();
  await until(() => f.sleeps.length === 1);
  expect(f.sleeps).toEqual([10000]);
  await f.scheduler.pause("x");
  f.advance(5000);
  expect((await f.scheduler.list())[0].status).toBe("paused");
  await f.scheduler.resume("x");
  await until(() => f.sleeps.length === 2);
  expect(f.sleeps[1]).toBe(5000);
  await f.scheduler.delete("x");
  expect(await f.scheduler.list()).toEqual([]);
  f.advance(10000);
  await f.scheduler.stop();
  await f.agent.dispose();
});

test("fresh_scheduler_reads_persisted_state_and_CAS_claims_once", async () => {
  const f = await setup();
  const row = await f.scheduler.schedule({ id: "x", target: "job", at: f.clock.now() + 10 });
  const second = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
  });
  expect((await second.list())[0].scheduleSessionId).toBe(row.scheduleSessionId);
  f.scheduler.start();
  second.start();
  f.advance(10);
  await until(async () => (await second.list())[0].lastFiring?.status === "completed");
  await f.scheduler.stop();
  await second.stop();
  expect((await createSessionIndex(f.store).list({ parentSessionId: row.scheduleSessionId })).items).toHaveLength(1);
  await f.agent.dispose();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("bounded_concurrency_stop_drains_and_completion_preserves_pause_delete", async () => {
  const f = await setup();
  const gates = [deferred(), deferred()];
  let calls = 0;
  const agent = {
    ...f.agent,
    async session(options?: Parameters<typeof f.agent.session>[0]) {
      const session = await f.agent.session(options);
      if (!options?.parent) return session;
      return {
        ...session,
        id: session.id,
        close: () => session.close(),
        async run(...args: Parameters<typeof session.run>) {
          const gate = gates[calls++];
          await gate.promise;
          return session.run(...args);
        },
      };
    },
  };
  const scheduler = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "agent", agent, input: "run" } },
    limits: { maxConcurrentFirings: 1 },
  });
  await scheduler.schedule({ id: "a", target: "job", cron: "* * * * *" });
  await scheduler.schedule({ id: "b", target: "job", cron: "* * * * *" });
  scheduler.start();
  f.advance(60000);
  await until(() => calls === 1);
  await expect(scheduler.trigger("job")).rejects.toMatchObject({ code: "firing_limit" });
  await scheduler.pause("a");
  gates[0].resolve();
  await until(() => calls === 2);
  expect((await scheduler.list()).find((s) => s.id === "a")).toMatchObject({ status: "paused", lastFiring: { status: "completed" } });
  await scheduler.delete("b");
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  await new Promise((r) => setTimeout(r, 1));
  expect(stopped).toBe(false);
  gates[1].resolve();
  await stopping;
  expect((await scheduler.list()).map((s) => s.id)).toEqual(["a"]);
  expect((await f.checkpoints.loadCheckpoint({ namespace: "headless.schedules", key: "b" }))?.value).toMatchObject({
    status: "deleted",
    lastFiring: { status: "completed" },
  });
  await f.agent.dispose();
});

test("storage_failures_stop_background_work_and_surface_on_stop", async () => {
  const f = await setup();
  let fail = false;
  const failure = new Error("storage unavailable");
  const attempted = deferred();
  const checkpoints = {
    ...f.checkpoints,
    async saveCheckpoint(input: Parameters<typeof f.checkpoints.saveCheckpoint>[0]) {
      if (fail) {
        attempted.resolve();
        throw failure;
      }
      return f.checkpoints.saveCheckpoint(input);
    },
  };
  const scheduler = createScheduler({
    checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
  });
  const row = await scheduler.schedule({ id: "x", target: "job", at: f.clock.now() + 10 });
  scheduler.start();
  await until(() => f.sleeps.length === 1);
  fail = true;
  f.advance(10);
  await attempted.promise;
  // stop waits for the in-progress claim and exposes its failure.
  await expect(scheduler.stop()).rejects.toBe(failure);
  expect((await f.agent.sessions.list({ parentSessionId: row.scheduleSessionId })).items).toHaveLength(0);
  await f.agent.dispose();
});

test("uncertain_claim_is_not_replayed_after_a_failed_claim_acknowledgement", async () => {
  const f = await setup();
  const checkpoints = {
    ...f.checkpoints,
    async saveCheckpoint(input: Parameters<typeof f.checkpoints.saveCheckpoint>[0]) {
      const row = await f.checkpoints.saveCheckpoint(input);
      if ((input.value as { lastFiring?: { status: string } }).lastFiring?.status === "running")
        throw new Error("connection lost after commit");
      return row;
    },
  };
  const scheduler = createScheduler({
    checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
  });
  const row = await scheduler.schedule({ id: "x", target: "job", at: f.clock.now() + 10 });
  scheduler.start();
  await until(() => f.sleeps.length === 1);
  f.advance(10);
  await until(async () => (await f.scheduler.list())[0].lastFiring?.status === "running");
  await expect(scheduler.stop()).rejects.toThrow("connection lost after commit");
  f.scheduler.start();
  await f.scheduler.stop();
  expect((await f.agent.sessions.list({ parentSessionId: row.scheduleSessionId })).items).toHaveLength(0);
  expect((await f.scheduler.list())[0]).toMatchObject({ status: "completed", lastFiring: { status: "running" } });
  await f.agent.dispose();
});

test("local_admission_is_serialized_and_schedule_input_is_snapshotted", async () => {
  const f = await setup();
  const scheduler = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    limits: { maxSchedules: 1 },
    targets: { job: { kind: "agent", agent: f.agent, input: "original" } },
  });
  const results = await Promise.allSettled(["a", "b"].map((id) => scheduler.schedule({ id, target: "job", cron: "* * * * *" })));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toMatchObject([{ reason: { code: "schedule_limit" } }]);
  const row = (await scheduler.list())[0];
  (row as { input: string }).input = "tampered";
  expect((await scheduler.list())[0].input).toBe("original");
  expect(await f.agent.sessions.get(row.scheduleSessionId)).not.toBeNull();
  await f.agent.dispose();
});

test("invalid_state_unknown_workflow_and_trigger_input_fail_closed", async () => {
  const f = await setup();
  expect(() =>
    createScheduler({
      checkpoints: f.checkpoints,
      ownership: {},
      targets: { job: { kind: "workflow", agent: f.agent, command: "missing", input: {} } },
    }),
  ).toThrow();
  await expect(f.scheduler.trigger("missing")).rejects.toMatchObject({ code: "unknown_target" });
  await expect(f.scheduler.trigger("job", { input: {} })).rejects.toMatchObject({ code: "invalid_schedule" });
  await f.checkpoints.saveCheckpoint({ namespace: "headless.schedules", key: "bad", version: 1, value: { schemaVersion: 2 } });
  await expect(f.scheduler.list()).rejects.toMatchObject({ code: "invalid_schedule_state" });
  f.scheduler.start();
  await expect(f.scheduler.stop()).rejects.toMatchObject({ code: "invalid_schedule_state" });
  await f.agent.dispose();
});

test("trigger_parent_is_reused_and_suspended_schedule_is_not_retried", async () => {
  const f = await setup();
  const a = await f.scheduler.trigger("job");
  const b = await f.scheduler.trigger("job");
  const parents = (await f.agent.sessions.list({})).items.filter((s) => s.sessionId !== a.sessionId && s.sessionId !== b.sessionId);
  expect(parents).toHaveLength(1);
  expect((await f.agent.sessions.list({ parentSessionId: parents[0].sessionId })).items).toHaveLength(2);
  await f.agent.dispose();
  const suspended = await setup(true);
  await suspended.scheduler.schedule({ id: "ask", target: "job", at: suspended.clock.now() + 10 });
  suspended.scheduler.start();
  suspended.advance(10);
  await until(async () => (await suspended.scheduler.list())[0].lastFiring?.status === "suspended");
  const first = (await suspended.scheduler.list())[0].lastFiring;
  suspended.advance(1000);
  await suspended.scheduler.stop();
  expect((await suspended.scheduler.list())[0].lastFiring).toEqual(first);
  await suspended.agent.dispose();
});

test("SQLite_schedule_and_workflow_parent_survive_process_restart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "scheduler-restart-"));
  const run = async (mode: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dirname, "fixtures/scheduler-restart.mjs"), join(dir, "store.db"), mode], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout);
  };
  try {
    const before = await run("prepare");
    const after = await run("fire");
    expect(after.scheduleSessionId).toBe(before.scheduleSessionId);
    expect(after.nextRunAt).toBe("2026-10-14T02:00:00.000Z");
    expect(after.lastFiring).toMatchObject({ status: "succeeded", workflowRunId: expect.any(String) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inflight_claim_reserves_concurrency_before_checkpoint_ack", async () => {
  const f = await setup();
  const claimed = deferred();
  const acknowledge = deferred();
  const checkpoints = {
    ...f.checkpoints,
    async saveCheckpoint(input: Parameters<typeof f.checkpoints.saveCheckpoint>[0]) {
      const row = await f.checkpoints.saveCheckpoint(input);
      if ((input.value as { lastFiring?: { status: string } }).lastFiring?.status === "running") {
        claimed.resolve();
        await acknowledge.promise;
      }
      return row;
    },
  };
  const scheduler = createScheduler({
    checkpoints,
    ownership: {},
    clock: f.clock,
    limits: { maxConcurrentFirings: 1 },
    targets: { job: { kind: "agent", agent: f.agent, input: "x" } },
  });
  await scheduler.schedule({ id: "x", target: "job", at: f.clock.now() + 10 });
  scheduler.start();
  f.advance(10);
  await claimed.promise;
  await expect(scheduler.trigger("job")).rejects.toMatchObject({ code: "firing_limit" });
  acknowledge.resolve();
  await scheduler.stop();
  expect((await scheduler.list())[0].lastFiring?.status).toBe("completed");
  await f.agent.dispose();
});

test("workflow_status_validation_and_unknown_options", async () => {
  const f = await setup();
  let returned: unknown = { status: "denied", workflowRunId: "denied-run" };
  const agent = {
    ...f.agent,
    commands: { list: () => [{ name: "job", package: "test", description: "test" }], run: async () => returned },
  };
  const scheduler = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { job: { kind: "workflow", agent, command: "job", input: {} } },
  });
  expect(await scheduler.trigger("job")).toMatchObject({ status: "denied", workflowRunId: "denied-run" });
  returned = { status: "pretend-success", workflowRunId: "secret-value" };
  const result = await scheduler.trigger("job");
  expect(result.status).toBe("failed");
  expect(JSON.stringify(result)).not.toContain("secret-value");
  expect(() => createScheduler({ checkpoints: f.checkpoints, ownership: {}, targets: {}, typo: "skip" } as never)).toThrow();
  expect(() => createScheduler({ checkpoints: f.checkpoints, ownership: {}, targets: {}, limits: { typo: 1 } } as never)).toThrow();
  await scheduler.stop();
  await f.agent.dispose();
});

test("command_target_fires_without_a_model_turn", async () => {
  let requests = 0;
  const store = createMemorySessionStore();
  const commands = definePackage({
    name: "@test/maintenance",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.commands.register({
        name: "memory:maintain",
        description: "One maintenance pass",
        run: async () => ({ ok: true, archived: 2, merged: 1, overBudget: [] }),
      });
    },
  });
  const agent = await createAgent({
    id: "headless-command-test",
    model: { provider: "mock", model: "test" },
    slots: { store },
    packages: [mockProvider([[{ type: "done" }]], { onRequest: () => requests++ }), commands],
  });
  const time = fakeClock();
  const scheduler = createScheduler({
    checkpoints: createMemoryCheckpointStore(),
    ownership: {},
    clock: time.clock,
    targets: { maintain: { kind: "command", agent, command: "memory:maintain", input: {} } },
  });
  const row = await scheduler.schedule({ id: "nightly", target: "maintain", cron: "0 3 * * *" });
  scheduler.start();
  await until(() => time.sleeps.length > 0);
  time.advance(10800000);
  await until(async () => (await scheduler.list())[0].lastFiring?.status === "completed");
  const firing = (await scheduler.list())[0].lastFiring;
  expect(firing?.sessionId).toBeString();
  expect(firing?.sessionId).toBe(row.scheduleSessionId);
  // A command target is a package command on the schedule session: the model is never asked for a turn.
  expect(requests).toBe(0);
  expect(await scheduler.trigger("maintain")).toMatchObject({ status: "completed" });
  expect(requests).toBe(0);
  await scheduler.stop();
  await agent.dispose();
});

test("command_status_and_unknown_command_fail_closed", async () => {
  const f = await setup();
  let returned: unknown = { ok: false, reason: "no_scan" };
  const agent = {
    ...f.agent,
    commands: {
      list: () => [{ name: "memory:maintain", package: "test", description: "test" }],
      run: async () => returned,
    },
  };
  const scheduler = createScheduler({
    checkpoints: f.checkpoints,
    ownership: {},
    clock: f.clock,
    targets: { maintain: { kind: "command", agent, command: "memory:maintain", input: {} } },
  });
  expect(await scheduler.trigger("maintain")).toMatchObject({ status: "failed" });
  returned = { status: "suspended" };
  expect(await scheduler.trigger("maintain")).toMatchObject({ status: "suspended" });
  returned = { archived: 1 };
  expect(await scheduler.trigger("maintain")).toMatchObject({ status: "completed" });
  await expect(scheduler.trigger("maintain", { input: "run" })).rejects.toMatchObject({ code: "invalid_schedule" });
  expect(() =>
    createScheduler({
      checkpoints: f.checkpoints,
      ownership: {},
      targets: { maintain: { kind: "command", agent: f.agent, command: "missing", input: {} } },
    }),
  ).toThrow(expect.objectContaining({ code: "unknown_command" }));
  await scheduler.stop();
  await f.agent.dispose();
});

test("explicit_timezone_and_deleted_id_recreation", async () => {
  const f = await setup();
  const original = await f.scheduler.schedule({ id: "x", target: "job", cron: "0 2 * * *", tz: "Asia/Dhaka" });
  expect(original.nextRunAt).toBe("2026-10-13T20:00:00.000Z");
  await f.scheduler.delete("x");
  const replacement = await f.scheduler.schedule({ id: "x", target: "job", cron: "0 2 * * *" });
  expect(replacement.scheduleSessionId).not.toBe(original.scheduleSessionId);
  expect((await f.checkpoints.loadCheckpoint({ namespace: "headless.schedules", key: "x" }))?.version).toBe(3);
  await expect(f.scheduler.pause("missing")).rejects.toMatchObject({ code: "schedule_not_found" });
  await f.agent.dispose();
});
