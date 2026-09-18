// Plan 079 Task 3: the channel journal legs of the state-concurrency conformance story against
// real durable stores. SQLite (better-sqlite3) runs when the optional driver is installed;
// PostgreSQL runs only under `test:postgres` (skips without PRISM_TEST_POSTGRES_URL).
//   node --test "packages/prism-channels/dist/__tests__/postgres.integration.test.js"
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { CheckpointStore, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { createChannelDeliveryJournal } from "../delivery.js";
import { createChannelStateStore, UNRESOLVED_OPERATION_STATES } from "../state.js";
import type { ChannelOperationRecord, ChannelReplyRecord } from "../types.js";

const CONNECTION = "tg-durable";
const SCOPE: OwnershipScope = { tenantId: "tenant-1", accountId: "acct-1", userId: "user-1" };
const operationKey = { ownership: SCOPE, connectionId: CONNECTION, operationId: "chan-op-durable-1" };
const replyKey = { ownership: SCOPE, connectionId: CONNECTION, operationId: "chan-op-durable-1" };

interface DurableLeg {
  readonly label: string;
  readonly checkpoints: CheckpointStore;
  readonly leases: LeaseStore;
  /** A fresh instance over the same durable state, standing in for a process restart. */
  readonly reopen: () => Promise<{ checkpoints: CheckpointStore; leases: LeaseStore }>;
}

function operatorRecord(state: ChannelOperationRecord["state"]): ChannelOperationRecord {
  const now = new Date().toISOString();
  return {
    operationId: "chan-op-durable-1",
    eventId: "501",
    kind: "message",
    connectionId: CONNECTION,
    externalConversationId: "chat-durable",
    externalActorId: "user-1",
    agentAlias: "primary",
    sessionId: "chan-session-durable",
    state,
    replyStaged: false,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function replyValue(state: ChannelReplyRecord["state"]): ChannelReplyRecord {
  const now = new Date().toISOString();
  return {
    operationId: "chan-op-durable-1",
    connectionId: CONNECTION,
    externalConversationId: "chat-durable",
    kind: "final",
    text: "durable answer",
    state,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Shared conformance body: the same journal transactions must behave identically per store. */
async function assertJournalConforms(leg: DurableLeg): Promise<void> {
  const state = createChannelStateStore({ checkpoints: leg.checkpoints, maxJournalRecordBytes: 64 * 1024 });
  const replies = createChannelDeliveryJournal({ checkpoints: leg.checkpoints, maxJournalRecordBytes: 64 * 1024 });
  const binding = {
    ownership: SCOPE,
    connectionId: CONNECTION,
    externalConversationId: "chat-durable",
    externalActorId: "user-1",
    agentAlias: "primary",
  };
  const bindingValue = {
    sessionId: "chan-session-durable",
    agentAlias: "primary",
    generation: 0,
    suspended: false,
    updatedAt: new Date().toISOString(),
  };

  // Create-once + CAS update, then reopen and read the same binding version.
  const created = await state.createBinding(binding, bindingValue);
  assert.ok(created !== null, `${leg.label}: binding created`);
  assert.equal(await state.createBinding(binding, { ...bindingValue, sessionId: "other" }), null, `${leg.label}: create-once`);
  assert.equal(
    await state.saveBinding(binding, { ...bindingValue, generation: 1, leafId: "leaf-1" }, 0),
    null,
    `${leg.label}: stale CAS rejected`,
  );
  const updated = await state.saveBinding(binding, { ...bindingValue, generation: 1, leafId: "leaf-1" }, created.version);
  assert.equal(updated?.record.leafId, "leaf-1", `${leg.label}: CAS update applied`);

  // Another ownership scope misses instead of colliding (keys embed the scope).
  assert.equal(await state.loadBinding({ ...binding, ownership: { tenantId: "tenant-2" } }), null, `${leg.label}: foreign scope misses`);

  // Operation dedup + claim CAS.
  const operation = await state.createOperation(operationKey, operatorRecord("accepted"));
  assert.ok(operation !== null, `${leg.label}: operation created`);
  assert.equal(await state.createOperation(operationKey, operatorRecord("accepted")), null, `${leg.label}: dedup by key`);
  const claimed = await state.saveOperation(operationKey, operatorRecord("executing"), operation.version);
  assert.equal(claimed?.record.state, "executing", `${leg.label}: claim CAS applied`);
  assert.equal(
    await state.saveOperation(operationKey, operatorRecord("succeeded"), operation.version),
    null,
    `${leg.label}: double claim rejected`,
  );

  // Reply staged before send, marked after; the settled state survives the reopen.
  const staged = await replies.mark(replyKey, replyValue("pending"), 0);
  assert.ok(staged !== null, `${leg.label}: reply staged`);
  assert.equal(await replies.mark(replyKey, replyValue("pending"), 0), null, `${leg.label}: stage-once`);
  const delivered = await replies.mark(replyKey, replyValue("delivered"), staged.version);
  assert.equal(delivered?.record.state, "delivered", `${leg.label}: reply marked delivered`);

  // Lease fencing: one holder per binding, monotonic tokens.
  const leaseKey = { namespace: "prism.channels.v1.binding", key: `durable:${CONNECTION}`, ...SCOPE };
  const first = await leg.leases.tryAcquireLease({ ...leaseKey, ownerId: "worker-a", ttlMs: 30_000 });
  assert.ok(first !== null, `${leg.label}: lease acquired`);
  assert.equal(
    await leg.leases.tryAcquireLease({ ...leaseKey, ownerId: "worker-b", ttlMs: 30_000 }),
    null,
    `${leg.label}: second holder deferred`,
  );

  // Reopen: a new instance over the same durable state sees the same records and versions.
  const restarted = await leg.reopen();
  const restartedState = createChannelStateStore({ checkpoints: restarted.checkpoints, maxJournalRecordBytes: 64 * 1024 });
  const restartedReplies = createChannelDeliveryJournal({
    checkpoints: restarted.checkpoints,
    maxJournalRecordBytes: 64 * 1024,
  });
  const rebound = await restartedState.loadBinding(binding);
  assert.equal(rebound?.version, updated?.version, `${leg.label}: binding version survives the reopen`);
  assert.equal(rebound?.record.generation, 1, `${leg.label}: generation survives the reopen`);
  const rereadOperation = await restartedState.loadOperation(operationKey);
  assert.equal(rereadOperation?.record.state, "executing", `${leg.label}: claimed operation survives as executing`);
  assert.ok(
    UNRESOLVED_OPERATION_STATES.includes(rereadOperation?.record.state ?? "succeeded"),
    `${leg.label}: a claimed operation is reported as open work`,
  );
  assert.equal((await restartedReplies.load(replyKey))?.record.state, "delivered", `${leg.label}: settled reply survives`);
  assert.equal((await restarted.leases.getLease(leaseKey))?.ownerId, "worker-a", `${leg.label}: the lease survives and keeps its holder`);
}

describe("plan 079 channel journal against SQLite", () => {
  const dirs: string[] = [];
  after(() => {
    while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
  });

  it("passes the durable journal conformance probes against a reopened SQLite database", async (t) => {
    let createSqlitePersistence: typeof import("@arnilo/prism-core/sessions/sqlite").createSqlitePersistence;
    try {
      ({ createSqlitePersistence } = await import("@arnilo/prism-core/sessions/sqlite"));
    } catch {
      t.skip("better-sqlite3 is not installed");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "prism-channel-journal-"));
    dirs.push(dir);
    const filename = join(dir, "channels.sqlite");
    const opened = [createSqlitePersistence({ filename })];
    try {
      const current = opened[0];
      assert.ok(current !== undefined);
      await assertJournalConforms({
        label: "sqlite",
        checkpoints: current.checkpoints,
        leases: current.leases,
        reopen: async () => {
          const next = createSqlitePersistence({ filename });
          opened.push(next);
          return { checkpoints: next.checkpoints, leases: next.leases };
        },
      });
    } finally {
      for (const store of opened) store.close();
    }
  });
});

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describePostgres = postgresUrl === undefined ? describe.skip : describe;

describePostgres("plan 079 channel journal against PostgreSQL", () => {
  it("passes the durable journal conformance probes against a real database", async () => {
    const { Pool } = await import("pg");
    const { createPostgresPersistence } = await import("@arnilo/prism-core/sessions/postgres");
    const schema = `prism_channels_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({ connectionString: postgresUrl, max: 4 });
    const open = () =>
      createPostgresPersistence({
        pool,
        schema,
        eventCursorSecret: "channel-journal-cursor-secret",
        eventSource: { pollIntervalMs: 30_000 },
      });
    const opened = [await open()];
    try {
      const current = opened[0];
      assert.ok(current !== undefined);
      await assertJournalConforms({
        label: "postgres",
        checkpoints: current.checkpoints,
        leases: current.leases,
        reopen: async () => {
          const next = await open();
          opened.push(next);
          return { checkpoints: next.checkpoints, leases: next.leases };
        },
      });
    } finally {
      for (const store of opened) await store.close();
      await pool.end();
    }
  });
});
