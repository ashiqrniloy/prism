import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import { Pool } from "pg";
import { EvalError } from "../../../governance/evals/index.js";
import { PolicyError } from "../../../governance/policy/index.js";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable } from "../identifiers.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_enterprise_s_${randomUUID().replaceAll("-", "")}`;
}

function identity(): AgentIdentity {
  return {
    tenantId: "tenant",
    userId: "user",
    principal: { kind: "agent", id: "agent" },
    scopes: ["policy:write"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

describeIntegration("enterprise PostgreSQL policy and evaluation stores", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 3 });
    pools.push(pool);
    return pool;
  }

  it("persists validated policy decisions across reopen with opaque owner-bound pages", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    const owner = { tenantId: "tenant", userId: "user" };
    const createdAt = "2026-08-03T12:00:00.000Z";
    for (const [id, outcome] of [
      ["decision-a", "allow"],
      ["decision-b", "deny"],
      ["decision-c", "approval"],
    ] as const) {
      await state.policy.append({
        id,
        policyId: "mail",
        policyVersion: "v1",
        outcome,
        identity: identity(),
        target: { kind: "mailbox", id: "inbox" },
        reason: `reason '${id}`,
        evidenceRefs: ["rule:mail"],
        createdAt,
        ...owner,
      });
    }
    await state.policy.append({
      id: "foreign",
      policyId: "mail",
      policyVersion: "v1",
      outcome: "allow",
      identity: { ...identity(), tenantId: "foreign" },
      target: { kind: "mailbox", id: "inbox" },
      createdAt,
      tenantId: "foreign",
      userId: "user",
    });

    const first = await state.policy.query({ ...owner, limit: 2 });
    assert.deepEqual(
      first.items.map((record) => record.id),
      ["decision-a", "decision-b"],
    );
    assert.ok(first.nextCursor);
    assert.notEqual(first.nextCursor, "decision-b");
    assert.ok(Object.isFrozen(first.items[0]!));
    assert.ok(Object.isFrozen(first.items[0]!.actor));
    const second = await state.policy.query({ ...owner, limit: 2, cursor: first.nextCursor });
    assert.deepEqual(
      second.items.map((record) => record.id),
      ["decision-c"],
    );
    assert.deepEqual(
      (await state.policy.query({ ...owner, order: "desc" })).items.map((record) => record.id),
      ["decision-c", "decision-b", "decision-a"],
    );
    assert.deepEqual(
      (await state.policy.query({ ...owner, outcome: "deny" })).items.map((record) => record.id),
      ["decision-b"],
    );
    await assert.rejects(
      () => state.policy.query({ tenantId: "tenant", userId: "other", cursor: first.nextCursor }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP",
    );
    const reopened = await createPostgresEnterpriseState({ pool, schema });
    assert.deepEqual(
      (await reopened.policy.query(owner)).items.map((record) => record.id),
      ["decision-a", "decision-b", "decision-c"],
    );

    const peer = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const duplicate = {
      id: "race-policy",
      policyId: "race",
      policyVersion: "v1",
      outcome: "allow" as const,
      identity: identity(),
      target: { kind: "mailbox", id: "inbox" },
      ...owner,
    };
    const raced = await Promise.allSettled([state.policy.append(duplicate), peer.policy.append(duplicate)]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      raced.some(
        (result) =>
          result.status === "rejected" && result.reason instanceof PolicyError && result.reason.code === "ERR_PRISM_POLICY_DUPLICATE",
      ),
      true,
    );

    await pool.query(`UPDATE ${qualifyTable(schema, "prism_policy_decisions")} SET target = '{}'::jsonb WHERE id = 'race-policy'`);
    await assert.rejects(
      () => state.policy.query({ ...owner, policyId: "race", limit: 1 }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
  });

  it("persists every evaluation query shape with exact owner pages and deep-frozen JSON", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    const owner = { tenantId: "tenant", userId: "user" };
    const createdAt = "2026-08-03T13:00:00.000Z";
    const base = {
      scorerId: "quality",
      sampled: true,
      sessionId: "session",
      runId: "run",
      traceId: "trace",
      datasetId: "dataset",
      itemId: "item",
      experimentId: "experiment",
      createdAt,
      ...owner,
    };
    await state.evaluations.append({
      id: "eval-a",
      status: "scored",
      score: 0.8,
      reason: "score ' quoted",
      metadata: { nested: { ok: true } },
      ...base,
    });
    await state.evaluations.append({ id: "eval-b", status: "failed", error: { message: "scorer failed", code: "FAIL" }, ...base });
    await state.evaluations.append({ id: "eval-c", status: "skipped", ...base });
    await state.evaluations.append({ id: "foreign", status: "scored", score: 1, ...base, tenantId: "foreign" });

    const first = await state.evaluations.query({ ...owner, runId: "run", status: ["scored", "failed"], limit: 1 });
    assert.deepEqual(
      first.items.map((record) => record.id),
      ["eval-a"],
    );
    assert.ok(first.nextCursor);
    assert.ok(Object.isFrozen(first.items[0]!));
    assert.ok(Object.isFrozen(first.items[0]!.metadata));
    const second = await state.evaluations.query({ ...owner, runId: "run", status: ["scored", "failed"], cursor: first.nextCursor });
    assert.deepEqual(
      second.items.map((record) => record.id),
      ["eval-b"],
    );
    for (const query of [
      { id: "eval-a" },
      { scorerId: "quality" },
      { sessionId: "session" },
      { runId: "run" },
      { experimentId: "experiment" },
      { datasetId: "dataset" },
      { itemId: "item" },
      { status: "skipped" as const },
    ]) {
      assert.ok((await state.evaluations.query({ ...owner, ...query })).items.length >= 1);
    }
    await assert.rejects(
      () => state.evaluations.query({ tenantId: "foreign", userId: "user", cursor: first.nextCursor }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP",
    );
    const reopened = await createPostgresEnterpriseState({ pool, schema });
    assert.deepEqual(
      (await reopened.evaluations.query({ ...owner, order: "desc" })).items.map((record) => record.id),
      ["eval-c", "eval-b", "eval-a"],
    );

    const peer = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const duplicate = { id: "race-evaluation", status: "scored" as const, score: 1, ...base };
    const raced = await Promise.allSettled([state.evaluations.append(duplicate), peer.evaluations.append(duplicate)]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      raced.some(
        (result) => result.status === "rejected" && result.reason instanceof EvalError && result.reason.code === "ERR_PRISM_EVAL_STORE",
      ),
      true,
    );

    await pool.query(`UPDATE ${qualifyTable(schema, "prism_evaluations")} SET metadata = '[]'::jsonb WHERE id = 'eval-a'`);
    await assert.rejects(
      () => state.evaluations.query({ ...owner, id: "eval-a" }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
  });

  it("uses owner-prefixed policy and evaluation indexes for representative cursor pages", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await createPostgresEnterpriseState({ pool, schema });
    const policy = qualifyTable(schema, "prism_policy_decisions");
    const evaluations = qualifyTable(schema, "prism_evaluations");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      for (const [table, where, index] of [
        [
          policy,
          "tenant_id = 'tenant' AND account_key = '' AND user_key = 'user' AND outcome = 'allow'",
          "prism_policy_decisions_owner_outcome_created_idx",
        ],
        [
          evaluations,
          "tenant_id = 'tenant' AND account_key = '' AND user_key = 'user' AND run_id = 'run'",
          "prism_evaluations_owner_run_created_idx",
        ],
      ] as const) {
        const result = await client.query(`EXPLAIN (FORMAT JSON) SELECT id FROM ${table} WHERE ${where} ORDER BY created_at, id LIMIT 2`);
        assert.match(JSON.stringify(result.rows[0]?.["QUERY PLAN"]), new RegExp(index));
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });
});
