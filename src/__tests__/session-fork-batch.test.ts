import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type CompactionEntryData,
  type Compactor,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  isSessionAppendConflict,
  type Message,
  type SessionEntry,
  type SessionStore,
  sessionEntryForkedFrom,
  sessionStoreCapabilities,
} from "../index.js";
import { mockProvider, storeConformance } from "../testing/index.js";

/** Plan 230 Task 5: `fork()` is atomic and batched. */

const MODEL = { provider: "mock", model: "demo" } as const;

type Calls = { append: number; appendMany: number; deleteSession: number };

/** Wraps a memory store; `without` drops optional methods, `failAppendAt` fails the n-th `append` (1-based). */
function wrappedStore(
  inner: SessionStore,
  options: { without?: readonly ("appendMany" | "deleteSession")[]; failAppendAt?: number; breakLastOfBatch?: boolean } = {},
): { store: SessionStore; calls: Calls } {
  const calls: Calls = { append: 0, appendMany: 0, deleteSession: 0 };
  const store: SessionStore = {
    tipCheck: inner.tipCheck,
    async append(entry, appendOptions) {
      calls.append += 1;
      if (calls.append === options.failAppendAt) throw new Error("append boom");
      await inner.append(entry, appendOptions);
    },
    list: (id) => inner.list(id),
    get: (id) => inner.get!(id),
    readBranchPath: (query) => inner.readBranchPath!(query),
    listSessions: (query) => inner.listSessions!(query),
  };
  if (!options.without?.includes("appendMany")) {
    store.appendMany = async (entries, manyOptions) => {
      calls.appendMany += 1;
      // The last entry names a parent the store does not hold, so the store rejects the whole batch.
      const batch = options.breakLastOfBatch
        ? entries.map((entry, index) => (index === entries.length - 1 ? { ...entry, parentId: "not-there" } : entry))
        : entries;
      await inner.appendMany!(batch, manyOptions);
    };
  }
  if (!options.without?.includes("deleteSession")) {
    store.deleteSession = async (sessionId, scope) => {
      calls.deleteSession += 1;
      return inner.deleteSession!(sessionId, scope);
    };
  }
  return { store, calls };
}

/** Keeps the newest `keep` entries and pins the first message. */
function keepLast(keep: number): Compactor {
  return {
    name: "keep-last",
    compact(context) {
      const through = context.entries.at(-keep - 1);
      const kept = context.entries.slice(-keep).map((entry) => entry.id);
      const pinned = context.entries.find((entry) => entry.kind === "message")?.id;
      return {
        summary: "summary",
        entries: [
          createSessionEntry({
            sessionId: context.sessionId,
            kind: "compaction",
            summary: "summary",
            data: { throughEntryId: through?.id, keepEntryIds: [...(pinned ? [pinned] : []), ...kept], firstKeptEntryId: kept[0] },
          }),
        ],
      };
    },
  };
}

async function sessionOn(store: SessionStore, id = "src", compactor?: Compactor): Promise<RuntimeAgentSession> {
  const agent = await createAgent({
    model: MODEL,
    packages: [mockProvider()],
    slots: { store, ...(compactor ? { compaction: compactor } : {}) },
  });
  return new RuntimeAgentSession({ agent, id, store, snapshotCacheTtlMs: 0 });
}

const text = (role: Message["role"], value: string): Message => ({ role, content: [{ type: "text", text: value }] }) as Message;

async function say(session: RuntimeAgentSession, value: string, metadata?: Record<string, unknown>): Promise<void> {
  await session.appendEntry(
    createSessionEntry({
      sessionId: session.id,
      parentId: session.leafId,
      kind: "message",
      message: text("user", value),
      ...(metadata ? { metadata } : {}),
    }),
  );
}

async function sessionIds(store: SessionStore): Promise<string[]> {
  return (await store.listSessions!({ limit: 50 })).items.map((item) => item.sessionId).sort();
}

/** An entry without the ids a fork rewrites, and without the fork lineage it stamps (plan 218.3 Task 4). */
const content = ({ id: _id, parentId: _parentId, sessionId: _sessionId, metadata, ...rest }: SessionEntry) => {
  const { forkedFrom: _forkedFrom, ...kept } = metadata ?? {};
  return { ...rest, ...(Object.keys(kept).length ? { metadata: kept } : {}) };
};

describe("fork() is atomic and batched (plan 230 Task 5)", () => {
  it("fork_uses_one_batch_append", async () => {
    const { store, calls } = wrappedStore(createMemorySessionStore());
    const session = await sessionOn(store);
    for (let i = 0; i < 20; i += 1) await say(session, `m${i}`);
    const appendsBefore = calls.append;
    const forked = await session.fork();
    assert.equal(calls.appendMany, 1);
    assert.equal(calls.append, appendsBefore, "fork must not append entry by entry when the store has appendMany");
    assert.equal((await store.list(forked.id)).length, 20);
  });

  it("forked_branch_equals_source_branch", async () => {
    const store = createMemorySessionStore();
    const session = await sessionOn(store);
    await say(session, "a", { tenantId: "t1" });
    await say(session, "b", { tenantId: "t1" });
    await session.appendEntry(createSessionEntry({ sessionId: session.id, parentId: session.leafId, kind: "label", label: "mark" }));
    await say(session, "c", { tenantId: "t1" });
    const forked = await session.fork();
    const source = await store.list(session.id);
    const copy = await store.list(forked.id);
    assert.deepEqual(copy.map(content), source.map(content), "content, order, and ownership stamps carry over");
    // The copy is a linear chain inside the new session.
    for (const [index, entry] of copy.entries()) assert.equal(entry.parentId, index === 0 ? undefined : copy[index - 1]?.id);
    assert.deepEqual(await forked.messages(), await session.messages());
  });

  it("fork_stamps_each_copy_with_its_source_ids", async () => {
    const store = createMemorySessionStore();
    const session = await sessionOn(store);
    await say(session, "a");
    await say(session, "b", { tenantId: "t1" });
    const source = await store.list(session.id);
    const forked = await session.fork();
    const copy = await store.list(forked.id);
    assert.deepEqual(
      copy.map(sessionEntryForkedFrom),
      source.map((entry) => [entry.id]),
      "each copy names its source id",
    );
    assert.equal(copy[1]?.metadata?.tenantId, "t1", "other metadata carries over");
    assert.deepEqual(source.map(sessionEntryForkedFrom), [[], []], "an entry written in its own session has no lineage");
    // A fork of the fork keeps the whole lineage, oldest first.
    const again = await (forked as RuntimeAgentSession).fork();
    const second = await store.list(again.id);
    assert.deepEqual(
      second.map(sessionEntryForkedFrom),
      source.map((entry, index) => [entry.id, copy[index]!.id]),
    );
  });

  it("failed_batch_writes_nothing", async () => {
    const inner = createMemorySessionStore();
    const { store } = wrappedStore(inner, { breakLastOfBatch: true });
    const session = await sessionOn(store);
    for (let i = 0; i < 5; i += 1) await say(session, `m${i}`);
    await assert.rejects(
      session.fork(),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "not-there",
    );
    assert.deepEqual(await sessionIds(inner), ["src"], "a failed batch leaves no forked session");
  });

  it("fork_without_append_many_cleans_up_on_failure", async () => {
    const inner = createMemorySessionStore();
    const seed = await sessionOn(inner);
    for (let i = 0; i < 5; i += 1) await say(seed, `m${i}`);

    // With deleteSession: the partial copy is removed and the original error surfaces.
    const cleaning = wrappedStore(inner, { without: ["appendMany"], failAppendAt: 3 });
    const source = await sessionOn(cleaning.store);
    await assert.rejects(source.fork(), /append boom/);
    assert.equal(cleaning.calls.deleteSession, 1);
    assert.deepEqual(await sessionIds(inner), ["src"]);

    // Without deleteSession: the error names the partial session it left.
    const plain = wrappedStore(inner, { without: ["appendMany", "deleteSession"], failAppendAt: 3 });
    const other = await sessionOn(plain.store);
    let partial: string | undefined;
    await assert.rejects(other.fork(), (error: unknown) => {
      const match = /partial session (\S+) was left in the store/.exec((error as Error).message);
      partial = match?.[1];
      return partial !== undefined && (error as Error).cause instanceof Error;
    });
    assert.equal((await inner.list(partial!)).length, 2);

    // A failure on the first append leaves nothing, so the original error is rethrown as is.
    const first = wrappedStore(inner, { without: ["appendMany", "deleteSession"], failAppendAt: 1 });
    await assert.rejects((await sessionOn(first.store)).fork(), /^Error: append boom$/);
  });

  it("fork_of_a_compacted_session_keeps_its_messages", async () => {
    const store = createMemorySessionStore();
    const session = await sessionOn(store, "src", keepLast(2));
    for (let i = 0; i < 6; i += 1) await say(session, `m${i}`);
    await session.compact();
    await say(session, "after");
    const forked = await session.fork();
    const messages = await forked.messages();
    assert.ok(messages.length > 0);
    assert.deepEqual(messages, await session.messages());

    const copy = await store.list(forked.id);
    const ids = new Set(copy.map((entry) => entry.id));
    const compaction = copy.find((entry) => entry.kind === "compaction");
    const data = compaction?.data as CompactionEntryData & { firstKeptEntryId?: string };
    assert.ok(data.throughEntryId && ids.has(data.throughEntryId), "throughEntryId names the fork's copy");
    assert.ok(
      data.keepEntryIds?.every((id) => ids.has(id)),
      "keepEntryIds name the fork's copies",
    );
    assert.ok(data.firstKeptEntryId && ids.has(data.firstKeptEntryId));
    assert.ok(data.checkpoint, "the source compaction carried a checkpoint");
    assert.ok(data.checkpoint.pinnedEntryIds.length > 0 && data.checkpoint.pinnedEntryIds.every((id) => ids.has(id)));
    assert.equal(data.checkpoint.branchLength, copy.indexOf(compaction!));
    // The fork's tail read stops at its own compaction instead of reading the whole branch.
    const tail = await store.readBranchPath!({ sessionId: forked.id, leafId: copy.at(-1)?.id, from: "compaction" });
    assert.ok(tail.items.length < copy.length);
  });

  it("inspect_reports_append_many", () => {
    assert.ok(sessionStoreCapabilities(createMemorySessionStore()).includes("appendMany"));
    const { store } = wrappedStore(createMemorySessionStore(), { without: ["appendMany"] });
    assert.ok(!sessionStoreCapabilities(store).includes("appendMany"));
  });

  it("store_conformance_append_many", async () => {
    await storeConformance(() => createMemorySessionStore());
    // A store whose batch is not atomic fails the leg.
    await assert.rejects(
      storeConformance(() => {
        const inner = createMemorySessionStore();
        return {
          ...inner,
          append: inner.append.bind(inner),
          list: inner.list.bind(inner),
          async appendMany(entries) {
            for (const entry of entries)
              await inner.append(entry, entry.parentId === undefined ? undefined : { expectedParentId: entry.parentId });
          },
        };
      }),
      /\[append-many\]/,
    );
  });
});
