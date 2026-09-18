// Plan 079 Task 3: executable evidence for the durable journal primitives (bindings, operation
// CAS, cursor ordering, reply staging, pairing) against the in-memory `CheckpointStore`.
// Run explicitly (nested-suite glob caveat in the Task 1 review):
//   node --test "packages/prism-core/dist/integrations/channels/__tests__/state.test.js"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CheckpointStore, createMemoryCheckpointStore, type OwnershipScope } from "@arnilo/prism";
import { createChannelDeliveryJournal } from "../delivery.js";
import { createChannelPairingStore } from "../pairing.js";
import { CHANNEL_JOURNAL_NAMESPACES, createChannelStateStore } from "../state.js";
import type { ChannelOperationRecord, ChannelReplyRecord } from "../types.js";

const CONNECTION = "tg-1";
const SCOPE: OwnershipScope = { tenantId: "tenant-1", accountId: "acct-1", userId: "user-1" };

function bindingInput(ownership: OwnershipScope = SCOPE) {
  return {
    ownership,
    connectionId: CONNECTION,
    externalConversationId: "chat-1",
    externalActorId: "user-1",
    agentAlias: "primary",
  };
}

function operationRecord(operationId: string, state: ChannelOperationRecord["state"] = "accepted"): ChannelOperationRecord {
  const now = new Date(0).toISOString();
  return {
    operationId,
    eventId: "42",
    kind: "message",
    connectionId: CONNECTION,
    externalConversationId: "chat-1",
    externalActorId: "user-1",
    agentAlias: "primary",
    state,
    replyStaged: false,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function replyRecord(operationId: string, state: ChannelReplyRecord["state"] = "pending"): ChannelReplyRecord {
  const now = new Date(0).toISOString();
  return {
    operationId,
    connectionId: CONNECTION,
    externalConversationId: "chat-1",
    kind: "final",
    text: "answer",
    state,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function stateStore(checkpoints: CheckpointStore = createMemoryCheckpointStore()) {
  return { checkpoints, store: createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 }) };
}

describe("plan 079 channel journal state", () => {
  it("creates a binding once and only advances it through CAS", async () => {
    const { checkpoints, store } = stateStore();
    const record = {
      sessionId: "chan-1",
      agentAlias: "primary",
      generation: 0,
      suspended: false,
      updatedAt: new Date(0).toISOString(),
    };
    const created = await store.createBinding(bindingInput(), record);
    assert.ok(created !== null);
    assert.equal(created.version, 1);

    // A second create for the same binding never overwrites (two workers racing).
    assert.equal(await store.createBinding(bindingInput(), { ...record, sessionId: "chan-2" }), null);

    // Stale version and stale fence both fail closed instead of overwriting.
    assert.equal(await store.saveBinding(bindingInput(), { ...record, leafId: "leaf-1" }, 0), null);
    const updated = await store.saveBinding(bindingInput(), { ...record, leafId: "leaf-1" }, created.version);
    assert.equal(updated?.version, 2);
    assert.equal(updated?.record.leafId, "leaf-1");

    // Restart: a new store object over the same checkpoints reads the same binding + version.
    const reopened = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 });
    const reloaded = await reopened.loadBinding(bindingInput());
    assert.equal(reloaded?.version, updated?.version);
    assert.equal(reloaded?.record.sessionId, "chan-1");
  });

  it("keeps tenant scopes separate and fails closed on a foreign ownership read", async () => {
    const { checkpoints, store } = stateStore();
    const record = {
      sessionId: "chan-1",
      agentAlias: "primary",
      generation: 0,
      suspended: false,
      updatedAt: new Date(0).toISOString(),
    };
    assert.ok((await store.createBinding(bindingInput(), record)) !== null);
    // Keys embed the scope, so another tenant misses instead of colliding.
    assert.equal(await store.loadBinding(bindingInput({ tenantId: "tenant-2" })), null);

    // The record key itself is scope-free inside the store, so the same raw key read under a
    // foreign scope lands as a miss (plan 080 Task 3) — no ownership-shaped existence oracle.
    const listed = await checkpoints.listCheckpoints({ namespace: CHANNEL_JOURNAL_NAMESPACES.binding, ...SCOPE });
    const rawKey = listed.items[0]?.key;
    assert.ok(rawKey !== undefined);
    assert.equal(
      await checkpoints.loadCheckpoint({ namespace: CHANNEL_JOURNAL_NAMESPACES.binding, key: rawKey, tenantId: "tenant-2" }),
      null,
    );
  });

  it("deduplicates operations by connection + event id and versions every transition", async () => {
    const { store } = stateStore();
    const key = { ownership: SCOPE, connectionId: CONNECTION, operationId: "chan-op-1" };
    const created = await store.createOperation(key, operationRecord("chan-op-1"));
    assert.ok(created !== null);
    assert.equal(created.record.state, "accepted");

    // Durable dedup: the same operation id can never be created twice.
    assert.equal(await store.createOperation(key, operationRecord("chan-op-1")), null);

    const executing = await store.saveOperation(key, { ...created.record, state: "executing", attempts: 1 }, created.version);
    assert.equal(executing?.version, 2);
    assert.equal(executing?.record.state, "executing");
    assert.equal(await store.saveOperation(key, { ...created.record, state: "succeeded" }, created.version), null);

    // A denial removes the record so a legitimate retry can be admitted again.
    assert.equal(await store.removeOperation(key), true);
    assert.equal(await store.loadOperation(key), null);
    assert.ok((await store.createOperation(key, operationRecord("chan-op-1"))) !== null);
  });

  it("advances the intake cursor only as evidence and rejects oversized records", async () => {
    const { store } = stateStore();
    const key = { ownership: SCOPE, connectionId: CONNECTION };
    await store.advanceCursor(key, "10");
    await store.advanceCursor(key, "11");
    const cursor = await store.loadCursor(key);
    assert.equal(cursor?.record.admitted, 2);
    assert.equal(cursor?.record.lastEventId, "11");

    const small = createChannelStateStore({ checkpoints: createMemoryCheckpointStore(), maxJournalRecordBytes: 1024 });
    await assert.rejects(
      () =>
        small.createBinding(bindingInput(), {
          sessionId: "chan-1",
          agentAlias: "primary",
          generation: 0,
          suspended: false,
          updatedAt: new Date(0).toISOString(),
          leafId: "x".repeat(4096),
        }),
      /maxJournalRecordBytes/,
    );
  });

  it("stages a reply once and never overwrites a settled one", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const journal = createChannelDeliveryJournal({ checkpoints, maxJournalRecordBytes: 4096 });
    const key = { ownership: SCOPE, connectionId: CONNECTION, operationId: "chan-op-1" };
    const staged = await journal.stage(key, replyRecord("chan-op-1"));
    assert.ok(staged !== null);
    assert.equal(staged.version, 1);
    assert.equal(await journal.stage(key, { ...replyRecord("chan-op-1"), text: "other" }), null);

    const delivered = await journal.mark(key, { ...staged.record, state: "delivered" }, staged.version);
    assert.equal(delivered?.record.state, "delivered");
    // A settled reply is read back unchanged for the reconcile decision.
    const loaded = await journal.load(key);
    assert.equal(loaded?.record.state, "delivered");
    assert.equal(loaded?.record.text, "answer");
  });

  it("stores pairing tokens as hashes and consumes them exactly once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const pairing = createChannelPairingStore({ checkpoints });
    const grant = await pairing.create({
      ...SCOPE,
      connectionId: CONNECTION,
      externalConversationId: "chat-1",
      externalActorId: "user-1",
      agentAlias: "primary",
      grantRevision: "rev-1",
    });
    assert.ok(grant.token.length > 20);

    // The durable record holds only the hash: the token is unrecoverable from storage.
    const listed = await checkpoints.listCheckpoints({ namespace: CHANNEL_JOURNAL_NAMESPACES.control, ...SCOPE });
    assert.equal(listed.items.length, 1);
    assert.ok(!JSON.stringify(listed.items[0]?.value).includes(grant.token));

    const consumed = await pairing.consume({ ...SCOPE, connectionId: CONNECTION, token: grant.token });
    assert.equal(consumed.status, "consumed");
    if (consumed.status === "consumed") assert.equal(consumed.target.grantRevision, "rev-1");

    // One-use: replay and unknown tokens fail closed.
    assert.equal((await pairing.consume({ ...SCOPE, connectionId: CONNECTION, token: grant.token })).status, "already_consumed");
    assert.equal((await pairing.consume({ ...SCOPE, connectionId: CONNECTION, token: "not-a-token" })).status, "invalid");
    assert.equal((await pairing.consume({ ...SCOPE, connectionId: "tg-2", token: grant.token })).status, "invalid");

    // Expiry is checked before the CAS, so an expired token never binds.
    const shortLived = await pairing.create({
      ...SCOPE,
      connectionId: CONNECTION,
      externalConversationId: "chat-2",
      externalActorId: "user-1",
      agentAlias: "primary",
      grantRevision: "rev-1",
      ttlMs: 1000,
    });
    const expired = await pairing.consume({
      ...SCOPE,
      connectionId: CONNECTION,
      token: shortLived.token,
      now: new Date(Date.parse(shortLived.expiresAt) + 1).toISOString(),
    });
    assert.equal(expired.status, "expired");
  });
});
