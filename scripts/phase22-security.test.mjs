/**
 * Phase 22 security conformance (plan 022 Task 5).
 *
 * Proves the four 0.2.2 state-concurrency/durability blockers are enforced at
 * RUNTIME through BUILT PUBLIC package entrypoints (workspace dist via package
 * exports), never private source imports — the original review defects were
 * runtime-only gaps that TypeScript declarations could not express:
 *
 *   T1 (regression matrix item 9, by name): parallel router admissions can
 *     never oversubscribe the reserved budget — reserve/commit/release with
 *     fencing, TTL-expired late commits reconcile as unknown usage.
 *   T2 (regression matrix item 8, by name): concurrent conversation
 *     branch/archive/create preserve valid state — the appendSession CAS
 *     admits exactly one writer per version and stale writers (including
 *     writes racing an archive, and writes after a retention delete) fail
 *     closed with metadata_conflict instead of resurrecting stale state.
 *   T3: a second EventMultiplexer subscriber rejects with
 *     ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER instead of silently sharing
 *     the queue and losing events.
 *   T4: the NATS durable consumer name is restart-stable (prism_<hmac16>, no
 *     random suffix), so a crash-resumed subscribe continues from the last
 *     ack instead of replaying from the stream head.
 *
 * Gate accounting: the final test asserts every blocker ID above executed and
 * none was skipped, so a deleted/renamed/skipped blocker test fails the suite
 * even when the remaining tests pass.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEventMultiplexer, EventMultiplexerError, SessionMetadataConflictError } from "@arnilo/prism";
import { createMemoryModelRouterStateStore } from "@arnilo/prism-model-router";
import { createNatsAgentEventSource } from "@arnilo/prism-session-store-nats";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";

const BLOCKER_IDS = ["budget-reservation", "conversation-metadata-cas", "single-consumer", "nats-durable"];
const blockerIds = new Set();

const ownership = { tenantId: "phase22", userId: "u1" };
const sessionRecord = (id, metadata, updatedAt = "2026-08-13T00:00:00.000Z", expectedVersion) => ({
  id,
  ...ownership,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt,
  metadata,
  ...(expectedVersion === undefined ? {} : { expectedVersion }),
});

describe("phase22 security conformance (plan 022 Task 5, built public entrypoints)", () => {
  it("T1 [matrix item 9]: parallel router admissions cannot exceed the reserved budget", async () => {
    const store = createMemoryModelRouterStateStore();
    const key = { tenantId: "phase22", principalId: "p1", provider: "mock", model: "m1" };
    const base = { key, tokens: 26, maxTokens: 100, windowMs: 60_000, reservationTtlMs: 60_000, now: 1_000_000 };
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => store.reserveBudget({ ...base })));
    const admitted = outcomes.filter((outcome) => outcome.admitted);
    const denied = outcomes.filter((outcome) => !outcome.admitted);
    assert.equal(admitted.length, 3, "4 parallel reservations of 26/100 must admit exactly 3 (100 - 3*26 = 22 < 26)");
    assert.equal(denied.length, 1, "the 4th reservation must be denied");
    assert.ok(denied[0].retryAfterMs !== undefined && denied[0].retryAfterMs > 0, "denial must carry retryAfterMs");

    // A live commit reconciles actuals (design B: the row tracks actuals only).
    const winner = admitted[0];
    await store.commitBudget({
      key,
      reservationId: winner.reservationId,
      fencingToken: winner.fencingToken,
      tokens: 10,
      windowMs: 60_000,
      now: 1_000_001,
    });
    assert.equal(
      (await store.readBudget({ key, windowMs: 60_000, now: 1_000_002 })).tokens,
      10,
      "live commit adds actuals, not the reserved amount",
    );

    // A stale fencing token can never charge: the committer identity is unforgeable.
    await assert.rejects(
      () => store.commitBudget({ key, reservationId: admitted[1].reservationId, fencingToken: "forged", windowMs: 60_000, now: 1_000_003 }),
      (error) => error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
      "stale fencing token must fail closed",
    );

    // TTL-expired late commit: the reservation reconciles as unknown usage and
    // charges the reserved amount, never silently dropping the outcome.
    const ttlStore = createMemoryModelRouterStateStore();
    const ttl = await ttlStore.reserveBudget({ ...base, tokens: 7, now: 0 });
    assert.equal(ttl.admitted, true);
    const reconcile = await ttlStore.commitBudget({
      key,
      reservationId: ttl.reservationId,
      fencingToken: ttl.fencingToken,
      tokens: 7,
      windowMs: 60_000,
      now: 61_001,
    });
    assert.equal(reconcile.unknownUsage, true, "late commit after TTL expiry must surface unknown usage");
    assert.equal(
      (await ttlStore.readBudget({ key, windowMs: 60_000, now: 61_002 })).tokens,
      7,
      "expired reservation charges the reserved amount",
    );
    blockerIds.add("budget-reservation");
  });

  it("T2 [matrix item 8]: concurrent conversation create/branch/archive preserve valid state; stale writes cannot resurrect", async () => {
    const persistence = createSqlitePersistence({ filename: ":memory:" });
    const id = "phase22-conversation";

    // 8 parallel create-only writes: exactly one wins at version 1; the rest
    // fail closed with metadata_conflict (create-only never overwrites).
    const creates = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        persistence
          .appendSession(sessionRecord(id, { state: "active", writer: `create-${i}` }, `2026-08-13T00:00:0${i}.000Z`, 0))
          .then((result) => ({
            result,
            writer: `create-${i}`,
          })),
      ),
    );
    const created = creates.filter((outcome) => outcome.status === "fulfilled");
    const createConflicts = creates.filter(
      (outcome) => outcome.status === "rejected" && outcome.reason instanceof SessionMetadataConflictError,
    );
    assert.equal(created.length, 1, "exactly one concurrent create wins");
    assert.equal(createConflicts.length, 7, "the other 7 creates conflict");
    assert.equal(created[0].value.result.version, 1, "winner lands at version 1");

    // 8 parallel branch/archive-shaped CAS writes at version 1: exactly one
    // lands at version 2; the losers see currentVersion 2.
    const updates = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        persistence
          .appendSession(sessionRecord(id, { state: "active", branch: `b${i}` }, `2026-08-13T00:01:0${i}.000Z`, 1))
          .then((result) => ({ result, branch: `b${i}` })),
      ),
    );
    const updated = updates.filter((outcome) => outcome.status === "fulfilled");
    const updateConflicts = updates.filter(
      (outcome) => outcome.status === "rejected" && outcome.reason instanceof SessionMetadataConflictError,
    );
    assert.equal(updated.length, 1, "exactly one CAS update wins");
    assert.equal(updateConflicts.length, 7, "the other 7 CAS updates conflict");
    assert.equal(updated[0].value.result.version, 2, "winner lands at version 2");
    for (const conflict of updateConflicts) {
      assert.equal(conflict.reason.code, "metadata_conflict");
      assert.equal(conflict.reason.conflict.currentVersion, 2, "conflict carries the current version");
    }

    // Archive at version 2, then a stale branch write at version 1 (a writer
    // that read the pre-archive state) must fail — the archive is not revived.
    await persistence.appendSession(
      sessionRecord(id, { state: "archived", archivedAt: "2026-08-13T00:02:00.000Z" }, "2026-08-13T00:02:00.000Z", 2),
    );
    await assert.rejects(
      () => persistence.appendSession(sessionRecord(id, { state: "active", branch: "stale-branch" }, "2026-08-13T00:00:00.000Z", 1)),
      (error) => error instanceof SessionMetadataConflictError,
      "stale pre-archive writer must fail closed",
    );
    const archived = await persistence.querySessions({ id, limit: 1 });
    assert.equal(archived.items[0].metadata.state, "archived", "archived state must survive the stale write");

    // Retention delete, then a stale CAS write: the deleted session is never
    // resurrected (the CAS insert arm refuses when the row no longer exists).
    const retention = await persistence.lifecycle.applyRetention({
      ...ownership,
      policy: { id: "phase22-ret", createdAt: "2026-08-13T00:00:00.000Z", maxAgeDays: 0, appliedKinds: ["message"] },
      candidates: [id],
      limit: 10,
    });
    assert.deepEqual(retention.deleted, [id], "retention must delete the session");
    await assert.rejects(
      () => persistence.appendSession(sessionRecord(id, { state: "active", zombie: true }, "2026-08-13T00:03:00.000Z", 3)),
      (error) => error instanceof SessionMetadataConflictError,
      "a deleted session must never be resurrected by a stale CAS write",
    );
    assert.equal((await persistence.querySessions({ id, limit: 1 })).items.length, 0, "session stays deleted");
    blockerIds.add("conversation-metadata-cas");
  });

  it("T3: a second EventMultiplexer subscriber rejects instead of silently sharing the queue", async () => {
    const source = {
      async *[Symbol.asyncIterator]() {
        for (let value = 0; ; value += 1) yield value;
      },
    };
    const multiplexer = createEventMultiplexer({ maxQueuedEvents: 1024 });
    multiplexer.observe(source, (value) => value);
    const first = multiplexer.subscribe();
    assert.deepEqual(await first.next(), { value: 0, done: false }, "first subscriber consumes normally");
    const second = multiplexer.subscribe();
    await assert.rejects(
      () => second.next(),
      (error) => error instanceof EventMultiplexerError && error.code === "ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER",
      "second subscriber must be rejected, not parked silently",
    );
    // The slot frees when the first consumer returns; a later subscriber works again.
    await first.return(undefined);
    await multiplexer.close();
    const reopened = createEventMultiplexer({ maxQueuedEvents: 1024 });
    reopened.observe(source, (value) => value);
    const again = reopened.subscribe();
    assert.deepEqual(await again.next(), { value: 0, done: false }, "a fresh subscriber after close consumes normally");
    await reopened.close();
    blockerIds.add("single-consumer");
  });

  it("T4: the NATS durable consumer name is restart-stable and resumes from the last ack", async () => {
    // Network-free structural NatsJetStream seam (the same narrow public
    // interface createNatsJetStream adapts); consumers upsert by name so a
    // restarting durable subscribe reuses the crash-left consumer at its ack.
    const messages = new Map();
    const consumers = new Map();
    let nextSeq = 1;
    const seam = {
      async publish(subject, data, opts) {
        const seq = nextSeq++;
        messages.set(seq, { subject, data, msgID: opts.msgID });
        return { stream: "test", seq, duplicate: false };
      },
      async addConsumer(_stream, cfg) {
        const existing = consumers.get(cfg.name);
        consumers.set(cfg.name, { cfg, acked: existing ? new Set(existing.acked) : new Set() });
      },
      async getConsumer(_stream, name) {
        const state = consumers.get(name);
        if (!state) throw new Error(`consumer not found: ${name}`);
        return {
          async fetch({ max_messages }) {
            const filter = state.cfg.filter_subject;
            const start = state.cfg.opt_start_seq ?? 1;
            const candidates = [];
            for (const [seq, message] of messages) {
              if (seq < start) continue;
              if (!filter.split(".").every((token, i) => token === "*" || token === message.subject.split(".")[i])) continue;
              if (state.acked.has(seq)) continue;
              candidates.push({ seq, data: message.data });
            }
            candidates.sort((left, right) => left.seq - right.seq);
            const batch = candidates.slice(0, max_messages);
            return {
              async *[Symbol.asyncIterator]() {
                for (const item of batch) {
                  yield { seq: item.seq, data: item.data, ack: () => state.acked.add(item.seq) };
                }
              },
            };
          },
        };
      },
      async deleteConsumer(_stream, name) {
        consumers.delete(name);
      },
      async getMessage(_stream, seq) {
        const message = messages.get(seq);
        return message ? { data: message.data } : null;
      },
      async deleteMessage() {},
    };

    const stream = "phase22-stream";
    const options = { connection: seam, stream, cursorSecret: "phase22-cursor-secret" };
    const source = createNatsAgentEventSource(options);
    const record = (id, type, owner = ownership) => ({
      id,
      ...owner,
      sessionId: "s1",
      runId: "r1",
      type,
      timestamp: "2026-08-13T00:00:00.000Z",
      redacted: true,
      event: { type, sessionId: "s1", runId: "r1", turn: 1 },
    });
    await source.append(record("event-1", "agent_started"));
    await source.append(record("event-2", "turn_started"));

    const read = { ownership, sessionId: "s1", runId: "r1", limit: 10 };
    const first = source.subscribe(read);
    const iterator = first[Symbol.asyncIterator]();
    const envelope1 = await iterator.next();
    assert.equal(envelope1.value.record.id, "event-1");
    const envelope2 = await iterator.next(); // resumes the yield: event-1 is now acked
    assert.equal(envelope2.value.record.id, "event-2");
    const name = [...consumers.keys()][0];
    assert.match(name, /^prism_[0-9a-f]{16}$/, "durable name is prism_<hmac16> with no random suffix");

    // Crash: no close(), no deleteConsumer — the consumer survives with event-1 acked.
    // A fresh source subscribing without a cursor must resume after the ack, not replay.
    const restarted = createNatsAgentEventSource(options);
    const resumed = await restarted.subscribe(read)[Symbol.asyncIterator]().next();
    assert.equal(resumed.value.record.id, "event-2", "restart must resume from the last ack, not the stream head");
    assert.equal(resumed.value.record.sequence, 2);

    // Cross-tenant ownership mints a different durable name (no cross-run collision).
    const other = createNatsAgentEventSource({ ...options, connection: seam, stream });
    await other.append(record("event-3", "turn_started", { tenantId: "phase22-b", userId: "u1" }));
    const foreign = await other
      .subscribe({ ...read, ownership: { ...ownership, tenantId: "phase22-b" } })
      [Symbol.asyncIterator]()
      .next();
    assert.equal(foreign.value.record.id, "event-3");
    assert.equal([...consumers.keys()].filter((key) => key !== name).length, 1, "cross-tenant subscribe mints a distinct durable name");
    // close() aborts each parked subscriber's stop signal (a parked return() would
    // queue forever behind the pending fetch), then the generator finally deletes
    // the durable consumers.
    await source.close();
    await restarted.close();
    await other.close();
    blockerIds.add("nats-durable");
  });

  it("gate accounting: all four blocker IDs executed; none skipped or renamed away", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
