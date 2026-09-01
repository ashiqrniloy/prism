import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, ToolEffectKey } from "@arnilo/prism";
import { ToolEffectError } from "@arnilo/prism";
import type { Pool } from "pg";
import { PolicyError } from "../../../governance/policy/index.js";
import { WorkToolError } from "../../../integrations/work/index.js";
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
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY",
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
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(queries.length, queryCount);
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
      identity,
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
