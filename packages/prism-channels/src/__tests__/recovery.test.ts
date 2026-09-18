// Plan 079 Task 3: executable evidence for restart safety — durable bindings and `/new`
// generations, operation dedup across processes, the CAS claim before provider work, staged
// replies that survive a crash, authorized reconciliation, lease fencing and retention.
// Run explicitly (nested-suite glob caveat in the Task 1 review):
//   node --test "packages/prism-core/dist/integrations/channels/__tests__/recovery.test.js"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Agent,
  type AgentIdentity,
  type AIProvider,
  createAgent,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  type OwnershipScope,
  ownershipFromIdentity,
  providerDone,
  providerTextDelta,
  type SessionStore,
} from "@arnilo/prism";
import { createChannelDeliveryJournal } from "../delivery.js";
import { createMessagingRuntime } from "../index.js";
import { createChannelStateStore } from "../state.js";
import type {
  ChannelAuthorization,
  ChannelInboundEvent,
  ChannelReply,
  ChannelSendResult,
  ChannelUnresolvedOperation,
  MessagingRuntime,
  MessagingRuntimeOptions,
} from "../types.js";

const CONNECTION = "tg-1";
const CHAT = "chat-1";
const ACTOR = "user-1";

function identity(userId = "user-1", tenantId = "tenant-1"): AgentIdentity {
  return {
    tenantId,
    userId,
    principal: { kind: "user", id: userId },
    scopes: ["chat"],
    issuedAt: new Date(0).toISOString(),
    verified: true,
  };
}

function authorization(grant: AgentIdentity = identity()): ChannelAuthorization {
  return { identity: grant, agentAliases: ["primary"], grantRevision: "rev-1" };
}

function event(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    connectionId: CONNECTION,
    externalConversationId: CHAT,
    externalActorId: ACTOR,
    eventId: "1",
    text: "hello",
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait (bounded) until a predicate holds; fails the test instead of hanging. */
async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function textProvider(calls: { count: number }, text: (turn: number) => string): AIProvider {
  return {
    id: "mock",
    async *generate() {
      calls.count += 1;
      yield providerTextDelta(text(calls.count));
      yield providerDone();
    },
  };
}

/** Provider that runs until aborted, standing in for a process that dies mid-run. */
function hangingProvider(calls: { count: number }): AIProvider {
  return {
    id: "mock",
    async *generate(request) {
      calls.count += 1;
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) {
          resolve();
          return;
        }
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("aborted while the process was dying");
    },
  };
}

function trackingStore(ids: Set<string>): SessionStore {
  const inner = createMemorySessionStore();
  return {
    append: async (entry, options) => {
      ids.add(entry.sessionId);
      await inner.append(entry, options);
    },
    list: (sessionId) => inner.list(sessionId),
  };
}

function agentWith(provider: AIProvider, store: SessionStore = createMemorySessionStore()): Agent {
  return createAgent({ id: "channel-agent", model: { provider: "mock", model: "demo" }, provider, store });
}

interface Harness {
  readonly runtime: MessagingRuntime;
  readonly delivered: ChannelReply[];
}

function harness(options: Partial<MessagingRuntimeOptions> & { agent: Agent; authorization?: ChannelAuthorization | false }): Harness {
  const delivered: ChannelReply[] = [];
  const runtime = createMessagingRuntime({
    authorize: () => options.authorization ?? authorization(),
    resolveAgent: () => options.agent,
    deliver: (reply) => {
      delivered.push(reply);
      return { delivered: true };
    },
    ...options,
  });
  return { runtime, delivered };
}

/** One checkpoint store shared by two runtimes, the way a restart shares a database. */
function durableWorld(provider: AIProvider, ids: Set<string>, leaseStore?: boolean) {
  const checkpoints = createMemoryCheckpointStore();
  const store = trackingStore(ids);
  const shared: Partial<MessagingRuntimeOptions> = {
    checkpoints,
    ...(leaseStore === true ? { leases: createMemoryLeaseStore() } : {}),
  };
  return {
    checkpoints,
    store,
    first: (deliver?: (reply: ChannelReply) => ChannelSendResult | Promise<ChannelSendResult>) =>
      harness({ agent: agentWith(provider, store), ...shared, ...(deliver === undefined ? {} : { deliver }) }),
    second: (deliver?: (reply: ChannelReply) => ChannelSendResult | Promise<ChannelSendResult>) =>
      harness({ agent: agentWith(provider, store), ...shared, ...(deliver === undefined ? {} : { deliver }) }),
  };
}

describe("plan 079 channel durable recovery", () => {
  it("reuses the durable binding across a restart and never re-executes a duplicate event", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const world = durableWorld(
      textProvider(calls, (turn) => `answer ${turn}`),
      ids,
    );
    const first = world.first();

    const admitted = await first.runtime.admit(event());
    assert.equal(admitted.status, "accepted");
    await first.runtime.drain();
    assert.equal(calls.count, 1);
    assert.equal(ids.size, 1);
    const sessionId = [...ids][0];
    assert.ok(sessionId !== undefined);

    // "Restart": a second runtime over the same journal, no memory shared with the first.
    const second = world.second();
    const next = await second.runtime.admit(event({ eventId: "2" }));
    assert.equal(next.status, "accepted");
    await second.runtime.drain();
    assert.equal(calls.count, 2);
    assert.deepEqual([...ids], [sessionId], "the second runtime binds to the journaled session id");

    // The first event is still deduplicated after the restart: no provider work at all.
    const retry = await second.runtime.admit(event());
    assert.equal(retry.status, "accepted");
    assert.equal(retry.duplicate, true);
    await second.runtime.drain();
    assert.equal(calls.count, 2);
    assert.equal(second.delivered.length, 1, "only the new event produced a reply");
  });

  it("keeps the /new generation across a restart and keeps tenants on separate records", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const world = durableWorld(
      textProvider(calls, (turn) => `answer ${turn}`),
      ids,
    );
    const first = world.first();
    await first.runtime.admit(event());
    await first.runtime.drain();
    await first.runtime.admit(event({ eventId: "2", text: "/new" }));
    await first.runtime.drain();
    const generationOne = [...ids][0];
    assert.ok(generationOne !== undefined);

    const second = world.second();
    await second.runtime.admit(event({ eventId: "3" }));
    await second.runtime.drain();
    const generationTwo = [...ids][1];
    assert.ok(generationTwo !== undefined);
    assert.notEqual(generationTwo, generationOne, "/new survives the restart");

    // A different tenant with the same connection + event id is a different operation record.
    const otherTenant = harness({
      agent: agentWith(
        textProvider(calls, (turn) => `answer ${turn}`),
        trackingStore(new Set()),
      ),
      authorization: authorization(identity("user-1", "tenant-2")),
      checkpoints: world.checkpoints,
    });
    await otherTenant.runtime.admit(event({ eventId: "3" }));
    await otherTenant.runtime.drain();
    assert.equal(otherTenant.delivered.length, 1, "tenant-2 is not blocked by tenant-1's operation record");
  });

  it("never replays work claimed before a crash and resolves it only through authorized reconcile", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const world = durableWorld(hangingProvider(calls), ids);
    const dying = world.first();
    const admitted = await dying.runtime.admit(event());
    assert.equal(admitted.status, "accepted");
    assert.ok(admitted.operationId !== undefined);
    let unresolved: readonly ChannelUnresolvedOperation[] = [];
    await waitFor(async () => {
      unresolved = await dying.runtime.listUnresolved({ identity: identity() });
      return unresolved[0]?.state === "executing";
    }, "the first runtime to claim the operation");
    assert.equal(unresolved.length, 1, "the claimed operation is visible as unresolved");
    const claimedVersion = unresolved[0]?.version ?? 0;

    // Restart while the old process is still "running" its claimed operation.
    const restarted = world.second();
    const retry = await restarted.runtime.admit(event());
    assert.equal(retry.duplicate, true, "a claimed operation is never re-executed");
    await restarted.runtime.drain();
    assert.equal(restarted.runtime.diagnostics().active, 0);
    assert.equal(ids.size, 1, "no second run happened on the restarted runtime");

    const missingAck = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: claimedVersion,
    });
    assert.equal(missingAck.status, "conflict");
    assert.equal(missingAck.detail, "duplicate_risk");

    const stale = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: claimedVersion + 5,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(stale.status, "conflict", "a stale expected version is rejected");

    const resolved = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: claimedVersion,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.outcome, "execution_unknown");
    assert.equal((await restarted.runtime.listUnresolved({ identity: identity() })).length, 0);

    // Cross-ownership reconcile is denied/not found, never a foreign read.
    const foreign = await restarted.runtime.reconcile({
      identity: identity("user-1", "tenant-2"),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: claimedVersion,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(foreign.status, "not_found");

    await dying.runtime.stop();
    assert.equal(calls.count, 1, "the dying process never ran the operation twice");
  });

  it("keeps an ambiguous send out of automatic replay and resends it only with the duplicate-risk ack", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const world = durableWorld(
      textProvider(calls, () => "the durable answer"),
      ids,
    );
    const first = world.first(() => {
      throw new Error("socket closed after the platform accepted the message");
    });
    const admitted = await first.runtime.admit(event());
    assert.ok(admitted.operationId !== undefined);
    await first.runtime.drain();
    assert.equal(calls.count, 1);
    assert.equal(first.delivered.length, 0);

    const restarted = world.second();
    const attention = await restarted.runtime.listUnresolved({ identity: identity() });
    assert.equal(attention.length, 1, "a settled operation with an unconfirmed reply still needs attention");
    assert.equal(attention[0]?.replyState, "delivery_unknown");
    const version = attention[0]?.version ?? 0;
    const withoutAck = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: version,
    });
    assert.equal(withoutAck.status, "conflict", "an ambiguous reply is never resent on a bare request");

    const resent = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: version,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(resent.status, "resolved");
    assert.equal(resent.outcome, "reply_delivered");
    assert.equal(restarted.delivered.length, 1);
    assert.equal(restarted.delivered[0]?.text, "the durable answer", "the persisted reply text is what gets resent");
    assert.equal(calls.count, 1, "resending a reply never reruns the model");

    // Now settled: a replay is a no-op instead of a second message.
    const repeated = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId: admitted.operationId,
      expectedVersion: version,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(repeated.status, "resolved");
    assert.equal(repeated.outcome, "none");
    assert.equal(restarted.delivered.length, 1);
    assert.equal((await restarted.runtime.listUnresolved({ identity: identity() })).length, 0, "the reply is now settled");
  });

  it("delivers a reply staged before a crash and retries a known send failure without an ack", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const operationId = "chan-op-staged-1";
    const ownership = ownershipFromIdentity(identity());
    const state = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 });
    const journal = createChannelDeliveryJournal({ checkpoints, maxJournalRecordBytes: 4096 });
    const now = new Date().toISOString();
    assert.ok(
      (await state.createOperation(
        { ownership, connectionId: CONNECTION, operationId },
        {
          operationId,
          eventId: "7",
          kind: "message",
          connectionId: CONNECTION,
          externalConversationId: CHAT,
          externalActorId: ACTOR,
          agentAlias: "primary",
          state: "succeeded",
          replyStaged: false,
          attempts: 1,
          createdAt: now,
          updatedAt: now,
        },
      )) !== null,
    );
    assert.ok(
      (await journal.mark(
        { ownership, connectionId: CONNECTION, operationId },
        {
          operationId,
          connectionId: CONNECTION,
          externalConversationId: CHAT,
          kind: "final",
          text: "staged before the crash",
          state: "pending",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        0,
      )) !== null,
    );

    const calls = { count: 0 };
    const restarted = harness({
      agent: agentWith(textProvider(calls, () => "unused")),
      checkpoints,
    });
    const foreign = await restarted.runtime.reconcile({
      identity: identity("user-1", "tenant-2"),
      connectionId: CONNECTION,
      operationId,
      expectedVersion: 1,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(foreign.status, "not_found", "reconcile cannot see another owner's operation");

    const sent = await restarted.runtime.reconcile({
      identity: identity(),
      connectionId: CONNECTION,
      operationId,
      expectedVersion: 1,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(sent.status, "resolved");
    assert.equal(sent.outcome, "reply_delivered");
    assert.equal(restarted.delivered[0]?.text, "staged before the crash");
    assert.equal(calls.count, 0, "recovery of a staged reply never invokes the provider");
  });

  it("defers to the lease holder instead of driving the same binding twice", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const checkpoints = createMemoryCheckpointStore();
    const leases = createMemoryLeaseStore();
    const store = trackingStore(ids);
    const gate = { resolve: (): void => undefined };
    const gated: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        await new Promise<void>((resolve) => {
          gate.resolve = resolve;
        });
        yield providerTextDelta("answer");
        yield providerDone();
      },
    };
    const owner = harness({ agent: agentWith(gated, store), checkpoints, leases });
    const other = harness({ agent: agentWith(textProvider({ count: 0 }, () => "other")), checkpoints, leases });

    const admitted = await owner.runtime.admit(event());
    assert.ok(admitted.operationId !== undefined);
    await waitFor(() => owner.runtime.diagnostics().active === 1, "the lease holder to start running");

    const deferred = await other.runtime.admit(event({ eventId: "2" }));
    assert.equal(deferred.status, "accepted");
    await other.runtime.drain();
    assert.equal(other.delivered.length, 0, "the non-holder executes nothing");
    assert.ok(other.runtime.diagnostics().leaseLosses >= 1, "the deferral is visible in diagnostics");
    assert.equal(other.runtime.diagnostics().completed, 0);
    assert.ok(deferred.operationId !== undefined);
    const state = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 });
    assert.equal(
      await state.loadOperation({
        ownership: ownershipFromIdentity(identity()),
        connectionId: CONNECTION,
        operationId: deferred.operationId,
      }),
      null,
      "a deferred event keeps nothing behind that would block a redelivery",
    );

    gate.resolve();
    await owner.runtime.drain();
    await other.runtime.drain();
    assert.equal(calls.count, 1);
    assert.equal(owner.delivered.length, 1);
  });

  it("prunes settled records past retention and never prunes unresolved work", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const ownership: OwnershipScope = ownershipFromIdentity(identity());
    const state = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 4096 });
    const journal = createChannelDeliveryJournal({ checkpoints, maxJournalRecordBytes: 4096 });
    const old = new Date(Date.parse("2020-01-01T00:00:00.000Z")).toISOString();
    const settled = { ownership, connectionId: CONNECTION, operationId: "chan-op-settled" };
    const unresolved = { ownership, connectionId: CONNECTION, operationId: "chan-op-unresolved" };
    const baseOp = {
      eventId: "9",
      kind: "message" as const,
      connectionId: CONNECTION,
      externalConversationId: CHAT,
      externalActorId: ACTOR,
      agentAlias: "primary",
      replyStaged: false,
      attempts: 1,
      createdAt: old,
      updatedAt: old,
    };
    assert.ok((await state.createOperation(settled, { ...baseOp, operationId: "chan-op-settled", state: "succeeded" })) !== null);
    assert.ok((await state.createOperation(unresolved, { ...baseOp, operationId: "chan-op-unresolved", state: "executing" })) !== null);
    assert.ok(
      (await journal.mark(
        settled,
        {
          operationId: "chan-op-settled",
          connectionId: CONNECTION,
          externalConversationId: CHAT,
          kind: "final",
          text: "old answer",
          state: "delivered",
          attempts: 1,
          createdAt: old,
          updatedAt: old,
        },
        0,
      )) !== null,
    );
    assert.ok(
      (await journal.mark(
        unresolved,
        {
          operationId: "chan-op-unresolved",
          connectionId: CONNECTION,
          externalConversationId: CHAT,
          kind: "notice",
          text: "still ambiguous",
          state: "delivery_unknown",
          attempts: 1,
          createdAt: old,
          updatedAt: old,
        },
        0,
      )) !== null,
    );

    const runtime = harness({ agent: agentWith(textProvider({ count: 0 }, () => "x")), checkpoints }).runtime;
    const result = await runtime.prune({ identity: identity(), now: "2026-09-16T00:00:00.000Z" });
    assert.equal(result.deleted, 2, "the settled operation and its delivered reply are removed");
    assert.ok(result.retained >= 2);
    assert.equal(await state.loadOperation(settled), null, "the settled operation is pruned");
    assert.equal(await journal.load(settled), null, "the delivered reply is pruned");
    assert.equal((await state.loadOperation(unresolved))?.record.state, "executing", "unresolved work is retained");
    assert.equal((await journal.load(unresolved))?.record.state, "delivery_unknown", "an ambiguous reply is retained");
  });
});
