import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity, ToolEffectKey, ToolResult } from "@arnilo/prism";
import { ToolEffectError } from "@arnilo/prism";
import { assertToolEffectStoreConforms } from "@arnilo/prism/testing/tool-effect-store-conformance";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable } from "../identifiers.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_enterprise_e_${randomUUID().replaceAll("-", "")}`;
}

function identity(tenantId = "tenant"): AgentIdentity {
  return {
    tenantId,
    accountId: "account",
    userId: "user",
    principal: { kind: "agent", id: "agent" },
    scopes: ["tools:execute"],
    issuedAt: "2026-08-04T00:00:00.000Z",
    verified: true,
  };
}

function effect(key: string, overrides: Partial<ToolEffectKey> = {}): ToolEffectKey {
  const agent = overrides.identity ?? identity();
  return {
    identity: agent,
    ownership: overrides.ownership ?? { tenantId: agent.tenantId, accountId: agent.accountId, userId: agent.userId },
    key,
    sessionId: "session",
    runId: "run",
    toolCallId: "call",
    toolName: "mail.send",
    argumentsHash: "a".repeat(64),
    ...overrides,
  };
}

function transition(base: ToolEffectKey, record: { readonly claimToken?: string; readonly version: number }) {
  assert.ok(record.claimToken);
  return { ...base, claimToken: record.claimToken, expectedVersion: record.version };
}

function result(base: ToolEffectKey): ToolResult {
  return { toolCallId: base.toolCallId, name: base.toolName, value: { status: "sent" } };
}

describeIntegration("enterprise PostgreSQL tool effects", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function pool(): Pool {
    const value = new Pool({ connectionString: postgresUrl, max: 3 });
    pools.push(value);
    return value;
  }

  it("conforms, atomically claims across pools, and survives reopen", async () => {
    const schema = uniqueSchema();
    const firstPool = pool();
    const first = await createPostgresEnterpriseState({ pool: firstPool, schema });
    const second = await createPostgresEnterpriseState({ pool: pool(), schema });
    await assertToolEffectStoreConforms(() => first.toolEffects);

    const base = effect(`prism:tool-effect:v1:${randomUUID()}`);
    const claims = await Promise.all([first.toolEffects.begin(base), second.toolEffects.begin(base)]);
    const acquired = claims.find((claim) => claim.outcome === "acquired");
    assert.equal(claims.filter((claim) => claim.outcome === "acquired").length, 1);
    assert.ok(acquired?.record.claimToken);
    const dispatched = await first.toolEffects.markDispatched(transition(base, acquired!.record));
    const completed = await first.toolEffects.complete({ ...transition(base, dispatched), result: result(base), resultRef: "mail/1" });
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.result, result(base));
    assert.ok(completed.expiresAt);
    assert.equal((await second.toolEffects.begin(base)).outcome, "existing");

    const reopened = await createPostgresEnterpriseState({ pool: firstPool, schema });
    assert.deepEqual((await reopened.toolEffects.get(base))?.result, result(base));
    assert.equal(
      await second.toolEffects.get(
        effect(base.key, { identity: identity("foreign"), ownership: { tenantId: "foreign", accountId: "account", userId: "user" } }),
      ),
      undefined,
    );
    await assert.rejects(
      () => second.toolEffects.get(effect(base.key, { runId: "foreign-run" })),
      (error: unknown) => error instanceof ToolEffectError && error.code === "ERR_PRISM_TOOL_EFFECT_CONFLICT",
    );
  });

  it("uses database expiry, never cleans unknown, and requires exact reconciliation CAS", async () => {
    const schema = uniqueSchema();
    const database = pool();
    const state = await createPostgresEnterpriseState({ pool: database, schema });
    const table = qualifyTable(schema, "prism_tool_effects");

    const pending = effect("pending-expiry");
    await state.toolEffects.begin(pending);
    await database.query(`UPDATE ${table} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key = $1`, [
      pending.key,
    ]);
    assert.equal((await state.toolEffects.get(pending))?.status, "failed_retryable");
    const retry = await state.toolEffects.begin(pending);
    assert.equal(retry.outcome, "acquired");
    assert.equal(retry.record.attempt, 2);

    const dispatched = effect("dispatched-expiry");
    const dispatchedClaim = await state.toolEffects.begin(dispatched);
    const marked = await state.toolEffects.markDispatched(transition(dispatched, dispatchedClaim.record));
    await database.query(`UPDATE ${table} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key = $1`, [
      dispatched.key,
    ]);
    const unknown = await state.toolEffects.get(dispatched);
    assert.equal(unknown?.status, "unknown");
    assert.equal((await state.toolEffects.begin(dispatched)).outcome, "existing");
    await assert.rejects(
      () => state.toolEffects.resolveUnknown({ ...dispatched, expectedVersion: marked.version, status: "failed_terminal" }),
      (error: unknown) => error instanceof ToolEffectError && error.code === "ERR_PRISM_TOOL_EFFECT_CONFLICT",
    );
    const resolved = await state.toolEffects.resolveUnknown({
      ...dispatched,
      expectedVersion: unknown!.version,
      status: "failed_terminal",
      failure: { code: "OPERATOR_RECONCILED" },
    });
    assert.equal(resolved.status, "failed_terminal");

    const retainedUnknown = effect("retained-unknown");
    const retainedClaim = await state.toolEffects.begin(retainedUnknown);
    const retainedDispatched = await state.toolEffects.markDispatched(transition(retainedUnknown, retainedClaim.record));
    await state.toolEffects.markUnknown({ ...transition(retainedUnknown, retainedDispatched), failure: { code: "TRANSPORT_LOST" } });
    const cleanup = await state.toolEffects.cleanup({
      ownership: retainedUnknown.ownership,
      before: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.ok(cleanup.deleted >= 1);
    assert.equal((await state.toolEffects.get(retainedUnknown))?.status, "unknown");
  });

  it("transitions and retains exact-owned effects through enterprise maintenance cleanup", async () => {
    const schema = uniqueSchema();
    const database = pool();
    const state = await createPostgresEnterpriseState({ pool: database, schema });
    const table = qualifyTable(schema, "prism_tool_effects");
    const owner = { tenantId: "tenant", accountId: "account", userId: "user", principalId: "agent" };

    const pending = effect("maintenance-pending");
    await state.toolEffects.begin(pending);
    const dispatched = effect("maintenance-dispatched");
    const dispatchedClaim = await state.toolEffects.begin(dispatched);
    await state.toolEffects.markDispatched(transition(dispatched, dispatchedClaim.record));
    const foreign = effect("maintenance-foreign", {
      identity: identity("foreign"),
      ownership: { tenantId: "foreign", accountId: "account", userId: "user" },
    });
    await state.toolEffects.begin(foreign);
    await database.query(`UPDATE ${table} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE effect_key IN ($1, $2, $3)`, [
      pending.key,
      dispatched.key,
      foreign.key,
    ]);

    assert.deepEqual(await state.cleanup({ ...owner, limit: 2 }), { removed: 0, transitioned: 2 });
    assert.equal((await state.toolEffects.get(pending))?.status, "failed_retryable");
    assert.equal((await state.toolEffects.get(dispatched))?.status, "unknown");
    assert.equal((await database.query(`SELECT status FROM ${table} WHERE effect_key = $1`, [foreign.key])).rows[0]?.status, "pending");
  });

  it("uses primary, expiry, and cleanup indexes for owned effect paths", async () => {
    const schema = uniqueSchema();
    const database = pool();
    const state = await createPostgresEnterpriseState({ pool: database, schema });
    const table = qualifyTable(schema, "prism_tool_effects");
    const pending = effect("plan-pending");
    await state.toolEffects.begin(pending);
    const completed = effect("plan-completed");
    const claim = await state.toolEffects.begin(completed);
    const dispatched = await state.toolEffects.markDispatched(transition(completed, claim.record));
    await state.toolEffects.complete({ ...transition(completed, dispatched), result: result(completed) });

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      for (const [sql, index] of [
        [
          `EXPLAIN (FORMAT JSON) SELECT effect_key FROM ${table}
           WHERE tenant_id = 'tenant' AND account_key = 'account' AND user_key = 'user' AND principal_id = 'agent' AND effect_key = 'plan-pending'`,
          "prism_tool_effects_pkey",
        ],
        [
          `EXPLAIN (FORMAT JSON) SELECT effect_key FROM ${table}
           WHERE tenant_id = 'tenant' AND account_key = 'account' AND user_key = 'user' AND principal_id = 'agent'
             AND status IN ('pending', 'dispatched') AND expires_at <= clock_timestamp()
           ORDER BY expires_at, effect_key LIMIT 2`,
          "prism_tool_effects_expiry_idx",
        ],
        [
          `EXPLAIN (FORMAT JSON) SELECT effect_key FROM ${table}
           WHERE tenant_id = 'tenant' AND account_key = 'account' AND user_key = 'user'
             AND status IN ('completed', 'failed_terminal') AND updated_at < clock_timestamp()
           ORDER BY updated_at, effect_key LIMIT 2`,
          "prism_tool_effects_cleanup_idx",
        ],
      ] as const) {
        const explain = await client.query(sql);
        assert.match(JSON.stringify(explain.rows[0]?.["QUERY PLAN"]), new RegExp(index));
      }
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("rejects oversized outcomes before persistence and malformed stored data on read", async () => {
    const schema = uniqueSchema();
    const database = pool();
    const state = await createPostgresEnterpriseState({ pool: database, schema });
    const oversized = effect("oversized");
    const claim = await state.toolEffects.begin(oversized);
    const dispatched = await state.toolEffects.markDispatched(transition(oversized, claim.record));
    await assert.rejects(
      () =>
        state.toolEffects.complete({
          ...transition(oversized, dispatched),
          result: { ...result(oversized), value: "x".repeat(64 * 1024) },
        }),
      (error: unknown) => error instanceof ToolEffectError && error.code === "ERR_PRISM_TOOL_EFFECT_LIMIT",
    );

    const malformed = effect("malformed");
    const malformedClaim = await state.toolEffects.begin(malformed);
    const malformedDispatched = await state.toolEffects.markDispatched(transition(malformed, malformedClaim.record));
    await state.toolEffects.complete({ ...transition(malformed, malformedDispatched), result: result(malformed) });
    await database.query(`UPDATE ${qualifyTable(schema, "prism_tool_effects")} SET result = '[]'::jsonb WHERE effect_key = $1`, [
      malformed.key,
    ]);
    await assert.rejects(
      () => state.toolEffects.get(malformed),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA",
    );
  });
});
