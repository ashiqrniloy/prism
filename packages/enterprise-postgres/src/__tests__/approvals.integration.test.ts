import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import type { AgentIdentity } from "@arnilo/prism";
import type { ApprovalAuthority, ApprovalRecord, ApprovalStore, PolicyActorRef } from "@arnilo/prism-policy";
import { createPostgresApprovalStore, type PostgresApprovalStoreOptions } from "../index.js";
import { qualifyTable } from "../identifiers.js";
import { applyEnterpriseMigrations } from "../migrations.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_approval_t_${randomUUID().replaceAll("-", "")}`;
}

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    principal: { kind: "user", id: "alice" },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["erp:invoice:release"],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    verified: true,
    ...overrides,
  };
}

function authority(
  roles: Record<string, string | { role: string; delegatedFrom?: readonly PolicyActorRef[] }>,
  revision = "v1",
): ApprovalAuthority {
  return {
    policyRevision: revision,
    resolveRoles(actor) {
      const entry = roles[actor.principal.id];
      if (entry === undefined) return [];
      return [typeof entry === "string" ? { role: entry } : entry];
    },
  };
}

function createInput(overrides: Partial<Parameters<ApprovalStore["create"]>[0]> = {}) {
  return {
    tenantId: "tenant-a",
    requester: identity({ userId: "requester-1", principal: { kind: "user", id: "requester-1" } }),
    action: { kind: "invoice.release", digest: "digest-1" },
    requirements: [{ role: "finance-approver", quorum: 1 }],
    separateFromRequester: true,
    expiresAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  } as Parameters<ApprovalStore["create"]>[0];
}

function decideInput(record: ApprovalRecord, overrides: Partial<Parameters<ApprovalStore["decide"]>[0]> = {}) {
  return {
    tenantId: record.tenantId,
    requestId: record.id,
    expectedRevision: record.revision,
    role: "finance-approver",
    actor: identity({ principal: { kind: "user", id: "bob" } }),
    decision: "approve" as const,
    auditRef: "audit:decide-1",
    ...overrides,
  } as Parameters<ApprovalStore["decide"]>[0];
}

describeIntegration("ERP multi-party approvals", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 8 });
    pools.push(pool);
    return pool;
  }

  async function open(options: Omit<PostgresApprovalStoreOptions, "pool"> = { authority: authority({ alice: "finance-approver" }) }) {
    const pool = createPool();
    const schema = uniqueSchema();
    await applyEnterpriseMigrations(pool, schema);
    return { pool, schema, store: createPostgresApprovalStore({ pool, schema, ...options }) };
  }

  it("consumes a granted approval atomically with the host action in one transaction", async () => {
    const { pool, schema, store } = await open({ authority: authority({ alice: "finance-approver" }) });
    const local = qualifyTable(schema, "erp_local_approval");
    await pool.query(`CREATE TABLE ${local} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);

    const record = await store.create(createInput());
    await store.decide(decideInput(record, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    const approved = (await store.get({ tenantId: record.tenantId, requestId: record.id }))!;
    assert.equal(approved.status, "approved");

    const client = await pool.connect();
    let consumed!: ApprovalRecord;
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO ${local} (id, value) VALUES ($1, $2)`, ["released", "yes"]);
      consumed = await store.consume({
        tenantId: approved.tenantId,
        requestId: approved.id,
        expectedRevision: approved.revision,
        action: approved.action,
        authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
        auditRef: "audit:consume-host-tx",
        client,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    assert.equal(consumed.status, "consumed");
    assert.equal((await store.get({ tenantId: record.tenantId, requestId: record.id }))?.status, "consumed");
    assert.equal((await pool.query(`SELECT 1 FROM ${local} WHERE id = 'released'`)).rowCount, 1);

    // Rollback together: a fresh read must still see the grant approved and no action row.
    const second = await store.create(createInput());
    await store.decide(decideInput(second, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    const approvedSecond = (await store.get({ tenantId: second.tenantId, requestId: second.id }))!;
    const rollbackClient = await pool.connect();
    let sawConsumed = false;
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query(`INSERT INTO ${local} (id, value) VALUES ($1, $2)`, ["rolled-back", "yes"]);
      const consumedInRollback = await store.consume({
        tenantId: approvedSecond.tenantId,
        requestId: approvedSecond.id,
        expectedRevision: approvedSecond.revision,
        action: approvedSecond.action,
        authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
        auditRef: "audit:consume-rolled-back",
        client: rollbackClient,
      });
      sawConsumed = consumedInRollback.status === "consumed";
      await rollbackClient.query("ROLLBACK");
    } finally {
      rollbackClient.release();
    }
    assert.equal(sawConsumed, true);
    assert.equal((await store.get({ tenantId: second.tenantId, requestId: second.id }))?.status, "approved");
    assert.equal((await pool.query(`SELECT 1 FROM ${local} WHERE id = 'rolled-back'`)).rowCount, 0);
  });

  it("produces exactly one terminal transition under concurrent final votes", async () => {
    const { store } = await open({ authority: authority({ alice: "finance-approver", bob: "finance-approver" }) });
    const record = await store.create(createInput());
    const [first, second] = await Promise.allSettled([
      store.decide(decideInput(record, { actor: identity({ principal: { kind: "user", id: "alice" } }), auditRef: "audit:a" })),
      store.decide(decideInput(record, { actor: identity({ principal: { kind: "user", id: "bob" } }), auditRef: "audit:b" })),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "rejected");
    assert.match(String((second as PromiseRejectedResult).reason), /stale/i);
    const final = (await store.get({ tenantId: record.tenantId, requestId: record.id }))!;
    assert.equal(final.status, "approved");
    assert.equal(final.revision, 2);
    assert.equal(final.decisions.length, 1);
  });

  it("enforces decision lifecycle, bounded delegation, and tenant isolation on PostgreSQL", async () => {
    const { store } = await open({
      authority: authority({
        alice: "finance-approver",
        dave: { role: "finance-approver", delegatedFrom: [{ tenantId: "tenant-a", principalId: "carol", principalKind: "user" }] },
      }),
    });
    const record = await store.create(createInput());

    // Separation of duties: requester cannot decide.
    await assert.rejects(
      () => store.decide(decideInput(record, { actor: identity({ principal: { kind: "user", id: "requester-1" } }) })),
      /separation of duties/i,
    );
    // Wrong role denied while pending.
    await assert.rejects(
      () => store.decide(decideInput(record, { actor: identity({ principal: { kind: "user", id: "mallory" } }) })),
      /does not hold required role/i,
    );

    // Duplicate vote is idempotent on a still-pending quorum-2 request.
    const two = await store.create(createInput({ requirements: [{ role: "finance-approver", quorum: 2 }] }));
    const first = await store.decide(decideInput(two, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    assert.equal(first.status, "pending");
    assert.equal(first.revision, 2);
    const duplicate = await store.decide(decideInput(first, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    assert.equal(duplicate.revision, 2);
    assert.equal(duplicate.decisions.length, 1);
    await assert.rejects(() => store.decide(decideInput(first, { expectedRevision: 99 })), /stale/i);

    // Approval reaches terminal approved.
    const approvedReq = await store.create(createInput());
    const approved = await store.decide(decideInput(approvedReq, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    assert.equal(approved.status, "approved");

    // Revocation before consumption invalidates the grant.
    const revocable = await store.create(createInput());
    const revApproved = await store.decide(decideInput(revocable, { actor: identity({ principal: { kind: "user", id: "alice" } }) }));
    await store.revoke({
      tenantId: revocable.tenantId,
      requestId: revocable.id,
      expectedRevision: revApproved.revision,
      authorizedBy: identity({ principal: { kind: "user", id: "admin" } }),
      auditRef: "audit:revoke-1",
    });
    await assert.rejects(
      () =>
        store.consume({
          tenantId: revocable.tenantId,
          requestId: revocable.id,
          expectedRevision: 3,
          action: revocable.action,
          authorizedBy: identity({ principal: { kind: "service", id: "releaser" } }),
          auditRef: "audit:consume-1",
        }),
      /not approved/i,
    );

    // Delegation preserves the chain and works on PostgreSQL.
    const delegated = await store.create(createInput({ delegationMaxDepth: 1 }));
    const delegatedDecision = await store.decide(decideInput(delegated, { actor: identity({ principal: { kind: "user", id: "dave" } }) }));
    assert.equal(delegatedDecision.status, "approved");
    assert.equal(delegatedDecision.decisions[0]?.grant.delegatedFrom?.[0]?.principalId, "carol");

    // Tenant isolation: the same request id does not exist in another tenant.
    const foreign = await store.get({ tenantId: "tenant-other", requestId: record.id });
    assert.equal(foreign, null);
    const pages = await store.query({ tenantId: "tenant-a", status: "approved", limit: 10 });
    assert.equal(pages.items.length, 2);
    assert.equal(pages.items[0]?.status, "approved");
    const progress = await store.query({ tenantId: "tenant-a", status: "pending", limit: 10 });
    assert.equal(progress.items.length, 2);
  });
});
