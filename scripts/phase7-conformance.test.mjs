import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { promisify } from "node:util";
import { createPostgresEnterpriseState } from "../packages/enterprise-postgres/dist/index.js";
import { createPostgresPersistence } from "../packages/session-store-postgres/dist/index.js";
import { Pool } from "pg";

const exec = promisify(execFile);
const url = process.env.PRISM_TEST_POSTGRES_URL;
const describeProtected = url ? describe : describe.skip;
const worker = new URL("./fixtures/phase7-worker.mjs", import.meta.url);
const cursorSecret = "phase7-process-worker-secret";
const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
const identity = {
  ...ownership,
  principal: { kind: "agent", id: "agent-a" },
  scopes: ["tools:execute"],
  issuedAt: "2026-08-04T00:00:00.000Z",
  verified: true,
};
const schemas = new Set();
const pools = [];

function schema() {
  const value = `prism_phase7_${randomUUID().replaceAll("-", "")}`;
  schemas.add(value);
  return value;
}

function pool(max = 8) {
  const value = new Pool({ connectionString: url, max });
  pools.push(value);
  return value;
}

function event(id, sessionId, runId) {
  return {
    id,
    ...ownership,
    sessionId,
    runId,
    type: "turn_started",
    timestamp: "2026-08-04T00:00:00.000Z",
    event: { type: "turn_started", sessionId, runId, turn: 1 },
    redacted: true,
  };
}

function effect(key) {
  return {
    identity,
    ownership,
    key,
    sessionId: "effect-session",
    runId: "effect-run",
    toolCallId: "effect-call",
    toolName: "mail.send",
    argumentsHash: "a".repeat(64),
  };
}

async function runWorker(command, input) {
  await exec(process.execPath, [worker.pathname, command], {
    env: { ...process.env, PRISM_PHASE7_WORKER_INPUT: JSON.stringify({ ...input, url }) },
  });
}

async function take(source, count, timeoutMs = 5000) {
  const iterator = source[Symbol.asyncIterator]();
  const items = [];
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("phase 7 stream timed out")), timeoutMs));
  try {
    while (items.length < count) {
      const item = await Promise.race([iterator.next(), timeout]);
      assert.equal(item.done, false, "stream closed before expected events");
      items.push(item.value);
    }
    return items;
  } finally {
    await iterator.return?.();
  }
}

async function waitForListener(database) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = await database.query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN prism_agent_events' ORDER BY backend_start DESC LIMIT 1",
    );
    if (typeof result.rows[0]?.pid === "number") return result.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("LISTEN backend did not start");
}

describeProtected("Phase 7 protected process conformance", () => {
  after(async () => {
    while (pools.length) await pools.pop().end();
    const cleanup = new Pool({ connectionString: url });
    try {
      for (const name of schemas) await cleanup.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    } finally {
      await cleanup.end();
    }
  });

  it("keeps a 16-process producer timeline resumable across replicas and tenant-bound", async () => {
    const valueSchema = schema();
    const database = pool(16);
    const first = await createPostgresPersistence({ pool: database, schema: valueSchema, eventCursorSecret: cursorSecret });
    const input = { ownership, sessionId: "process-session", runId: "process-run" };
    const received = take(first.events.subscribe(input), 16);
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        runWorker("append", { schema: valueSchema, event: event(`event-${index}`, input.sessionId, input.runId) }),
      ),
    );
    const items = await received;
    assert.deepEqual(
      items.map((item) => item.record.sequence),
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    assert.deepEqual(new Set(items.map((item) => item.record.id)).size, 16);

    const head = await first.events.page({ ...input, limit: 8 });
    await first.close();
    const second = await createPostgresPersistence({ pool: pool(4), schema: valueSchema, eventCursorSecret: cursorSecret });
    const tail = await second.events.page({ ...input, after: head.items.at(-1).cursor, limit: 8 });
    assert.deepEqual(
      tail.items.map((item) => item.record.sequence),
      Array.from({ length: 8 }, (_, index) => index + 9),
    );
    await assert.rejects(
      second.events.page({
        ...input,
        ownership: { tenantId: "tenant-b", accountId: "account-a", userId: "user-a" },
        after: head.items.at(-1).cursor,
      }),
      (error) => error?.code === "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR" && !String(error.message).includes("process-run"),
    );
    await second.close();
  });

  it("catches up by polling after a terminated LISTEN backend", async () => {
    const valueSchema = schema();
    const database = pool(8);
    const subscriber = await createPostgresPersistence({
      pool: database,
      schema: valueSchema,
      eventCursorSecret: cursorSecret,
      eventSource: { pollIntervalMs: 25, reconnectInitialMs: 5000, reconnectMaxMs: 5000 },
    });
    const input = { ownership, sessionId: "recovery-session", runId: "recovery-run" };
    const iterator = subscriber.events.subscribe(input)[Symbol.asyncIterator]();
    const next = iterator.next();
    const pid = await waitForListener(database);
    assert.equal((await database.query("SELECT pg_terminate_backend($1, 1000) AS terminated", [pid])).rows[0]?.terminated, true);
    await runWorker("append", { schema: valueSchema, event: event("recovery-event", input.sessionId, input.runId) });
    const item = await Promise.race([
      next,
      new Promise((_, reject) => setTimeout(() => reject(new Error("poll catch-up timed out")), 2000)),
    ]);
    assert.equal(item.done, false);
    assert.equal(item.value.record.id, "recovery-event");
    await iterator.return?.();
    await subscriber.close();
  });

  it("never reruns pending or dispatched effects after worker death", async () => {
    const valueSchema = schema();
    const database = pool(8);
    const state = await createPostgresEnterpriseState({ pool: database, schema: valueSchema });
    await database.query(`CREATE TABLE "${valueSchema}"."phase7_effect_counter" (id TEXT PRIMARY KEY, executions INTEGER NOT NULL)`);

    const pending = effect("pending-worker-death");
    await runWorker("effect-pending", { schema: valueSchema, effect: pending });
    assert.equal((await state.toolEffects.begin(pending)).outcome, "existing");
    await database.query(
      `UPDATE "${valueSchema}"."prism_tool_effects" SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key = $1`,
      [pending.key],
    );
    assert.equal((await state.toolEffects.get(pending)).status, "failed_retryable");
    assert.equal((await state.toolEffects.begin(pending)).outcome, "acquired");

    const dispatched = effect("dispatched-worker-death");
    await runWorker("effect-dispatched", { schema: valueSchema, effect: dispatched });
    assert.equal((await state.toolEffects.begin(dispatched)).record.status, "dispatched");
    assert.equal(
      (await database.query(`SELECT executions FROM "${valueSchema}"."phase7_effect_counter" WHERE id = $1`, [dispatched.key])).rows[0]
        ?.executions,
      1,
    );
    await database.query(
      `UPDATE "${valueSchema}"."prism_tool_effects" SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key = $1`,
      [dispatched.key],
    );
    assert.equal((await state.toolEffects.get(dispatched)).status, "unknown");
    assert.equal((await state.toolEffects.begin(dispatched)).outcome, "existing");
    assert.equal(
      (await database.query(`SELECT executions FROM "${valueSchema}"."phase7_effect_counter" WHERE id = $1`, [dispatched.key])).rows[0]
        ?.executions,
      1,
    );
    assert.equal(
      await state.toolEffects.get({
        ...dispatched,
        identity: { ...identity, tenantId: "tenant-b" },
        ownership: { ...ownership, tenantId: "tenant-b" },
      }),
      undefined,
    );
  });
});
