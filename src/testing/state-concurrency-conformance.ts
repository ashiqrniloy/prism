// ponytail: runner-free multi-process state-concurrency probe for memory and
// durable stores (plan 022 Task 4). Deterministic barriers only: every probe
// awaits the conflicting op and then asserts state — never setTimeout/sleeps.

import assert from "node:assert/strict";
import type {
  AgentEventRecord,
  AgentEventSource,
  AgentIdentity,
  CheckpointStore,
  ProductionPersistenceStore,
  SessionRecord,
} from "../contracts.js";
import { isSessionMetadataConflict } from "../contracts-core.js";

/**
 * Narrow router-state seam (structurally satisfied by
 * `@arnilo/prism-model-router`'s `ModelRouterStateStore`). Core stays
 * dependency-free; adapter packages pass their real stores.
 */
export interface StateConcurrencyRouterKey {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
  readonly provider: string;
  readonly model: string;
}

export interface StateConcurrencyRouterStore {
  reserveBudget(input: {
    readonly key: StateConcurrencyRouterKey;
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly maxTokens?: number;
    readonly maxCostUsd?: number;
    readonly windowMs: number;
    readonly reservationTtlMs: number;
    readonly now: number;
    readonly maxBudgetKeys?: number;
  }): Promise<{
    readonly admitted: boolean;
    readonly reservationId?: string;
    readonly fencingToken?: string;
    readonly retryAfterMs?: number;
  }>;
  commitBudget(input: {
    readonly key: StateConcurrencyRouterKey;
    readonly reservationId: string;
    readonly fencingToken: string;
    readonly tokens?: number;
    readonly costUsd?: number;
    readonly windowMs: number;
    readonly now: number;
  }): Promise<{ readonly unknownUsage: boolean }>;
  releaseBudget(input: {
    readonly key: StateConcurrencyRouterKey;
    readonly reservationId: string;
    readonly fencingToken: string;
    readonly windowMs: number;
    readonly now: number;
  }): Promise<void>;
  readBudget(input: {
    readonly key: StateConcurrencyRouterKey;
    readonly windowMs: number;
    readonly now: number;
  }): Promise<{ readonly tokens: number; readonly costUsd: number }>;
}

export interface StateConcurrencyRouterFactory {
  readonly create: () => StateConcurrencyRouterStore | Promise<StateConcurrencyRouterStore>;
  /**
   * True when the store derives reservation expiry from the caller-supplied
   * `now` (in-memory stores). Durable stores compute expiry from their own
   * clock (`clock_timestamp()`), so the deterministic unknown-outcome probe
   * only runs when this is set; the durable leg is exercised by the Task 1
   * enterprise-conformance integration probe (real 1ms TTL, `test:postgres`).
   */
  readonly nowInjected?: boolean;
}

/** Narrow idempotency seam (structurally satisfied by `@arnilo/prism-work-tools`'s `IdempotencyStore`). */
export interface StateConcurrencyIdempotencyStore {
  get(input: StateConcurrencyIdempotencyKey): Promise<StateConcurrencyIdempotencyRecord | undefined>;
  begin(input: StateConcurrencyIdempotencyKey): Promise<{
    readonly outcome: "acquired" | "existing";
    readonly record: StateConcurrencyIdempotencyRecord;
  }>;
  complete(
    input: StateConcurrencyIdempotencyKey & {
      readonly claimToken: string;
      readonly expectedVersion: number;
      readonly result: { readonly draftId: string; readonly resourceId?: string };
    },
  ): Promise<StateConcurrencyIdempotencyRecord>;
}

export interface StateConcurrencyIdempotencyKey {
  readonly identity: AgentIdentity;
  readonly key: string;
  readonly op: string;
  readonly signal?: AbortSignal;
}

export interface StateConcurrencyIdempotencyRecord {
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
  readonly key: string;
  readonly op: string;
  readonly status: "in_progress" | "completed" | "failed_retryable" | "failed_terminal" | "unknown";
  readonly attempt: number;
  readonly version: number;
  readonly claimToken?: string;
  readonly result?: { readonly draftId: string; readonly resourceId?: string };
  readonly failure?: { readonly code: string; readonly reference?: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export type StateConcurrencyEventSource = AgentEventSource & { readonly close?: () => void | Promise<void> };

export interface StateConcurrencyEventSourceFactory {
  readonly create: () => StateConcurrencyEventSource | Promise<StateConcurrencyEventSource>;
  /**
   * True when the factory can re-open against the same backend (durable
   * stores). Memory stores are process-local; their probe covers cursor
   * resume on the same instance and durable factories additionally re-open.
   */
  readonly reopenable?: boolean;
}

export interface StateConcurrencyFactories {
  /** Checkpoint seam: approval-determinism and checkpoint-CAS probes. */
  readonly checkpoints?: () => CheckpointStore | Promise<CheckpointStore>;
  /** Durable event seam: replay-cursor resume probe (memory and NATS/Postgres). */
  readonly events?: StateConcurrencyEventSourceFactory;
  /** Session-record seam: conversation metadata CAS probe (appendSession). */
  readonly sessions?: () => ProductionPersistenceStore | Promise<ProductionPersistenceStore>;
  /** Work idempotency seam: retry-same-key probe. */
  readonly idempotency?: () => StateConcurrencyIdempotencyStore | Promise<StateConcurrencyIdempotencyStore>;
  /** Router budget reservation seam: oversubscription + unknown-outcome probes. */
  readonly routerState?: StateConcurrencyRouterFactory;
}

/**
 * Run the state-concurrency probes for every provided store family. Returns
 * the executed probe names so gates can assert coverage. Deterministic:
 * concurrent ops are awaited through `Promise.allSettled` and state is
 * asserted afterward; no timing-only sleeps anywhere in this file.
 */
export async function assertStateConcurrencyConforms(factories: StateConcurrencyFactories): Promise<readonly string[]> {
  const executed: string[] = [];
  if (factories.checkpoints) {
    const checkpoints = await factories.checkpoints();
    await checkpointCasProbe(checkpoints);
    executed.push("checkpoint-cas");
    await approvalDeterminismProbe(checkpoints);
    executed.push("approval-determinism");
  }
  if (factories.events) {
    await cursorResumeProbe(factories.events);
    executed.push("cursor-resume");
  }
  if (factories.sessions) {
    await conversationMetadataCasProbe(await factories.sessions());
    executed.push("conversation-metadata-cas");
  }
  if (factories.idempotency) {
    await idempotencyRetryProbe(await factories.idempotency());
    executed.push("idempotency-retry");
  }
  if (factories.routerState) {
    await reservationOversubscriptionProbe(await factories.routerState.create());
    executed.push("router-reservation");
    if (factories.routerState.nowInjected) {
      await unknownOutcomeProbe(await factories.routerState.create());
      executed.push("unknown-outcome");
    }
  }
  return executed;
}

const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };

function identity(tenantId: string): AgentIdentity {
  return {
    tenantId,
    userId: "user-a",
    principal: { kind: "agent", id: "agent-a" },
    scopes: ["work:mutate"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

/**
 * Checkpoint CAS: exact-version and fencing-token guards. A stale
 * `expectedVersion` is rejected; a lower `fencingToken` cannot replace a
 * fenced record; a higher fence wins.
 */
async function checkpointCasProbe(checkpoints: CheckpointStore): Promise<void> {
  const key = { namespace: "state-concurrency", key: "checkpoint-cas", ...ownership };
  await checkpoints.saveCheckpoint({ ...key, version: 1, value: { step: 1 } });
  await checkpoints.saveCheckpoint({ ...key, version: 2, expectedVersion: 1, value: { step: 2 } });
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 3, expectedVersion: 1, value: { step: 3 } }),
    "ERR_PRISM_CHECKPOINT_CONFLICT",
    "stale expectedVersion must be rejected",
  );
  await checkpoints.saveCheckpoint({ ...key, version: 3, expectedVersion: 2, fencingToken: 5, value: { step: 3 } });
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 4, expectedVersion: 3, fencingToken: 4, value: { step: 4 } }),
    "ERR_PRISM_CHECKPOINT_CONFLICT",
    "lower fence must be rejected",
  );
  const fenced = await checkpoints.saveCheckpoint({ ...key, version: 4, expectedVersion: 3, fencingToken: 6, value: { step: 4 } });
  assert.equal(fenced.fencingToken, 6, "higher fence must win");
  const loaded = await checkpoints.loadCheckpoint(key);
  assert.equal(loaded?.version, 4, "winning version must persist");
  assert.equal(loaded?.fencingToken, 6, "winning fence must persist");
  await assertRejects(
    () => checkpoints.loadCheckpoint({ ...key, tenantId: "tenant-b" }),
    /ownership|tenant/i,
    "foreign checkpoint access must fail closed",
  );
}

/**
 * Approval determinism: concurrent approve/deny of the same pending decision
 * resolves to exactly one terminal state; a stale decision discriminant
 * (the `expectedVersion` a resumer read) is rejected — the 0.2.0 resume fix
 * contract: resume requires `record.version === expectedVersion`.
 */
async function approvalDeterminismProbe(checkpoints: CheckpointStore): Promise<void> {
  const key = { namespace: "state-concurrency", key: "approval", ...ownership };
  const suspended = {
    status: "suspended",
    interruption: {
      kind: "tool_approval",
      reason: "review",
      pendingDecisions: [{ approvalId: "a1", kind: "tool_approval", scope: { toolName: "fs.write", argumentsHash: "h1" } }],
    },
  };
  await checkpoints.saveCheckpoint({ ...key, version: 1, value: suspended });
  const approve = { status: "running", decision: { approvalId: "a1", outcome: "allow_once" } };
  const deny = { status: "denied", decision: { approvalId: "a1", outcome: "reject_once" } };
  const results = await Promise.allSettled([
    checkpoints.saveCheckpoint({ ...key, version: 2, expectedVersion: 1, fencingToken: 1, value: approve }),
    checkpoints.saveCheckpoint({ ...key, version: 2, expectedVersion: 1, fencingToken: 1, value: deny }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "concurrent approve/deny must admit exactly one terminal write");
  assert.equal(rejected.length, 1, "concurrent approve/deny must reject exactly one writer");
  assert.equal(
    ((rejected[0] as PromiseRejectedResult).reason as { code?: unknown })?.code,
    "ERR_PRISM_CHECKPOINT_CONFLICT",
    "loser must fail with checkpoint conflict",
  );
  const final = await checkpoints.loadCheckpoint(key);
  assert.equal(final?.version, 2, "terminal state must be written exactly once");
  assert.ok(
    deepEqual(final?.value, approve) || deepEqual(final?.value, deny),
    "final state must be exactly one winner's payload, never a mix",
  );
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 3, expectedVersion: 1, value: { status: "running" } }),
    "ERR_PRISM_CHECKPOINT_CONFLICT",
    "a stale decision discriminant (version read before the race) must be rejected",
  );
}

/**
 * Replay-cursor resume: a cursor taken from the last consumed position resumes
 * at the next event, never the stream head. Durable factories additionally
 * close and re-open the store (restart) and resume from the same cursor.
 */
async function cursorResumeProbe(factory: StateConcurrencyEventSourceFactory): Promise<void> {
  const input = { ownership, sessionId: "concurrency-session", runId: "concurrency-run" };
  const source = await factory.create();
  await source.append(event("event-1", "agent_started", input));
  await source.append(event("event-2", "turn_started", input, "2026-01-01T00:00:01.000Z"));
  await source.append(event("event-3", "agent_finished", input, "2026-01-01T00:00:02.000Z"));
  const first = await source.page({ ...input, limit: 1 });
  assert.equal(first.items[0]?.record.id, "event-1", "first page must start at the head");
  const second = await source.page({ ...input, after: first.items[0]!.cursor, limit: 1 });
  assert.equal(second.items[0]?.record.id, "event-2", "second page must continue after the first cursor");
  const resumed = await source.page({ ...input, after: second.items[0]!.cursor, limit: 10 });
  assert.deepEqual(
    resumed.items.map((envelope) => envelope.record.id),
    ["event-3"],
    "resume from the last-acked cursor must not replay the head",
  );
  assert.equal(resumed.terminal, true, "resumed page must reach the terminal event");
  const foreign = await source.page({ ...input, ownership: { ...ownership, tenantId: "tenant-b" }, limit: 10 });
  assert.equal(foreign.items.length, 0, "ownership must never cross tenants");
  if (factory.reopenable) {
    await source.close?.();
    const restarted = await factory.create();
    const afterRestart = await restarted.page({ ...input, after: second.items[0]!.cursor, limit: 10 });
    assert.deepEqual(
      afterRestart.items.map((envelope) => envelope.record.id),
      ["event-3"],
      "reopened store must resume from the last-acked cursor, not the head",
    );
    assert.equal(afterRestart.terminal, true, "reopened page must reach the terminal event");
    await restarted.close?.();
  }
}

/** Idempotency: a retry with the same key returns the recorded outcome, never a duplicate effect. */
async function idempotencyRetryProbe(idempotency: StateConcurrencyIdempotencyStore): Promise<void> {
  const mutation = { identity: identity("tenant-a"), key: "idem-1", op: "example.mutate" };
  const parallel = await Promise.all(Array.from({ length: 8 }, () => idempotency.begin(mutation)));
  const acquired = parallel.filter((result) => result.outcome === "acquired");
  const existing = parallel.filter((result) => result.outcome === "existing");
  assert.equal(acquired.length, 1, "parallel begins must admit exactly one claim");
  assert.equal(existing.length, 7, "parallel begins must report the rest as existing");
  const claim = acquired[0]!.record;
  assert.ok(claim.claimToken, "acquired claim must carry a token");
  const completed = await idempotency.complete({
    ...mutation,
    claimToken: claim.claimToken!,
    expectedVersion: claim.version,
    result: { draftId: "draft-1" },
  });
  assert.equal(completed.status, "completed", "completed mutation must be terminal");
  const retry = await idempotency.begin(mutation);
  assert.equal(retry.outcome, "existing", "retry must never re-acquire");
  assert.equal(retry.record.result?.draftId, "draft-1", "retry must return the recorded outcome, not a duplicate effect");
  assert.equal(await idempotency.get({ ...mutation, identity: identity("tenant-b") }), undefined, "ownership must never cross tenants");
  await assertRejectsCode(
    () =>
      idempotency.complete({
        ...mutation,
        claimToken: claim.claimToken!,
        expectedVersion: claim.version,
        result: { draftId: "draft-2" },
      }),
    "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    "a stale-version second complete must be rejected",
  );
}

/** Router reservation: parallel admissions cannot oversubscribe; commit/release reconcile actuals. */
async function reservationOversubscriptionProbe(router: StateConcurrencyRouterStore): Promise<void> {
  const key: StateConcurrencyRouterKey = {
    tenantId: "tenant-a",
    accountId: "account-a",
    userId: "user-a",
    principalId: "principal-a",
    provider: "benchmark",
    model: "reserved",
  };
  const parallel = await Promise.all(
    Array.from({ length: 4 }, () =>
      router.reserveBudget({ key, tokens: 26, maxTokens: 100, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 }),
    ),
  );
  const admitted = parallel.filter((result) => result.admitted);
  const denied = parallel.filter((result) => !result.admitted);
  assert.equal(admitted.length, 3, "parallel reservations must admit exactly N-1");
  assert.equal(denied.length, 1, "parallel reservations must deny exactly one");
  assert.ok(denied[0]!.retryAfterMs !== undefined, "denial must carry a retry-after hint");
  await assertRejectsCode(
    () =>
      router.commitBudget({
        key,
        reservationId: admitted[2]!.reservationId!,
        fencingToken: "stale",
        tokens: 1,
        windowMs: 60_000,
        now: 1_000,
      }),
    "ERR_PRISM_MODEL_ROUTER_STATE",
    "a stale/foreign fencing token must be rejected",
  );
  const committed = await router.commitBudget({
    key,
    reservationId: admitted[0]!.reservationId!,
    fencingToken: admitted[0]!.fencingToken!,
    tokens: 10,
    windowMs: 60_000,
    now: 1_000,
  });
  assert.equal(committed.unknownUsage, false, "live commit must not report unknown usage");
  await router.releaseBudget({
    key,
    reservationId: admitted[1]!.reservationId!,
    fencingToken: admitted[1]!.fencingToken!,
    windowMs: 60_000,
    now: 1_000,
  });
  assert.deepEqual(await router.readBudget({ key, windowMs: 60_000, now: 1_000 }), {
    tokens: 10,
    costUsd: 0,
  });
}

/**
 * Unknown-outcome recovery: an abandoned reservation (crash before commit)
 * reconciles to the reserved amount with `unknownUsage: true` — never a
 * silent drop. Deterministic: expiry is driven through the injected `now`
 * (memory stores); the durable leg runs in the Task 1 enterprise-conformance
 * integration probe because durable expiry uses the database clock. The
 * redacted `unknown_usage` diagnostic emission is asserted at router level in
 * the model-router suite (Task 1) — the store seam reports the flag only.
 */
async function unknownOutcomeProbe(router: StateConcurrencyRouterStore): Promise<void> {
  const key: StateConcurrencyRouterKey = {
    tenantId: "tenant-a",
    accountId: "account-a",
    userId: "user-a",
    principalId: "principal-a",
    provider: "benchmark",
    model: "ttl",
  };
  const reserved = await router.reserveBudget({ key, tokens: 7, maxTokens: 100, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 });
  assert.ok(reserved.admitted, "reservation must admit within capacity");
  const late = await router.commitBudget({
    key,
    reservationId: reserved.reservationId!,
    fencingToken: reserved.fencingToken!,
    tokens: 1,
    windowMs: 60_000,
    now: 61_001,
  });
  assert.equal(late.unknownUsage, true, "a late commit after expiry must reconcile as unknown usage");
  assert.deepEqual(await router.readBudget({ key, windowMs: 60_000, now: 61_001 }), {
    tokens: 7,
    costUsd: 0,
  });
}

/**
 * Conversation metadata CAS: concurrent create/branch/archive-style writes
 * admit exactly one winner per version and reject the rest with
 * `metadata_conflict`; a deleted row is never resurrected; ownership guards
 * hold inside the same guarded write.
 */
async function conversationMetadataCasProbe(sessions: ProductionPersistenceStore): Promise<void> {
  if (!sessions.appendSession) throw new Error("state-concurrency sessions probe requires appendSession");
  const base: SessionRecord = {
    id: "conversation-1",
    tenantId: "tenant-a",
    accountId: "account-a",
    userId: "user-a",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    metadata: { prismConversation: { state: "active", title: "root" } },
  };
  const created = await sessions.appendSession({ ...base, expectedVersion: 0 });
  assert.equal(created?.version, 1, "create-only write must land at version 1");
  const creates = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      sessions.appendSession!({
        ...base,
        expectedVersion: 0,
        metadata: { prismConversation: { state: "active", title: `racer-${index}` } },
      }),
    ),
  );
  const createWinners = creates.filter((result) => result.status === "fulfilled");
  const createLosers = creates.filter((result) => result.status === "rejected");
  assert.equal(createWinners.length, 0, "duplicate create-only writes must never overwrite the winner");
  assert.equal(createLosers.length, 8, "every duplicate create must conflict");
  for (const result of createLosers) {
    assert.ok(isSessionMetadataConflict((result as PromiseRejectedResult).reason), "duplicate create must be metadata_conflict");
  }
  const racerMetadata = (index: number) => ({
    prismConversation: {
      state: "active",
      title: `branch-${index}`,
      refs: [{ leafId: `leaf-${index}`, createdAt: "2026-08-03T00:00:01.000Z" }],
    },
  });
  const updates = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) => sessions.appendSession!({ ...base, expectedVersion: 1, metadata: racerMetadata(index) })),
  );
  const updateWinners = updates.filter((result) => result.status === "fulfilled");
  const updateLosers = updates.filter((result) => result.status === "rejected");
  assert.equal(updateWinners.length, 1, "concurrent CAS updates must admit exactly one winner");
  assert.equal(updateLosers.length, 7, "concurrent CAS updates must reject the rest");
  const winnerVersion = (updateWinners[0] as PromiseFulfilledResult<{ readonly version: number } | void>).value?.version;
  assert.equal(winnerVersion, 2, "winner must land at version 2");
  for (const result of updateLosers) {
    const reason = (result as PromiseRejectedResult).reason;
    assert.ok(isSessionMetadataConflict(reason), "CAS loser must be metadata_conflict");
    assert.equal(reason.conflict?.currentVersion, 2, "conflict must report the current version");
  }
  const winnerIndex = updates.findIndex((result) => result.status === "fulfilled");
  const page = await sessions.querySessions({ id: base.id, tenantId: "tenant-a", accountId: "account-a", userId: "user-a" });
  assert.equal(page.items.length, 1, "session must resolve to a single record");
  assert.equal(page.items[0]?.version, 2, "stored version must reflect the winner's write");
  assert.deepEqual(page.items[0]?.metadata, racerMetadata(winnerIndex), "stored metadata must be exactly the winner's marker");
  await assertRejectsCode(
    () =>
      sessions.appendSession!({
        ...base,
        tenantId: "tenant-b",
        expectedVersion: 1,
        metadata: { prismConversation: { state: "archived" } },
      }),
    "metadata_conflict",
    "cross-ownership CAS write must be rejected in the same guarded statement",
  );
}

function event(
  id: string,
  type: "agent_started" | "agent_finished" | "turn_started",
  input: {
    readonly ownership: { readonly tenantId: string; readonly accountId: string; readonly userId: string };
    readonly sessionId: string;
    readonly runId: string;
  },
  timestamp = "2026-01-01T00:00:00.000Z",
): AgentEventRecord {
  const payload =
    type === "turn_started"
      ? { type, sessionId: input.sessionId, runId: input.runId, turn: 1 }
      : { type, sessionId: input.sessionId, runId: input.runId };
  return { id, ...input.ownership, sessionId: input.sessionId, runId: input.runId, type, timestamp, event: payload, redacted: true };
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== "object" || typeof expected !== "object" || actual === null || expected === null) return false;
  const actualEntries = Object.entries(actual as Record<string, unknown>);
  const expectedEntries = Object.entries(expected as Record<string, unknown>);
  if (actualEntries.length !== expectedEntries.length) return false;
  for (const [key, value] of expectedEntries) {
    if (!deepEqual((actual as Record<string, unknown>)[key], value)) return false;
  }
  return true;
}

async function assertRejectsCode(action: () => Promise<unknown>, code: string, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if ((error as { code?: unknown })?.code === code) return;
    throw new Error(`${message}; expected code ${code}, received ${String((error as { code?: unknown })?.code)}: ${String(error)}`);
  }
  throw new Error(`${message}; expected a rejection with code ${code}`);
}

async function assertRejects(action: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (pattern.test(String(error))) return;
    throw new Error(`${message}; rejection did not match ${pattern}: ${String(error)}`);
  }
  throw new Error(`${message}; expected a rejection matching ${pattern}`);
}
