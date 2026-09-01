import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { type AgentEventRecord, assertAgentEventSourceConforms } from "@arnilo/prism";
import { Pool } from "pg";
import { qualifyTable } from "../identifiers.js";
import { createPostgresPersistence } from "../persistence.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;
const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
const cursorSecret = "phase7-event-source-integration-secret";

function schema(): string {
  return `prism_t_${randomUUID().replaceAll("-", "")}`;
}

function event(
  id: string,
  type: "agent_started" | "turn_started" | "agent_finished",
  sessionId: string,
  runId: string,
  timestamp = "2026-01-01T00:00:00.000Z",
): AgentEventRecord {
  return {
    id,
    ...ownership,
    sessionId,
    runId,
    type,
    timestamp,
    event: type === "turn_started" ? { type, sessionId, runId, turn: 1 } : { type, sessionId, runId },
    redacted: true,
  };
}

describeIntegration("PostgreSQL durable agent event source", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length > 0) await pools.pop()!.end();
  });

  function pool(): Pool {
    const value = new Pool({ connectionString: postgresUrl, max: 8 });
    pools.push(value);
    return value;
  }

  async function persistence(value: Pool, valueSchema: string) {
    return createPostgresPersistence({
      pool: value,
      schema: valueSchema,
      eventCursorSecret: cursorSecret,
      eventSource: { pollIntervalMs: 30_000 },
    });
  }

  it("conforms with durable append, page, handoff, and retention behavior", async () => {
    const store = await persistence(pool(), schema());
    await assertAgentEventSourceConforms(() => store.events);
    const input = { ownership, sessionId: "session-a", runId: "run-a" };
    const cursor = (await store.events.page(input)).items[0]!.cursor;
    assert.equal((await store.events.cleanup({ ownership, before: "2026-01-01T00:00:01.000Z", limit: 100 })).deleted, 1);
    await assert.rejects(store.events.page({ ...input, after: cursor }), (error: unknown) => {
      return Boolean(error && typeof error === "object" && "code" in error && error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION");
    });
    await store.close();
  });

  it("allocates contiguous sequences across pools and resumes cursor on another replica", async () => {
    const valueSchema = schema();
    const first = await persistence(pool(), valueSchema);
    const second = await persistence(pool(), valueSchema);
    const input = { ownership, sessionId: "session-concurrent", runId: "run-concurrent" };
    const appended = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 === 0 ? first : second).events.append(event(`event-${index}`, "turn_started", input.sessionId, input.runId)),
      ),
    );
    assert.deepEqual(
      appended.map((item) => item.sequence).sort((left, right) => left - right),
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    const firstPage = await first.events.page({ ...input, limit: 8 });
    const secondPage = await second.events.page({ ...input, after: firstPage.items.at(-1)!.cursor, limit: 8 });
    assert.deepEqual(
      [...firstPage.items, ...secondPage.items].map((item) => item.record.sequence),
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    await first.close();
    await second.close();
  });

  it("backfills the v5 counter before allocating the next durable sequence", async () => {
    const valueSchema = schema();
    const valuePool = pool();
    const first = await persistence(valuePool, valueSchema);
    const input = { ownership, sessionId: "session-backfill", runId: "run-backfill" };
    await first.events.append(event("event-a", "agent_started", input.sessionId, input.runId));
    await first.events.append(event("event-b", "turn_started", input.sessionId, input.runId, "2026-01-01T00:00:01.000Z"));
    await first.close();

    const migrations = qualifyTable(valueSchema, "prism_migrations");
    const streams = qualifyTable(valueSchema, "prism_agent_event_streams");
    const index = qualifyTable(valueSchema, "prism_agent_events_run_sequence_idx");
    const retentionIndex = qualifyTable(valueSchema, "prism_agent_events_owner_timestamp_sequence_idx");
    const events = qualifyTable(valueSchema, "prism_agent_events");
    await valuePool.query(`DELETE FROM ${migrations} WHERE name IN ($1, $2, $3, $4)`, [
      "006_agent_event_source",
      "007_agent_event_retention_index",
      "008_session_version",
      "009_run_prompt_version",
    ]);
    await valuePool.query(`DROP TABLE ${streams}`);
    await valuePool.query(`DROP INDEX ${index}`);
    await valuePool.query(`DROP INDEX ${retentionIndex}`);
    await valuePool.query(`CREATE INDEX prism_agent_events_run_sequence_idx ON ${events} (run_id, sequence)`);

    const reopened = await persistence(valuePool, valueSchema);
    assert.equal(
      (await reopened.events.append(event("event-c", "turn_started", input.sessionId, input.runId, "2026-01-01T00:00:02.000Z"))).sequence,
      3,
    );
    await reopened.close();
  });

  it("fails migration instead of choosing an order for duplicate legacy sequences", async () => {
    const valueSchema = schema();
    const valuePool = pool();
    const first = await persistence(valuePool, valueSchema);
    const input = { ownership, sessionId: "session-duplicate", runId: "run-duplicate" };
    await first.events.append(event("event-a", "agent_started", input.sessionId, input.runId));
    await first.close();

    const migrations = qualifyTable(valueSchema, "prism_migrations");
    const streams = qualifyTable(valueSchema, "prism_agent_event_streams");
    const index = qualifyTable(valueSchema, "prism_agent_events_run_sequence_idx");
    const retentionIndex = qualifyTable(valueSchema, "prism_agent_events_owner_timestamp_sequence_idx");
    const events = qualifyTable(valueSchema, "prism_agent_events");
    await valuePool.query(`DELETE FROM ${migrations} WHERE name IN ($1, $2, $3, $4)`, [
      "006_agent_event_source",
      "007_agent_event_retention_index",
      "008_session_version",
      "009_run_prompt_version",
    ]);
    await valuePool.query(`DROP TABLE ${streams}`);
    await valuePool.query(`DROP INDEX ${index}`);
    await valuePool.query(`DROP INDEX ${retentionIndex}`);
    await valuePool.query(`CREATE INDEX prism_agent_events_run_sequence_idx ON ${events} (run_id, sequence)`);
    await valuePool.query(
      `INSERT INTO ${events} (
      id, session_id, run_id, entry_id, sequence, type, timestamp, event,
      redacted, tenant_id, account_id, user_id, metadata
    ) SELECT $1, session_id, run_id, entry_id, sequence, type, timestamp, event,
      redacted, tenant_id, account_id, user_id, metadata
      FROM ${events} WHERE id = $2`,
      ["event-b", "event-a"],
    );
    await assert.rejects(persistence(valuePool, valueSchema), /unique/i);
  });

  it("purges event counters before deleting a retained session", async () => {
    const store = await persistence(pool(), schema());
    const input = { ownership, sessionId: "session-purge", runId: "run-purge" };
    await store.events.append(event("event-purge", "agent_started", input.sessionId, input.runId));
    assert.deepEqual(
      await store.lifecycle.applyRetention({
        ...ownership,
        candidates: [input.sessionId],
        policy: { id: "retention", createdAt: "2026-01-01T00:00:00.000Z" },
      }),
      {
        deleted: [input.sessionId],
        skippedHeld: [],
      },
    );
    assert.equal((await store.events.page(input)).items.length, 0);
    await store.close();
  });

  it("delivers a committed cross-pool append through one LISTEN wake before polling", async () => {
    const valueSchema = schema();
    const subscriber = await persistence(pool(), valueSchema);
    const producer = await persistence(pool(), valueSchema);
    const input = { ownership, sessionId: "session-listen", runId: "run-listen" };
    const iterator = subscriber.events.subscribe(input)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await producer.events.append(event("event-listen", "agent_started", input.sessionId, input.runId));
    const received = await Promise.race([
      pending,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LISTEN wake timed out")), 2000)),
    ]);
    assert.equal(received.value?.record.id, "event-listen");
    await iterator.return?.();
    await subscriber.close();
    await producer.close();
  });

  it("uses named indexes for durable replay and exact-owner retention cleanup", async () => {
    const valueSchema = schema();
    const database = pool();
    const store = await persistence(database, valueSchema);
    const input = { ownership, sessionId: "session-plan", runId: "run-plan" };
    await store.events.append(event("event-plan", "agent_started", input.sessionId, input.runId));
    const events = qualifyTable(valueSchema, "prism_agent_events");
    const sessions = qualifyTable(valueSchema, "prism_sessions");
    await database.query(
      `INSERT INTO ${sessions} (id, created_at, updated_at)
       SELECT 'noise-session-' || value, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
       FROM generate_series(1, 1000) AS value`,
    );
    await database.query(
      `INSERT INTO ${events} (id, session_id, run_id, sequence, type, timestamp, event, redacted, tenant_id, account_id, user_id)
       SELECT 'noise-event-' || value, 'noise-session-' || value, 'noise-run-' || value, 1, 'turn_started',
              '2026-01-01T00:00:00.000Z', '{}', TRUE, $1, $2, $3
       FROM generate_series(1, 1000) AS value`,
      [ownership.tenantId, ownership.accountId, ownership.userId],
    );
    await database.query(`ANALYZE ${events}`);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plans = await Promise.all([
        client.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id FROM ${events}
           WHERE session_id = $1 AND run_id = $2 AND tenant_id = $3
             AND account_id IS NOT DISTINCT FROM $4 AND user_id IS NOT DISTINCT FROM $5 AND redacted = TRUE
           ORDER BY sequence ASC, id ASC LIMIT 100`,
          [input.sessionId, input.runId, ownership.tenantId, ownership.accountId, ownership.userId],
        ),
        client.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id FROM ${events}
           WHERE tenant_id = $1 AND account_id = $2 AND user_id = $3
             AND timestamp < $4 AND redacted = TRUE
           ORDER BY timestamp ASC, sequence ASC, id ASC LIMIT 100`,
          [ownership.tenantId, ownership.accountId, ownership.userId, "2026-01-01T00:00:01.000Z"],
        ),
      ]);
      const text = plans.map((plan) => JSON.stringify(plan.rows[0]?.["QUERY PLAN"]));
      assert.match(text[0]!, /prism_agent_events_run_sequence_idx/);
      assert.match(text[1]!, /prism_agent_events_owner_timestamp_sequence_idx/);
      assert.ok(text.every((plan) => !plan.includes("Seq Scan")));
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await store.close();
    }
  });
});
