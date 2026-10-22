import assert from "node:assert/strict";
import type { CheckpointStore, LeaseKey, LeaseStore, OwnershipScope } from "./contracts.js";
import { WorkflowCheckpointError } from "./errors.js";
import { WORKFLOW_CHECKPOINT_SCHEMA_VERSION, WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION } from "./limits.js";
import { CHECKPOINT_CONFLICT_CODE } from "./memory-checkpoints.js";
import { LEASE_CONFLICT_CODE } from "./memory-leases.js";
import type { WorkflowCheckpointAdapter, WorkflowCheckpointValue } from "./types.js";

export function sampleValue(overrides: Partial<WorkflowCheckpointValue> = {}): WorkflowCheckpointValue {
  const now = new Date().toISOString();
  return {
    schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
    workflowId: "wf",
    runId: "run1",
    definitionHash: "abc",
    status: "running",
    readyNodeIds: [],
    completedNodeIds: [],
    nodes: {
      a: {
        nodeId: "a",
        status: "succeeded",
        output: { ok: true },
        iteration: 1,
        iterations: [
          {
            schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
            iteration: 0,
            iterationId: "wf/run1/a/0",
            done: true,
            output: { ok: true },
          },
        ],
      },
    },
    createdAt: now,
    updatedAt: now,
    redacted: false,
    ...overrides,
  };
}

export async function runCheckpointAdapterConformance(
  label: string,
  create: () => WorkflowCheckpointAdapter | Promise<WorkflowCheckpointAdapter>,
): Promise<void> {
  const checkpoints = await create();

  await checkpoints.save({
    workflowId: "wf",
    runId: "run1",
    version: 1,
    ownership: { tenantId: "t1" },
    value: sampleValue(),
  });
  const loaded = await checkpoints.load({
    workflowId: "wf",
    runId: "run1",
    ownership: { tenantId: "t1" },
  });
  assert.equal(loaded?.version, 1, `${label}: version`);
  assert.equal(loaded?.value.status, "running", `${label}: status`);
  assert.deepEqual(loaded?.value.nodes.a?.output, { ok: true }, `${label}: output`);
  assert.deepEqual(loaded?.value.nodes.a?.iterations?.[0]?.output, { ok: true }, `${label}: iteration output`);

  await assert.rejects(
    () =>
      checkpoints.save({
        workflowId: "wf",
        runId: "run1",
        version: 1,
        ownership: { tenantId: "t1" },
        value: sampleValue(),
      }),
    WorkflowCheckpointError,
    `${label}: stale version`,
  );

  // Plan 080 Task 3: a foreign scope lands as a miss, never an ownership-shaped oracle,
  // and a foreign save fails closed as a generic CAS conflict.
  assert.equal(
    await checkpoints.load({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "other" },
    }),
    null,
    `${label}: tenant mismatch is a miss`,
  );
  await assert.rejects(
    () =>
      checkpoints.save({
        workflowId: "wf",
        runId: "run1",
        version: 2,
        ownership: { tenantId: "other" },
        value: sampleValue(),
      }),
    WorkflowCheckpointError,
    `${label}: foreign save must fail closed`,
  );

  if (checkpoints.list) {
    const page = await checkpoints.list({
      workflowId: "wf",
      ownership: { tenantId: "t1" },
      limit: 10,
    });
    assert.equal(page.items.length, 1, `${label}: list size`);
    const empty = await checkpoints.list({
      workflowId: "wf",
      ownership: { tenantId: "missing" },
      limit: 10,
    });
    assert.equal(empty.items.length, 0, `${label}: tenant list isolation`);
  }

  if (checkpoints.delete) {
    const deleted = await checkpoints.delete({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(deleted, true, `${label}: delete`);
    const after = await checkpoints.load({
      workflowId: "wf",
      runId: "run1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(after, null, `${label}: load after delete`);
  }
}

/**
 * Generic checkpoint-store conformance (plan 168 Task 3). Lifted from the kernel's CAS,
 * fencing, and ownership probes (`src/testing/state-concurrency-conformance.ts:170-290`)
 * and extended with create-only, pagination, and delete.
 *
 * ```ts
 * await checkpointConformance(() => createMemoryCheckpointStore());
 * ```
 */
export async function checkpointConformance(factory: () => CheckpointStore | Promise<CheckpointStore>): Promise<void> {
  const checkpoints = await factory();
  const scope: OwnershipScope = { tenantId: "conformance-tenant", accountId: "conformance-account", userId: "conformance-user" };
  const key = { namespace: "conformance", key: "cas", ...scope };

  // create
  const created = await checkpoints.saveCheckpoint({ ...key, version: 1, value: { step: 1 } });
  assert.equal(created.version, 1, "create must persist version 1");
  assert.equal((await checkpoints.loadCheckpoint(key))?.version, 1, "a created record must load");

  // CAS on expectedVersion (and create-only via expectedVersion 0)
  await checkpoints.saveCheckpoint({ ...key, version: 2, expectedVersion: 1, value: { step: 2 } });
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 3, expectedVersion: 1, value: { step: 3 } }),
    CHECKPOINT_CONFLICT_CODE,
    "a stale expectedVersion must be rejected",
  );
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 9, expectedVersion: 0, value: { step: 9 } }),
    CHECKPOINT_CONFLICT_CODE,
    "create-only on an existing key must be rejected",
  );

  // concurrent writers with the same expectedVersion admit exactly one terminal write
  const raceKey = { namespace: "conformance", key: "race", ...scope };
  await checkpoints.saveCheckpoint({ ...raceKey, version: 1, value: { status: "open" } });
  const race = await Promise.allSettled([
    checkpoints.saveCheckpoint({ ...raceKey, version: 2, expectedVersion: 1, fencingToken: 1, value: { winner: "a" } }),
    checkpoints.saveCheckpoint({ ...raceKey, version: 2, expectedVersion: 1, fencingToken: 1, value: { winner: "b" } }),
  ]);
  const fulfilled = race.filter((result) => result.status === "fulfilled");
  const rejected = race.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "concurrent writers must admit exactly one terminal write");
  assert.equal(rejected.length, 1, "concurrent writers must reject exactly one writer");
  assert.equal(
    ((rejected[0] as PromiseRejectedResult).reason as { code?: unknown })?.code,
    CHECKPOINT_CONFLICT_CODE,
    "the losing writer must fail with a checkpoint conflict",
  );
  const terminal = await checkpoints.loadCheckpoint(raceKey);
  assert.equal(terminal?.version, 2, "the terminal state must be written exactly once");
  assert.ok(
    ["a", "b"].includes((terminal?.value as { winner?: string })?.winner ?? ""),
    "the final state must be exactly one winner's payload, never a mix",
  );

  // fencing tokens: a lower fence cannot replace a fenced record; a higher fence wins
  await checkpoints.saveCheckpoint({ ...key, version: 3, expectedVersion: 2, fencingToken: 5, value: { step: 3 } });
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, version: 4, expectedVersion: 3, fencingToken: 4, value: { step: 4 } }),
    CHECKPOINT_CONFLICT_CODE,
    "a lower fence must be rejected",
  );
  const fenced = await checkpoints.saveCheckpoint({ ...key, version: 4, expectedVersion: 3, fencingToken: 6, value: { step: 4 } });
  assert.equal(fenced.fencingToken, 6, "a higher fence must win");
  const loaded = await checkpoints.loadCheckpoint(key);
  assert.equal(loaded?.version, 4, "the winning version must persist");
  assert.equal(loaded?.fencingToken, 6, "the winning fence must persist");

  // ownership isolation: a foreign read is a miss, a foreign write fails closed, the owner is intact
  assert.equal(
    await checkpoints.loadCheckpoint({ ...key, tenantId: "conformance-other" }),
    null,
    "a foreign checkpoint must land as a miss",
  );
  await assertRejectsCode(
    () => checkpoints.saveCheckpoint({ ...key, tenantId: "conformance-other", version: 99, expectedVersion: 0, value: { evil: true } }),
    CHECKPOINT_CONFLICT_CODE,
    "a foreign save must fail closed",
  );
  assert.equal((await checkpoints.loadCheckpoint(key))?.version, 4, "a foreign writer must not disturb the owner's record");

  // list pagination + ownership isolation
  for (let index = 0; index < 3; index++) {
    await checkpoints.saveCheckpoint({ namespace: "conformance", key: `page-${index}`, ...scope, version: 1, value: { index } });
  }
  const firstPage = await checkpoints.listCheckpoints({ namespace: "conformance", keyPrefix: "page-", ...scope, limit: 2 });
  assert.equal(firstPage.items.length, 2, "a bounded page must respect the limit");
  assert.ok(firstPage.nextCursor, "a bounded page must carry a cursor");
  const secondPage = await checkpoints.listCheckpoints({
    namespace: "conformance",
    keyPrefix: "page-",
    ...scope,
    limit: 2,
    cursor: firstPage.nextCursor,
  });
  assert.equal(secondPage.items.length, 1, "the next page must carry the remainder");
  const foreignPage = await checkpoints.listCheckpoints({ namespace: "conformance", ...scope, tenantId: "conformance-other" });
  assert.equal(foreignPage.items.length, 0, "ownership must never cross tenants");

  // delete + ownership isolation
  assert.equal(
    await checkpoints.deleteCheckpoint({ namespace: "conformance", key: "page-0", ...scope }),
    true,
    "delete must remove an owned record",
  );
  assert.equal(
    await checkpoints.loadCheckpoint({ namespace: "conformance", key: "page-0", ...scope }),
    null,
    "a deleted record must not load",
  );
  assert.equal(
    await checkpoints.deleteCheckpoint({ namespace: "conformance", key: "cas", ...scope, tenantId: "conformance-other" }),
    false,
    "a foreign delete must be a no-op",
  );
  assert.equal((await checkpoints.loadCheckpoint(key))?.version, 4, "a foreign delete must not remove the owner's record");
}

export interface LeaseConformanceOptions {
  /** Lease TTL. Expiry is waited on with a bounded poll, so this may be short. Default 100. */
  readonly ttlMs?: number;
}

/**
 * Generic lease-store conformance (plan 168 Task 3). New code written from the `LeaseStore`
 * contract and the router fencing pattern (`src/testing/state-concurrency-conformance.ts:366-413`).
 *
 * The memory store sweeps expired rows only at `EXPIRED_LEASE_SWEEP_AT` (1024), so an expired row
 * survives here and the fence advances. Durable stores keep expired rows for fencing.
 */
export async function leaseConformance(
  factory: () => LeaseStore | Promise<LeaseStore>,
  options: LeaseConformanceOptions = {},
): Promise<void> {
  const leases = await factory();
  const ttlMs = options.ttlMs ?? 100;
  const scope: OwnershipScope = { tenantId: "conformance-tenant", accountId: "conformance-account", userId: "conformance-user" };
  const key: LeaseKey = { namespace: "conformance", key: "lease", ...scope };

  // acquire
  const first = await leases.tryAcquireLease({ ...key, ownerId: "owner-a", ttlMs });
  assert.ok(first, "a free lease must be acquirable");
  assert.equal(first.ownerId, "owner-a", "the holder must be recorded");
  assert.ok(first.token, "an acquired lease must carry a token");
  assert.equal(first.fencingToken, 1, "the first acquisition must fence at 1");

  // a live lease is exclusive
  assert.equal(await leases.tryAcquireLease({ ...key, ownerId: "owner-b", ttlMs }), null, "a live lease must not be re-acquirable");
  assert.equal((await leases.getLease(key))?.ownerId, "owner-a", "the holder must be visible");

  // renew by the holder keeps the token and the fence
  const renewed = await leases.renewLease({ ...key, ownerId: "owner-a", token: first.token, ttlMs });
  assert.ok(renewed, "the holder must renew");
  assert.equal(renewed.token, first.token, "renew must keep the token");
  assert.equal(renewed.fencingToken, first.fencingToken, "renew must keep the fence");

  // a foreign owner can neither renew nor release, and a foreign read fails closed
  assert.equal(
    await leases.renewLease({ ...key, ownerId: "owner-b", token: first.token, ttlMs }),
    null,
    "a foreign renew must be rejected",
  );
  assert.equal(await leases.releaseLease({ ...key, ownerId: "owner-b", token: first.token }), false, "a foreign release must be rejected");
  await assertRejectsCode(
    () => leases.getLease({ ...key, tenantId: "conformance-other" }),
    LEASE_CONFLICT_CODE,
    "a foreign lease read must fail closed",
  );

  // release by the holder, then re-acquire: the fence advances across release
  assert.equal(await leases.releaseLease({ ...key, ownerId: "owner-a", token: first.token }), true, "the holder must release");
  assert.equal(await leases.getLease(key), null, "a released lease must not be visible");
  const second = await leases.tryAcquireLease({ ...key, ownerId: "owner-b", ttlMs });
  assert.ok(second, "a released lease must be re-acquirable");
  assert.equal(second.fencingToken, first.fencingToken + 1, "the fence must advance across release");

  // expiry, then re-acquire: the fence advances across expiry too
  await waitUntilExpired(leases, key);
  assert.equal(await leases.getLease(key), null, "an expired lease must not be visible");
  const third = await leases.tryAcquireLease({ ...key, ownerId: "owner-c", ttlMs });
  assert.ok(third, "an expired lease must be re-acquirable");
  assert.equal(third.fencingToken, second.fencingToken + 1, "the fence must advance across expiry");
}

async function waitUntilExpired(leases: LeaseStore, key: LeaseKey, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await leases.getLease(key)) === null) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("lease did not expire within the conformance window");
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
