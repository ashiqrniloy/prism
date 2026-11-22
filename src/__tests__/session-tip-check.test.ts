import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  isSessionAppendConflict,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  SESSION_CONFLICT_CODE,
  type SessionAppendOptions,
  type SessionEntry,
  type SessionStore,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { storeConformance } from "../testing/store-conformance.js";
import { assertStateConcurrencyConforms } from "../testing/state-concurrency-conformance.js";

/** Plan 230 Task 2: a linear append fails when another writer has moved the tip. */

const echo: ModelProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

async function agentOn(store: SessionStore) {
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("p", [echo])], slots: { store } });
}

/** Every user message text on the session, in store order. */
async function userTexts(store: SessionStore, sessionId: string): Promise<string[]> {
  return (await store.list(sessionId)).flatMap((entry) =>
    entry.kind === "message" && entry.message?.role === "user"
      ? entry.message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
      : [],
  );
}

function recordingStore(inner: SessionStore): { store: SessionStore; calls: { entry: SessionEntry; options?: SessionAppendOptions }[] } {
  const calls: { entry: SessionEntry; options?: SessionAppendOptions }[] = [];
  return {
    calls,
    store: {
      tipCheck: inner.tipCheck,
      append: async (entry, options) => {
        calls.push({ entry, options });
        await inner.append(entry, options);
      },
      list: (id) => inner.list(id),
      get: (id) => inner.get!(id),
      readBranchPath: (query) => inner.readBranchPath!(query),
    },
  };
}

describe("tip-checked appends (plan 230 Task 2)", () => {
  it("second_writer_at_the_same_tip_conflicts", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOn(store);
    const first = await agent.session({ id: "two-writers", create: true });
    assert.equal((await first.run("a")).status, "completed");
    const second = await agent.session({ id: "two-writers" });
    assert.equal((await first.run("b")).status, "completed");
    const before = (await store.list("two-writers")).length;

    const conflicted = await second.run("c");
    assert.equal(conflicted.status, "failed");
    assert.equal(conflicted.error?.code, SESSION_CONFLICT_CODE);
    assert.equal((await store.list("two-writers")).length, before, "the conflicting run writes nothing");
    assert.deepEqual(await userTexts(store, "two-writers"), ["a", "b"]);
  });

  it("conflict_invalidates_snapshot_and_next_run_sees_real_tip", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOn(store);
    const first = await agent.session({ id: "recover", create: true });
    await first.run("a");
    const second = await agent.session({ id: "recover" });
    await first.run("b");
    assert.equal((await second.run("c")).error?.code, SESSION_CONFLICT_CODE);

    const retried = await second.run("d");
    assert.equal(retried.status, "completed");
    const texts = (await second.messages()).filter((message) => message.role === "user").map((message) => message.content[0]);
    assert.deepEqual(
      texts.map((part) => (part?.type === "text" ? part.text : "")),
      ["a", "b", "d"],
      "the next run reads the other writer's tip and appends after it",
    );
    // The first writer is now the stale one.
    assert.equal((await first.run("e")).error?.code, SESSION_CONFLICT_CODE);
  });

  it("checkout_then_append_is_a_branch_not_a_conflict", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOn(store);
    const session = await agent.session({ id: "branching", create: true });
    await session.run("a");
    const forkPoint = session.leafId!;
    await session.run("b");
    await session.checkout(forkPoint);
    const branched = await session.run("c");
    assert.equal(branched.status, "completed", "an append after checkout() to an earlier entry is a branch");
    // The branch continues linearly, so its second run is tip-checked and accepted.
    assert.equal((await session.run("d")).status, "completed");
    assert.deepEqual(await userTexts(store, "branching"), ["a", "b", "c", "d"]);
    const branch = (await session.messages()).filter((message) => message.role === "user");
    assert.equal(branch.length, 3, "the branch holds a, c, d");
  });

  it("session_opened_at_stale_leaf_conflicts", async () => {
    const store = createMemorySessionStore();
    const agent = await agentOn(store);
    const first = await agent.session({ id: "stale-leaf", create: true });
    await first.run("a");
    const saved = first.leafId!;
    await first.run("b");
    const reopened = await agent.session({ id: "stale-leaf", leafId: saved });
    const result = await reopened.run("c");
    assert.equal(result.error?.code, SESSION_CONFLICT_CODE, "a host that re-opens at a stale saved leaf is a second writer");
    assert.deepEqual(await userTexts(store, "stale-leaf"), ["a", "b"]);
  });

  it("fork_copies_are_not_tip_checked", async () => {
    const { store, calls } = recordingStore(createMemorySessionStore());
    const agent = await agentOn(store);
    const session = await agent.session({ id: "forked", create: true });
    await session.run("a");
    assert.ok(
      calls.slice(1).every((call) => call.options?.tip === true),
      "linear appends after the session root are tip-checked",
    );
    calls.length = 0;
    const fork = await session.fork();
    assert.ok(calls.length > 0);
    assert.ok(
      calls.every((call) => call.options?.tip !== true && call.entry.sessionId === fork.id),
      "fork copies are not tip appends",
    );
    assert.equal((await fork.run("b")).status, "completed", "the forked session then appends linearly");
  });

  it("idempotent_retry_dedups_before_tip_check", async () => {
    const store = createMemorySessionStore();
    const entry = (id: string, parentId?: string): SessionEntry => ({
      id,
      parentId,
      sessionId: "s",
      timestamp: "2026-11-16T00:00:00.000Z",
      kind: "label",
      label: id,
    });
    await store.append(entry("root"));
    await store.append(entry("a", "root"), { expectedParentId: "root", tip: true, idempotencyKey: "run-1" });
    await assert.rejects(
      () => store.append(entry("a-retry", "root"), { expectedParentId: "root", tip: true, idempotencyKey: "run-1" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    );
  });

  it("sibling_appends_without_tip_still_accepted", async () => {
    const store = createMemorySessionStore();
    const entry = (id: string, parentId?: string): SessionEntry => ({
      id,
      parentId,
      sessionId: "s",
      timestamp: "2026-11-16T00:00:00.000Z",
      kind: "label",
      label: id,
    });
    await store.append(entry("root"));
    await store.append(entry("a", "root"), { expectedParentId: "root" });
    await store.append(entry("b", "root"), { expectedParentId: "root" });
    await store.append(entry("c", "root"), { expectedParentId: "root", tip: true });
    await assert.rejects(
      () => store.append(entry("d", "root"), { expectedParentId: "root", tip: true }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.currentLeafId === "c",
    );
    await store.append(entry("e", "root"), { expectedParentId: "root" });
  });

  it("concurrent_tip_race_one_wins", async () => {
    const probes = await assertStateConcurrencyConforms({ appends: () => createMemorySessionStore() });
    assert.deepEqual(probes, ["tip-race"]);
  });

  it("store_conformance_tip_check: memory", async () => {
    await storeConformance(createMemorySessionStore, { exerciseConcurrentParentAppend: true });
    // A store that declares the guard but ignores `tip` fails the leg.
    const lying = (): SessionStore => {
      const inner = createMemorySessionStore();
      return { ...inner, append: (entry, options) => inner.append(entry, options && { ...options, tip: undefined }) };
    };
    await assert.rejects(() => storeConformance(lying), /\[tip-check\]/);
  });

  it("inspect reports tipCheck only for a store that declares it", async () => {
    const declared = await agentOn(createMemorySessionStore());
    assert.ok(declared.inspect().store.capabilities.includes("tipCheck"));
    const { tipCheck: _drop, ...plain } = createMemorySessionStore();
    const undeclared = await agentOn(plain as SessionStore);
    assert.ok(!undeclared.inspect().store.capabilities.includes("tipCheck"));
  });
});
