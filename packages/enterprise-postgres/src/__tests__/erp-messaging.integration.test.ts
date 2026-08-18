import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable } from "../identifiers.js";
import type { ErpOutboxRecord, PostgresEnterpriseState } from "../types.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_erp_t_${randomUUID().replaceAll("-", "")}`;
}

function operator(tenantId: string): AgentIdentity {
  return {
    tenantId,
    principal: { kind: "user", id: "operator-1" },
    scopes: ["erp:outbox:admin"],
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    verified: true,
  };
}

describeIntegration("ERP transactional outbox/inbox", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 8 });
    pools.push(pool);
    return pool;
  }

  async function open() {
    const pool = createPool();
    const schema = uniqueSchema();
    const state = await createPostgresEnterpriseState({ pool, schema });
    await pool.query(`CREATE TABLE ${qualifyTable(schema, "erp_local")} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    return { pool, schema, state };
  }

  async function appendMessage(
    pool: Pool,
    state: PostgresEnterpriseState,
    input: { tenantId: string; messageId: string; topic: string; payload: unknown },
  ): Promise<ErpOutboxRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const record = await state.erpMessaging.outbox.append(client, input);
      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  it("atomically pairs caller-owned business writes with outbox intent and deduplicates inbox writes", async () => {
    const { pool, schema, state } = await open();
    const local = qualifyTable(schema, "erp_local");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO ${local} (id, value) VALUES ($1, $2)`, ["committed", "yes"]);
      const first = await state.erpMessaging.outbox.append(client, {
        tenantId: "tenant-a",
        messageId: "message-committed",
        topic: "invoice.posted",
        payload: { invoiceId: "invoice-1" },
      });
      await client.query("COMMIT");
      assert.equal(first.status, "pending");
      assert.equal(first.attempt, 0);
    } finally {
      client.release();
    }
    const duplicate = await appendMessage(pool, state, {
      tenantId: "tenant-a",
      messageId: "message-committed",
      topic: "invoice.posted",
      payload: { invoiceId: "invoice-1" },
    });
    assert.equal(duplicate.version, 1);
    await assert.rejects(
      () =>
        appendMessage(pool, state, {
          tenantId: "tenant-a",
          messageId: "message-committed",
          topic: "invoice.cancelled",
          payload: { invoiceId: "invoice-1" },
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT",
    );

    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query(`INSERT INTO ${local} (id, value) VALUES ($1, $2)`, ["rolled-back", "no"]);
      await state.erpMessaging.outbox.append(rollbackClient, {
        tenantId: "tenant-a",
        messageId: "message-rolled-back",
        topic: "invoice.posted",
        payload: { invoiceId: "invoice-rollback" },
      });
      await rollbackClient.query("ROLLBACK");
    } finally {
      rollbackClient.release();
    }

    assert.equal((await pool.query(`SELECT 1 FROM ${local} WHERE id = 'committed'`)).rowCount, 1);
    assert.equal((await pool.query(`SELECT 1 FROM ${local} WHERE id = 'rolled-back'`)).rowCount, 0);
    assert.equal(
      (await pool.query(`SELECT 1 FROM ${qualifyTable(schema, "prism_erp_outbox")} WHERE message_id = 'message-rolled-back'`)).rowCount,
      0,
    );

    const inboxClient = await pool.connect();
    try {
      await inboxClient.query("BEGIN");
      assert.equal(
        await state.erpMessaging.inbox.record(inboxClient, {
          tenantId: "tenant-a",
          consumer: "ledger",
          messageId: "message-committed",
        }),
        true,
      );
      await inboxClient.query(`INSERT INTO ${local} (id, value) VALUES ($1, $2)`, ["ledger-once", "yes"]);
      await inboxClient.query("COMMIT");

      await inboxClient.query("BEGIN");
      assert.equal(
        await state.erpMessaging.inbox.record(inboxClient, {
          tenantId: "tenant-a",
          consumer: "ledger",
          messageId: "message-committed",
        }),
        false,
      );
      await inboxClient.query("COMMIT");
    } finally {
      inboxClient.release();
    }
    assert.equal((await pool.query(`SELECT 1 FROM ${local} WHERE id = 'ledger-once'`)).rowCount, 1);
  });

  it("claims concurrently, fences stale transitions, retries, marks unknown, and replays by audit reference", async () => {
    const { pool, schema, state } = await open();
    const tenantId = "tenant-a";
    await appendMessage(pool, state, { tenantId, messageId: "message-a", topic: "invoice.posted", payload: { id: "a" } });
    await appendMessage(pool, state, { tenantId, messageId: "message-b", topic: "invoice.posted", payload: { id: "b" } });

    const [firstClaim, secondClaim] = await Promise.all([
      state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }),
      state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }),
    ]);
    const claimed = [...firstClaim, ...secondClaim];
    assert.equal(claimed.length, 2);
    assert.deepEqual(new Set(claimed.map((record) => record.messageId)), new Set(["message-a", "message-b"]));
    assert.ok(claimed.every((record) => record.status === "dispatched" && record.claimToken));

    const first = claimed[0]!;
    const second = claimed[1]!;
    const completed = await state.erpMessaging.dispatcher.acknowledge({
      tenantId,
      messageId: first.messageId,
      claimToken: first.claimToken!,
      expectedVersion: first.version,
    });
    assert.equal(completed.status, "completed");
    await assert.rejects(
      () =>
        state.erpMessaging.dispatcher.acknowledge({
          tenantId,
          messageId: first.messageId,
          claimToken: first.claimToken!,
          expectedVersion: first.version,
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT",
    );

    const retryable = await state.erpMessaging.dispatcher.retry({
      tenantId,
      messageId: second.messageId,
      claimToken: second.claimToken!,
      expectedVersion: second.version,
      error: { code: "ERR_REMOTE_TIMEOUT" },
      delayMs: 0,
    });
    assert.equal(retryable.status, "retryable");
    const retried = (await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }))[0]!;
    assert.equal(retried.messageId, second.messageId);
    const unknown = await state.erpMessaging.dispatcher.markUnknown({
      tenantId,
      messageId: retried.messageId,
      claimToken: retried.claimToken!,
      expectedVersion: retried.version,
      error: { code: "ERR_REMOTE_AMBIGUOUS" },
    });
    assert.equal(unknown.status, "unknown");
    const replayed = await state.erpMessaging.dispatcher.replay({
      tenantId,
      messageId: unknown.messageId,
      expectedVersion: unknown.version,
      auditRef: "audit:replay:second",
      authorizedBy: operator(tenantId),
    });
    assert.equal(replayed.status, "pending");
    const replayClaim = (await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }))[0]!;
    assert.equal(replayClaim.messageId, second.messageId);
    assert.equal(
      (
        await state.erpMessaging.dispatcher.acknowledge({
          tenantId,
          messageId: replayClaim.messageId,
          claimToken: replayClaim.claimToken!,
          expectedVersion: replayClaim.version,
        })
      ).status,
      "completed",
    );

    await appendMessage(pool, state, { tenantId, messageId: "message-dead", topic: "invoice.posted", payload: { id: "dead" } });
    const deadClaim = (await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }))[0]!;
    const dead = await state.erpMessaging.dispatcher.deadLetter({
      tenantId,
      messageId: deadClaim.messageId,
      claimToken: deadClaim.claimToken,
      expectedVersion: deadClaim.version,
      auditRef: "audit:dead-letter:dead",
      authorizedBy: operator(tenantId),
    });
    assert.equal(dead.status, "dead_letter");

    await appendMessage(pool, state, { tenantId, messageId: "message-expired", topic: "invoice.posted", payload: { id: "expired" } });
    const expiredClaim = (await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }))[0]!;
    const outbox = qualifyTable(schema, "prism_erp_outbox");
    await pool.query(
      `UPDATE ${outbox} SET lease_expires_at = CURRENT_TIMESTAMP - interval '1 second' WHERE tenant_id = $1 AND message_id = $2`,
      [tenantId, expiredClaim.messageId],
    );
    assert.deepEqual(await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }), []);
    assert.equal(
      (await pool.query(`SELECT status FROM ${outbox} WHERE tenant_id = $1 AND message_id = $2`, [tenantId, expiredClaim.messageId]))
        .rows[0]?.status,
      "unknown",
    );
    const expiredReplay = await state.erpMessaging.dispatcher.replay({
      tenantId,
      messageId: expiredClaim.messageId,
      expectedVersion: expiredClaim.version + 1,
      auditRef: "audit:replay:expired",
      authorizedBy: operator(tenantId),
    });
    const recovered = (await state.erpMessaging.dispatcher.claim({ tenantId, batchSize: 1 }))[0]!;
    assert.equal(recovered.messageId, expiredReplay.messageId);
    await state.erpMessaging.dispatcher.acknowledge({
      tenantId,
      messageId: recovered.messageId,
      claimToken: recovered.claimToken!,
      expectedVersion: recovered.version,
    });
  });

  it("uses the tenant-scoped claim index for bounded queue pages", async () => {
    const { pool, schema } = await open();
    const table = qualifyTable(schema, "prism_erp_outbox");
    await pool.query(
      `INSERT INTO ${table} (tenant_id, message_id, topic, payload, status, attempt, version, next_attempt_at, created_at, updated_at)
       SELECT 'tenant-' || (g % 10)::text, 'benchmark-' || g::text, 'invoice.posted', '{}'::jsonb, 'pending', 0, 1,
              CURRENT_TIMESTAMP - (g || ' milliseconds')::interval,
              CURRENT_TIMESTAMP - (g || ' milliseconds')::interval,
              CURRENT_TIMESTAMP
       FROM generate_series(1, 10000) AS g`,
    );
    await pool.query(`ANALYZE ${table}`);
    const explain = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND status IN ('pending', 'retryable') AND next_attempt_at <= CURRENT_TIMESTAMP
       ORDER BY next_attempt_at, created_at, message_id
       LIMIT $2 FOR UPDATE SKIP LOCKED`,
      ["tenant-1", 100],
    );
    const plan = JSON.stringify(explain.rows[0]?.["QUERY PLAN"]);
    assert.doesNotMatch(plan, /Seq Scan/);
    assert.match(plan, /prism_erp_outbox_claim_idx/);
  });

  it("keeps tenants isolated and validates bounded payload/action inputs", async () => {
    const { pool, state } = await open();
    await appendMessage(pool, state, { tenantId: "tenant-a", messageId: "same-id", topic: "topic", payload: { tenant: "a" } });
    await appendMessage(pool, state, { tenantId: "tenant-b", messageId: "same-id", topic: "topic", payload: { tenant: "b" } });
    const tenantAClaim = (await state.erpMessaging.dispatcher.claim({ tenantId: "tenant-a", batchSize: 10 }))[0]!;
    const tenantBClaim = (await state.erpMessaging.dispatcher.claim({ tenantId: "tenant-b", batchSize: 10 }))[0]!;
    assert.equal(tenantAClaim.tenantId, "tenant-a");
    assert.equal(tenantBClaim.tenantId, "tenant-b");
    await assert.rejects(
      () =>
        state.erpMessaging.dispatcher.acknowledge({
          tenantId: "tenant-a",
          messageId: "same-id",
          claimToken: tenantBClaim.claimToken!,
          expectedVersion: tenantBClaim.version,
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT",
    );
    await assert.rejects(
      () =>
        appendMessage(pool, state, {
          tenantId: "tenant-a",
          messageId: "too-large",
          topic: "topic",
          payload: { value: "x".repeat(70 * 1024) },
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
    await assert.rejects(
      () =>
        state.erpMessaging.dispatcher.replay({
          tenantId: "tenant-a",
          messageId: "same-id",
          expectedVersion: 1,
          auditRef: "",
          authorizedBy: operator("tenant-a"),
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
  });
});
