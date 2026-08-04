import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity, ToolExecutionContext } from "@arnilo/prism";
import { createMicrosoft365CliAdapter, createWorkTools, WorkToolError } from "@arnilo/prism-work-tools";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable } from "../identifiers.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_enterprise_w_${randomUUID().replaceAll("-", "")}`;
}

function identity(tenantId = "tenant"): AgentIdentity {
  return {
    tenantId,
    userId: "user",
    principal: { kind: "agent", id: "agent" },
    scopes: ["work:mutate"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

function context(): ToolExecutionContext {
  return { sessionId: "session", runId: "run", toolCallId: "call", idempotencyKey: `prism:tool-effect:v1:${"a".repeat(64)}` };
}

describeIntegration("enterprise PostgreSQL work idempotency", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 3 });
    pools.push(pool);
    return pool;
  }

  it("atomically claims, transitions, restarts, caps retries, and isolates exact owner/op", async () => {
    const schema = uniqueSchema();
    const firstPool = createPool();
    const first = await createPostgresEnterpriseState({ pool: firstPool, schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const input = { identity: identity(), key: `mutation'; DROP TABLE prism_work_idempotency; --`, op: "mail.send" };

    const claims = await Promise.all([first.workIdempotency.begin(input), second.workIdempotency.begin(input)]);
    const acquired = claims.find((claim) => claim.outcome === "acquired")!;
    assert.equal(claims.filter((claim) => claim.outcome === "acquired").length, 1);
    assert.equal(acquired.record.status, "in_progress");
    assert.ok(acquired.record.claimToken);
    assert.ok(Object.isFrozen(acquired.record));
    assert.equal((await second.workIdempotency.get(input))?.status, "in_progress");
    assert.equal(await second.workIdempotency.get({ ...input, identity: identity("foreign") }), undefined);
    assert.equal(await second.workIdempotency.get({ ...input, identity: { ...identity(), accountId: "other-account" } }), undefined);
    assert.equal(
      await second.workIdempotency.get({ ...input, identity: { ...identity(), principal: { kind: "agent", id: "other-agent" } } }),
      undefined,
    );
    await assert.rejects(
      () => second.workIdempotency.get({ ...input, op: "calendar.add" }),
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      () =>
        first.workIdempotency.complete({
          ...input,
          claimToken: "stale",
          expectedVersion: acquired.record.version,
          result: { draftId: "draft" },
        }),
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    const completed = await first.workIdempotency.complete({
      ...input,
      claimToken: acquired.record.claimToken!,
      expectedVersion: acquired.record.version,
      result: { draftId: "draft", resourceId: "resource", rawProviderResponse: "never store this" } as never,
    });
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.result, { draftId: "draft", resourceId: "resource" });
    assert.ok(completed.expiresAt);
    assert.equal((await second.workIdempotency.begin(input)).outcome, "existing");
    const reopened = await createPostgresEnterpriseState({ pool: firstPool, schema });
    assert.deepEqual((await reopened.workIdempotency.get(input))?.result, { draftId: "draft", resourceId: "resource" });

    const retryInput = { ...input, key: "retry", maxAttempts: 2 };
    const retry = await first.workIdempotency.begin(retryInput);
    assert.equal(retry.outcome, "acquired");
    await first.workIdempotency.fail({
      ...retryInput,
      claimToken: retry.record.claimToken!,
      expectedVersion: retry.record.version,
      status: "failed_retryable",
      failure: { code: "ERR_PRISM_WORK_CREDENTIAL" },
    });
    const secondAttempt = await second.workIdempotency.begin(retryInput);
    assert.equal(secondAttempt.outcome, "acquired");
    assert.equal(secondAttempt.record.attempt, 2);
    await second.workIdempotency.fail({
      ...retryInput,
      claimToken: secondAttempt.record.claimToken!,
      expectedVersion: secondAttempt.record.version,
      status: "failed_retryable",
      failure: { code: "ERR_PRISM_WORK_CREDENTIAL" },
    });
    assert.equal((await first.workIdempotency.begin(retryInput)).outcome, "existing");

    const terminalInput = { ...input, key: "terminal" };
    const terminal = await first.workIdempotency.begin(terminalInput);
    await first.workIdempotency.fail({
      ...terminalInput,
      claimToken: terminal.record.claimToken!,
      expectedVersion: terminal.record.version,
      status: "failed_terminal",
      failure: { code: "ERR_PRISM_WORK_POLICY" },
    });
    assert.equal((await second.workIdempotency.begin(terminalInput)).outcome, "existing");

    const unknownInput = { ...input, key: "ambiguous" };
    const ambiguous = await first.workIdempotency.begin(unknownInput);
    const unknown = await first.workIdempotency.markUnknown({
      ...unknownInput,
      claimToken: ambiguous.record.claimToken!,
      expectedVersion: ambiguous.record.version,
      failure: { code: "TRANSPORT_LOST" },
    });
    const reconciled = await second.workIdempotency.resolveUnknown({
      ...unknownInput,
      expectedVersion: unknown.version,
      status: "failed_retryable",
      failure: { code: "RETRY_APPROVED" },
    });
    assert.equal(reconciled.status, "failed_retryable");
    assert.equal((await first.workIdempotency.begin(unknownInput)).outcome, "acquired");
  });

  it("makes expired claims unknown, blocks stale completion, and requires explicit reconciliation", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    const input = { identity: identity(), key: "expired", op: "mail.send" };
    const claim = await state.workIdempotency.begin(input);
    assert.equal(claim.outcome, "acquired");
    const work = qualifyTable(schema, "prism_work_idempotency");
    await pool.query(`UPDATE ${work} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE idempotency_key = $1`, [
      input.key,
    ]);
    await assert.rejects(
      () =>
        state.workIdempotency.complete({
          ...input,
          claimToken: claim.record.claimToken!,
          expectedVersion: claim.record.version,
          result: { draftId: "late" },
        }),
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    const unknown = await state.workIdempotency.get(input);
    assert.equal(unknown?.status, "unknown");
    assert.equal((await state.workIdempotency.begin(input)).outcome, "existing");
    const resolved = await state.workIdempotency.resolveUnknown({
      ...input,
      expectedVersion: unknown!.version,
      status: "failed_terminal",
      failure: { code: "RECONCILED", reference: "operator-case-1" },
    });
    assert.equal(resolved.status, "failed_terminal");
    await assert.rejects(
      () => state.workIdempotency.resolveUnknown({ ...input, expectedVersion: unknown!.version, status: "failed_terminal" }),
      (error: unknown) => error instanceof WorkToolError && error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );

    await pool.query(`UPDATE ${work} SET result = '[]'::jsonb WHERE idempotency_key = $1`, [input.key]);
    await assert.rejects(
      () => state.workIdempotency.get(input),
      (error: unknown) => error instanceof EnterprisePostgresError,
    );
  });

  it("claims before connector dispatch across replicas and replays only completed summaries", async () => {
    const schema = uniqueSchema();
    const first = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    let calls = 0;
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const runner = {
      async exec(argv: readonly string[]) {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        calls += 1;
        entered?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const makeSend = (idempotencyStore: typeof first.workIdempotency) => {
      const adapter = createMicrosoft365CliAdapter({
        binary: "/usr/bin/m365",
        identity: identity(),
        configDir: "/tmp/prism-enterprise-work-idempotency",
        runner,
      });
      return createWorkTools({
        microsoft365: adapter,
        idempotencyStore,
        approval: { isApproved: () => true },
        externalRecipients: { allow: () => true },
      }).find((tool) => tool.name === "m365_mail_draft_send")!;
    };
    const sendFirst = makeSend(first.workIdempotency);
    const sendSecond = makeSend(second.workIdempotency);
    const args = { to: "a@contoso.test", subject: "subject", bodyContents: "body", idempotencyKey: "connector-race" };

    const running = sendFirst.execute(args, context());
    await dispatched;
    await assert.rejects(async () => sendSecond.execute(args, context()), /not available for replay/);
    release?.();
    assert.equal(((await running).value as { status: string }).status, "executed");
    assert.equal(((await sendSecond.execute(args, context())).value as { status: string }).status, "duplicate");
    assert.equal(calls, 1);
  });
});
