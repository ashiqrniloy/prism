import { expect, test } from "bun:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism-extensions/workflows";
import { createScheduler } from "../index.js";
import { build } from "./fixtures/agent.js";

for (const missed of ["skip", "run-once"] as const)
  test(`missed_${missed.replace("-", "_")}_after_restart`, async () => {
    const { agent } = await build({ resumed: true });
    const checkpoints = createMemoryCheckpointStore();
    let now = Date.parse("2026-10-13T00:00:00Z");
    const options = {
      checkpoints,
      ownership: {},
      missed,
      targets: { job: { kind: "agent" as const, agent, input: "run" } },
      clock: {
        now: () => now,
        sleep: async (_ms: number, signal: AbortSignal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            if (signal.aborted) resolve();
          });
        },
      },
    };
    const first = createScheduler(options);
    await first.schedule({ id: "x", target: "job", cron: "* * * * *" });
    first.start();
    await first.stop();
    now += 3 * 60000 + 1;
    const second = createScheduler(options);
    second.start();
    for (let i = 0; i < 200 && !(await second.list())[0].lastFiring; i++) await Bun.sleep(1);
    await second.stop();
    const state = (await second.list())[0];
    expect(state.lastFiring).toMatchObject({ missed: 3, policy: missed, status: missed === "skip" ? "skipped" : "completed" });
    expect(Date.parse(state.nextRunAt ?? "")).toBeGreaterThan(now);
    expect((await agent.sessions.list({ parentSessionId: state.scheduleSessionId })).items).toHaveLength(missed === "skip" ? 0 : 1);
    await agent.dispose();
  });

test("invalid_missed_policy_rejected", () => {
  expect(() =>
    createScheduler({ checkpoints: createMemoryCheckpointStore(), ownership: {}, targets: {}, missed: "replay" } as never),
  ).toThrow("invalid_missed_policy");
});

test("lease_lost_is_recorded_and_not_refired", async () => {
  const { agent } = await build({ resumed: true });
  const leases = createMemoryLeaseStore();
  let renewals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const target = {
    ...agent,
    async session(options?: Parameters<typeof agent.session>[0]) {
      const session = await agent.session(options);
      return options?.parent
        ? {
            ...session,
            id: session.id,
            close: () => session.close(),
            async run() {
              await gate;
              return { status: "completed" } as never;
            },
          }
        : session;
    },
  };
  const scheduler = createScheduler({
    checkpoints: createMemoryCheckpointStore(),
    leases: {
      ...leases,
      async renewLease() {
        renewals++;
        return null;
      },
    },
    ownership: {},
    limits: { firingLeaseMs: 30 },
    targets: { job: { kind: "agent", agent: target, input: "run" } },
  });
  const at = new Date(Date.now() + 100);
  await scheduler.schedule({ id: "lost", target: "job", at });
  scheduler.start();
  for (let i = 0; i < 300 && !renewals; i++) await Bun.sleep(2);
  expect(renewals).toBe(1);
  release();
  await scheduler.stop();
  expect((await scheduler.list())[0].lastFiring).toMatchObject({ status: "lease_lost", fencingToken: 1 });
  scheduler.start();
  await scheduler.stop();
  expect((await agent.sessions.list({ parentSessionId: (await scheduler.list())[0].scheduleSessionId })).items).toHaveLength(1);
  await agent.dispose();
});

test("lease_keys_are_scoped", async () => {
  const leases = createMemoryLeaseStore();
  const { holdFiringLease } = await import("../scheduler/lease.js");
  const key = { namespace: "headless.firing", key: "daily:2026-10-13T00:00:00.000Z", ownerId: "worker", ttlMs: 30000 };
  const held = await holdFiringLease(leases, { ...key, tenantId: "ours" });
  expect(held).toBeDefined();
  if (!held) throw new Error("lease not acquired");
  try {
    await expect(leases.tryAcquireLease({ ...key, tenantId: "foreign", ownerId: "other" })).rejects.toThrow("ownership");
  } finally {
    await held.release();
  }
});
