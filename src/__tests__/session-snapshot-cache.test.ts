import { describe, it, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  type Message,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  rebuildSessionContext,
  SessionAppendConflictError,
  type SessionEntry,
  type SessionStore,
} from "../index.js";
import { estimateMessageTokens } from "../models/estimate.js";
import { providerPackage } from "../provider-kit/index.js";
import { mockProvider } from "../testing/index.js";

/**
 * Plan 210 Task 0.3: the session snapshot cache is extended by the session's own tip appends and
 * revalidated with one `store.get` on expiry, instead of re-reading and cloning the branch per turn.
 */

type Counts = { list: number; readBranchPath: number; get: number; entries: number };

function countingStore(inner: SessionStore, options: { withGet?: boolean } = {}): { store: SessionStore; counts: Counts } {
  const counts: Counts = { list: 0, readBranchPath: 0, get: 0, entries: 0 };
  const store: SessionStore = {
    append: (entry, appendOptions) => inner.append(entry, appendOptions),
    async list(sessionId) {
      counts.list += 1;
      const entries = await inner.list(sessionId);
      counts.entries += entries.length;
      return entries;
    },
    async readBranchPath(query) {
      counts.readBranchPath += 1;
      const page = await inner.readBranchPath!(query);
      counts.entries += page.items.length;
      return page;
    },
    ...(inner.deleteSession ? { deleteSession: (id: string) => inner.deleteSession!(id) } : {}),
  };
  if (options.withGet !== false) {
    store.get = async (id) => {
      counts.get += 1;
      const entry = await inner.get!(id);
      if (entry) counts.entries += 1;
      return entry;
    };
  }
  return { store, counts };
}

async function testAgent(): Promise<Agent> {
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])] });
}

function message(sessionId: string, parentId: string | undefined, role: Message["role"], text: string): SessionEntry {
  return createSessionEntry({ sessionId, parentId, kind: "message", message: { role, content: [{ type: "text", text }] } });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("session snapshot cache (plan 210 Task 0.3)", () => {
  it("own_appends_extend_snapshot_without_store_reads", async () => {
    let turns = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turns += 1;
        yield providerTextDelta(`reply ${turns}`);
        yield providerDone();
      },
    };
    const { store, counts } = countingStore(createMemorySessionStore());
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("p", [provider])],
      slots: { store },
    });
    const session = await agent.session({ id: "extend", create: true, snapshotCacheTtlMs: 30_000 });
    await session.run("warm-up");
    const before = { ...counts };
    for (let turn = 0; turn < 50; turn += 1) await session.run(`turn ${turn}`);
    assert.equal(turns, 51);
    assert.equal(counts.entries - before.entries, 0, "50 turns within the TTL read no entry from the store");
    assert.equal(counts.readBranchPath + counts.list, before.readBranchPath + before.list);
    const messages = await session.messages();
    assert.equal(messages.length, 102, "every turn's user and assistant message is in the snapshot");
    assert.deepEqual(messages, rebuildSessionContext(await store.list("extend"), { leafId: session.leafId }).messages);
  });

  it("incremental_snapshot_equals_full_rebuild", async () => {
    const agent = await testAgent();
    const memory = createMemorySessionStore();
    let seed = 0x2100;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const sessions: RuntimeAgentSession[] = [new RuntimeAgentSession({ agent, id: "rand", store: memory, snapshotCacheTtlMs: 30_000 })];
    const check = async (session: RuntimeAgentSession, step: number) => {
      const cached = await session.snapshot();
      const rebuilt = rebuildSessionContext(await memory.list(session.id), { leafId: session.leafId });
      assert.deepEqual(cached, rebuilt, `step ${step}: cached snapshot equals a fresh rebuild`);
    };
    for (let step = 0; step < 400; step += 1) {
      const session = sessions[Math.floor(random() * sessions.length)]!;
      const leaf = session.leafId;
      const roll = random();
      const branch = (await session.snapshot()).entries;
      if (roll < 0.35) await session.appendEntry(message(session.id, leaf, random() < 0.5 ? "user" : "assistant", `m${step}`));
      else if (roll < 0.45)
        await session.appendEntry(
          createSessionEntry({
            sessionId: session.id,
            parentId: leaf,
            kind: "message",
            message: { role: "tool", toolCallId: `call-${step}`, name: "t", content: [{ type: "text", text: `r${step}` }] } as Message,
          }),
        );
      else if (roll < 0.53)
        await session.appendEntry(createSessionEntry({ sessionId: session.id, parentId: leaf, kind: "summary", summary: `s${step}` }));
      else if (roll < 0.58)
        await session.appendEntry(createSessionEntry({ sessionId: session.id, parentId: leaf, kind: "suspended_run", data: { step } }));
      else if (roll < 0.63)
        await session.appendEntry(createSessionEntry({ sessionId: session.id, parentId: leaf, kind: "label", label: `l${step}` }));
      else if (roll < 0.7 && branch.length > 2) {
        const through = branch[Math.floor(random() * (branch.length - 1))]!;
        const keep = branch.filter(() => random() < 0.2).map((entry) => entry.id);
        await session.appendEntry(
          createSessionEntry({
            sessionId: session.id,
            parentId: leaf,
            kind: "compaction",
            summary: `c${step}`,
            data: { throughEntryId: through.id, keepEntryIds: keep },
          }),
        );
      } else if (roll < 0.8 && branch.length > 0) await session.checkout(branch[Math.floor(random() * branch.length)]!.id);
      else if (roll < 0.85 && branch.length > 0 && sessions.length < 4) {
        sessions.push((await session.fork({ at: branch[Math.floor(random() * branch.length)]!.id })) as RuntimeAgentSession);
      } else if (roll < 0.9) {
        // Resume: a new handle on the same session and leaf.
        sessions[sessions.indexOf(session)] = new RuntimeAgentSession({
          agent,
          id: session.id,
          store: memory,
          leafId: leaf,
          snapshotCacheTtlMs: 30_000,
        });
      } else await session.appendEntry(message(session.id, leaf, "user", `tail${step}`));
      for (const each of sessions) await check(each, step);
    }
  });

  it("earlier_snapshot_values_are_not_mutated_by_extension", async () => {
    const memory = createMemorySessionStore();
    const session = new RuntimeAgentSession({ agent: await testAgent(), id: "frozen", store: memory, snapshotCacheTtlMs: 30_000 });
    await session.appendEntry(message("frozen", undefined, "user", "one"));
    const first = await session.snapshot();
    const copy = structuredClone(first);
    await session.appendEntry(message("frozen", session.leafId, "assistant", "two"));
    await session.appendEntry(createSessionEntry({ sessionId: "frozen", parentId: session.leafId, kind: "summary", summary: "s" }));
    const next = await session.snapshot();
    assert.deepEqual(first, copy, "the earlier snapshot is unchanged");
    assert.notEqual(next.entries, first.entries);
    assert.notEqual(next.messages, first.messages);
    assert.notEqual(next.summaries, first.summaries);
    assert.equal(next.entries.length, 3);
  });

  it("expired_cache_revalidates_with_one_get", async () => {
    const { store, counts } = countingStore(createMemorySessionStore());
    const agent = await testAgent();
    let now = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    try {
      const session = new RuntimeAgentSession({ agent, id: "expire", store, snapshotCacheTtlMs: 1 });
      await session.appendEntry(message("expire", undefined, "user", "one"));
      await session.snapshot();
      await session.appendEntry(message("expire", session.leafId, "assistant", "two"));
      const before = { ...counts };
      now += 5;
      const value = await session.snapshot();
      assert.equal(counts.get - before.get, 1, "one get revalidates the expired cache");
      assert.equal(counts.readBranchPath - before.readBranchPath, 0);
      assert.equal(counts.list - before.list, 0);
      assert.equal(value.entries.length, 2);
      // Renewed: a second read within the TTL makes no store call at all.
      await session.snapshot();
      assert.equal(counts.get - before.get, 1);
    } finally {
      clock.mockRestore();
    }
  });

  it("deleted_session_is_detected_at_revalidation", async () => {
    const memory = createMemorySessionStore();
    const agent = await testAgent();
    const session = new RuntimeAgentSession({ agent, id: "gone", store: memory, snapshotCacheTtlMs: 1 });
    await session.appendEntry(message("gone", undefined, "user", "one"));
    await session.snapshot();
    assert.equal(await memory.deleteSession!("gone"), true, "another handle deletes the session");
    await sleep(5);
    await assert.rejects(session.snapshot(), /Unknown session leaf/, "the rebuild fails as it does without the cache");
  });

  it("store_without_get_falls_back_to_full_rebuild", async () => {
    const { store, counts } = countingStore(createMemorySessionStore(), { withGet: false });
    const session = new RuntimeAgentSession({ agent: await testAgent(), id: "noget", store, snapshotCacheTtlMs: 1 });
    await session.appendEntry(message("noget", undefined, "user", "one"));
    await session.snapshot();
    const before = counts.readBranchPath;
    await sleep(5);
    await session.snapshot();
    assert.equal(counts.readBranchPath - before, 1, "no get: the expired cache rebuilds from the branch");
  });

  it("ttl_zero_still_reads_every_snapshot", async () => {
    const { store, counts } = countingStore(createMemorySessionStore());
    const session = new RuntimeAgentSession({ agent: await testAgent(), id: "zero", store, snapshotCacheTtlMs: 0 });
    await session.appendEntry(message("zero", undefined, "user", "one"));
    await session.snapshot();
    await session.appendEntry(message("zero", session.leafId, "assistant", "two"));
    const before = counts.readBranchPath;
    await session.snapshot();
    await session.snapshot();
    assert.equal(counts.readBranchPath - before, 2, "TTL 0: every snapshot reads the store, own appends included");
    assert.equal(counts.get, 0, "TTL 0 never revalidates");
  });

  it("append_conflict_invalidates_snapshot", async () => {
    const memory = createMemorySessionStore();
    const { store, counts } = countingStore(memory);
    let conflict = false;
    const conflicting: SessionStore = {
      ...store,
      async append(entry, options) {
        if (conflict)
          throw new SessionAppendConflictError({ code: "session_append_conflict", expectedParentId: options?.expectedParentId });
        return store.append(entry, options);
      },
    };
    const session = new RuntimeAgentSession({ agent: await testAgent(), id: "conflict", store: conflicting, snapshotCacheTtlMs: 30_000 });
    await session.appendEntry(message("conflict", undefined, "user", "one"));
    const cached = await session.snapshot();
    conflict = true;
    await assert.rejects(session.appendEntry(message("conflict", session.leafId, "assistant", "two")), SessionAppendConflictError);
    const before = counts.readBranchPath;
    const after = await session.snapshot();
    assert.equal(counts.readBranchPath - before, 1, "a conflict drops the cache, so the next snapshot re-reads");
    assert.deepEqual(after, cached);
  });

  it("estimate_turn_usage_memo_matches_uncached", async () => {
    const requests: Message[][] = [];
    let turns = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        turns += 1;
        requests.push([...request.messages]);
        yield providerTextDelta(`reply ${turns} ${"x".repeat(turns * 17)}`);
        yield providerDone(); // no usage: the kernel estimates
      },
    };
    const agent = await createAgent({ model: { provider: "mock", model: "claude-demo" }, packages: [providerPackage("p", [provider])] });
    const session = await agent.session();
    const estimates: number[] = [];
    for (let run = 0; run < 6; run += 1) {
      const result = await session.run(`question ${run} ${"漢字".repeat(run)}`);
      estimates.push(result.usage?.inputTokens ?? Number.NaN);
    }
    const uncached = requests.map((messages) => estimateMessageTokens(messages, "claude-demo").tokens);
    assert.deepEqual(estimates, uncached, "memoized per-message estimates sum to the uncached estimate");
  });
});
