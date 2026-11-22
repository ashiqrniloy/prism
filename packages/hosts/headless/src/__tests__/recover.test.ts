import { expect, test } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  type OwnershipScope,
  type PersistencePage,
  providerTextDelta,
  type RunRecord,
  type SessionStore,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { continueInterrupted, findInterruptedRuns, HeadlessError, type RunListing } from "../index.js";

const OWNER: OwnershipScope = { tenantId: "t1", userId: "u1" };
const NOW = Date.parse("2026-11-17T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** In-memory ledger: upsert by run id, first `startedAt` kept (as SQLite and Postgres do). */
function memoryLedger() {
  const rows = new Map<string, RunRecord>();
  const ledger = {
    rows,
    async appendRun(record: RunRecord) {
      const prior = rows.get(record.id);
      rows.set(record.id, { ...record, startedAt: prior?.startedAt ?? record.startedAt });
    },
    async appendEvent() {},
    async appendToolCall() {},
    async appendUsage() {},
    async queryRuns(query: Parameters<RunListing["queryRuns"]>[0]): Promise<PersistencePage<RunRecord>> {
      const statuses = query.status === undefined ? undefined : Array.isArray(query.status) ? query.status : [query.status];
      const all = [...rows.values()].filter(
        (row) =>
          (statuses === undefined || statuses.includes(row.status as never)) &&
          (["tenantId", "accountId", "userId"] as const).every((key) => query[key] === undefined || row[key] === query[key]),
      );
      const start = Number(query.cursor ?? 0);
      const limit = query.limit ?? 100;
      const items = all.slice(start, start + limit);
      return { items, ...(start + limit < all.length ? { nextCursor: String(start + limit) } : {}) };
    },
  };
  return ledger;
}

const record = (id: string, sessionId: string, status: RunRecord["status"], startedAt: string, owner = OWNER): RunRecord => ({
  id,
  sessionId,
  status,
  startedAt,
  ...(status === "running" ? {} : { finishedAt: startedAt }),
  ...owner,
});

test("find_interrupted_runs_returns_stale_running_records_in_scope", async () => {
  const ledger = memoryLedger();
  await ledger.appendRun(record("r1", "s1", "running", ago(120_000)));
  await ledger.appendRun(record("r2", "s1", "running", ago(90_000)));
  await ledger.appendRun(record("r3", "s2", "running", ago(5_000)));
  await ledger.appendRun(record("r4", "s3", "running", ago(120_000), { tenantId: "t2", userId: "u1" }));
  await ledger.appendRun(record("r5", "s4", "running", ago(120_000), { tenantId: "t1" }));
  await ledger.appendRun(record("r6", "s5", "running", ago(200_000)));
  const found = await findInterruptedRuns(ledger, { ownership: OWNER, olderThanMs: 60_000, pageSize: 2, now: () => NOW });
  // s1 keeps its newest run; s2 is too young; s3 and s4 are outside the scope.
  expect(found).toEqual([
    { sessionId: "s5", runId: "r6", startedAt: ago(200_000) },
    { sessionId: "s1", runId: "r2", startedAt: ago(90_000) },
  ]);
});

test("finished_and_suspended_runs_are_not_returned", async () => {
  const ledger = memoryLedger();
  for (const [index, status] of (["succeeded", "failed", "aborted", "suspended", "denied", "queued"] as const).entries()) {
    await ledger.appendRun(record(`r${index}`, `s${index}`, status, ago(120_000)));
  }
  // A running record whose terminal record arrived later.
  await ledger.appendRun(record("done", "sd", "running", ago(120_000)));
  await ledger.appendRun(record("done", "sd", "succeeded", ago(10_000)));
  expect(await findInterruptedRuns(ledger, { ownership: OWNER, now: () => NOW })).toEqual([]);
});

test("ledger_without_listing_fails_closed", async () => {
  const writeOnly = { appendRun: async () => {} } as unknown as RunListing;
  await expect(findInterruptedRuns(writeOnly, { ownership: OWNER })).rejects.toEqual(new HeadlessError("ledger_query_unsupported"));
  await expect(findInterruptedRuns(memoryLedger(), {} as never)).rejects.toEqual(new HeadlessError("invalid_ownership"));
  await expect(continueInterrupted({ session: async () => ({}) as never }, [], { concurrency: 0 })).rejects.toEqual(
    new HeadlessError("invalid_limit"),
  );
});

async function agentOn(store: SessionStore, ledger: ReturnType<typeof memoryLedger>, scripts: Parameters<typeof mockProvider>[0]) {
  return createAgent({
    id: "recover-test",
    model: { provider: "mock", model: "test" },
    slots: { store },
    ownership: OWNER,
    runLedger: ledger,
    packages: [mockProvider(scripts)],
  });
}

test("continue_interrupted_skips_sessions_that_owe_nothing", async () => {
  const store = createMemorySessionStore();
  const ledger = memoryLedger();
  // First process: one run fails before the model answers, one finishes.
  const first = await agentOn(store, ledger, [
    [{ type: "error", error: { message: "boom" } }],
    [providerTextDelta("done"), { type: "done" }],
  ]);
  const broken = await first.session();
  expect((await broken.run("do the thing").catch(() => ({ status: "failed" }))).status).toBe("failed");
  const finished = await first.session();
  expect((await finished.run("say hi")).status).toBe("completed");
  await first.dispose();
  // Simulate a process death: both sessions still have a `running` ledger row.
  await ledger.appendRun(record("crashed-1", broken.id, "running", ago(120_000)));
  await ledger.appendRun(record("crashed-2", finished.id, "running", ago(120_000)));
  await ledger.appendRun(record("crashed-3", "gone", "running", ago(120_000)));

  const second = await agentOn(store, ledger, [[providerTextDelta("recovered"), { type: "done" }]]);
  const runs = await findInterruptedRuns(ledger, { ownership: OWNER, now: () => NOW });
  expect(runs.map((run) => run.sessionId).sort()).toEqual([broken.id, finished.id, "gone"].sort());
  const outcomes = await continueInterrupted(second, runs, { concurrency: 2 });
  const by = new Map(outcomes.map((outcome) => [outcome.sessionId, outcome]));
  expect(by.get(broken.id)).toMatchObject({ status: "continued", result: { status: "completed" } });
  expect(by.get(finished.id)).toMatchObject({ status: "skipped", reason: "nothing_to_continue" });
  expect(by.get("gone")).toMatchObject({ status: "skipped", reason: "session_not_found" });
  const messages = await (await second.session({ id: broken.id })).messages();
  expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  await second.dispose();
});
