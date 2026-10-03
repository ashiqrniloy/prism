import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentIdentity, ToolEffectKey } from "@arnilo/prism";
import { ToolEffectError } from "@arnilo/prism";
import type { Pool } from "pg";
import { PolicyError } from "../../../governance/policy/index.js";
import { EnterprisePostgresError } from "../errors.js";
import { createPostgresEvaluationStore } from "../evaluations.js";
import { createPostgresPolicyDecisionStore } from "../policy.js";
import { createPostgresToolEffectStore } from "../tool-effects.js";
import { createPostgresIdempotencyStore } from "../work-idempotency.js";

const identity: AgentIdentity = {
  tenantId: "tenant",
  userId: "user",
  principal: { kind: "agent", id: "agent" },
  scopes: ["policy:write"],
  issuedAt: "2026-08-03T00:00:00.000Z",
  verified: true,
};

describe("enterprise policy and evaluation stores", () => {
  it("validates records before SQL and binds hostile values", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        return { rowCount: 1, rows: [] };
      },
    } as unknown as Pool;
    const policy = createPostgresPolicyDecisionStore(pool, "prism");
    const reason = `x'; DROP TABLE prism_policy_decisions; --`;
    await policy.append({
      id: "decision",
      policyId: "mail",
      policyVersion: "v1",
      outcome: "allow",
      identity,
      target: { kind: "mailbox", id: "inbox" },
      reason,
      tenantId: "tenant",
      userId: "user",
    });
    assert.equal(queries[0]?.text.includes(reason), false);
    assert.equal(queries[0]?.values.includes(reason), true);
    await assert.rejects(
      () =>
        policy.append({
          id: "bad",
          policyId: "mail",
          policyVersion: "v1",
          outcome: "allow",
          identity,
          target: { kind: "mailbox", id: "inbox" },
          tenantId: "tenant",
          userId: "user",
          payload: "forbidden",
        } as never),
      PolicyError,
    );

    const evaluations = createPostgresEvaluationStore(pool, "prism");
    await assert.rejects(
      async () =>
        evaluations.append({
          id: "missing-owner",
          scorerId: "s",
          status: "scored",
          score: 1,
          sampled: true,
          createdAt: new Date().toISOString(),
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP",
    );
    await assert.rejects(
      async () =>
        evaluations.append({
          id: "bad-score",
          scorerId: "s",
          status: "scored",
          score: Number.NaN,
          sampled: true,
          createdAt: new Date().toISOString(),
          tenantId: "tenant",
        }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS",
    );
    await assert.rejects(
      () => evaluations.query(),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP",
    );

    const work = createPostgresIdempotencyStore(pool, "prism");
    const queryCount = queries.length;
    await assert.rejects(
      () => work.begin({ identity, key: "x".repeat(2_049), op: "mail.send" }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY",
    );
    assert.equal(queries.length, queryCount);
    await assert.rejects(
      () =>
        work.fail({
          identity,
          key: "key",
          op: "mail.send",
          claimToken: "token",
          expectedVersion: 1,
          status: "completed",
          failure: { code: "bad" },
        } as never),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(queries.length, queryCount);
  });

  it("ownership-scoped effects read the empty SQL principal partition", async () => {
    const row = {
      tenant_id: "tenant",
      account_key: "",
      user_key: "",
      principal_id: "",
      effect_key: "effect",
      session_id: "s",
      run_id: "r",
      tool_call_id: "c",
      tool_name: "mutate",
      arguments_hash: "a".repeat(64),
      status: "completed",
      attempt: 1,
      version: 2,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
      result: JSON.stringify({ toolCallId: "c", name: "mutate" }),
    };
    const pool = {
      query: async (sql: string, values: unknown[]) => {
        assert.equal(values[3], "");
        return { rows: sql.startsWith("SELECT") ? [row] : [], rowCount: 0 };
      },
    } as unknown as Pool;
    const record = await createPostgresToolEffectStore(pool, "prism").get({
      ownership: { tenantId: "tenant" },
      key: "effect",
      sessionId: "s",
      runId: "r",
      toolCallId: "c",
      toolName: "mutate",
      argumentsHash: "a".repeat(64),
    });
    assert.equal(record?.status, "completed");
    assert.equal(record?.result?.toolCallId, "c");
  });

  it("ownership-scoped effects fail closed on legacy identity claims before insertion", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ exists: 1 }], rowCount: 1 };
      },
    } as unknown as Pool;
    await assert.rejects(
      () =>
        createPostgresToolEffectStore(pool, "prism").begin({
          ownership: { tenantId: "tenant" },
          key: "effect",
          sessionId: "s",
          runId: "r",
          toolCallId: "c",
          toolName: "mutate",
          argumentsHash: "a".repeat(64),
        }),
      /conflict/,
    );
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.includes("principal_id <>"));
    assert.equal(
      queries.some((sql) => sql.includes("INSERT")),
      false,
    );
  });

  it("validates generic tool effects before SQL and parameterizes effect identifiers", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Pool;
    const effects = createPostgresToolEffectStore(pool, "prism");
    const hostile = `prism:tool-effect:v1:x'; DROP TABLE prism_tool_effects; --`;
    const input: ToolEffectKey = {
      ownership: { tenantId: "tenant", userId: "user" },
      key: hostile,
      sessionId: "session",
      runId: "run",
      toolCallId: "call",
      toolName: "mail.send",
      argumentsHash: "a".repeat(64),
    };
    await effects.get(input);
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.equal(query.text.includes(hostile), false);
      assert.ok(query.values.includes(hostile));
    }
    await assert.rejects(
      () => effects.begin({ ...input, argumentsHash: "not-a-sha" }),
      (error: unknown) => error instanceof ToolEffectError && error.code === "ERR_PRISM_TOOL_EFFECT_LIMIT",
    );
    await assert.rejects(
      () => effects.get({ ...input, ownership: {} }),
      (error: unknown) => error instanceof ToolEffectError && error.code === "ERR_PRISM_TOOL_EFFECT_CONFLICT",
    );
    assert.equal(queries.length, 2);
  });
});
