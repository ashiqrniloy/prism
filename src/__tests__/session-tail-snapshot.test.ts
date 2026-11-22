import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type AgentEvent,
  askEveryTool,
  type CompactionContext,
  type Compactor,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  type Message,
  providerDone,
  providerTextDelta,
  rebuildSessionContext,
  type SessionEntry,
  type SessionStore,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { foldExternalState } from "../session/external-state.js";
import { SessionStateStore } from "../session/state.js";
import { readSessionSnapshot, snapshotTail } from "../session-stores.js";
import { mockProvider, storeConformance } from "../testing/index.js";

/** Plan 230 Task 3: the run path reads the branch from its newest compaction on; a checkpoint stands for the rest. */

const MODEL = { provider: "mock", model: "demo" } as const;

type Counts = { readBranchPath: number; list: number; entries: number };

function countingStore(
  inner: SessionStore,
  options: { ignoreFrom?: boolean; noReader?: boolean } = {},
): { store: SessionStore; counts: Counts } {
  const counts: Counts = { readBranchPath: 0, list: 0, entries: 0 };
  const store: SessionStore = {
    tipCheck: inner.tipCheck,
    append: (entry, appendOptions) => inner.append(entry, appendOptions),
    get: (id) => inner.get!(id),
    async list(sessionId) {
      counts.list += 1;
      const entries = await inner.list(sessionId);
      counts.entries += entries.length;
      return entries;
    },
  };
  if (!options.noReader) {
    store.readBranchPath = async (query) => {
      counts.readBranchPath += 1;
      const page = await inner.readBranchPath!(options.ignoreFrom ? { ...query, from: undefined } : query);
      counts.entries += page.items.length;
      return page;
    };
  }
  return { store, counts };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Summarizes up to a random entry and keeps a random mix of entries on both sides of it. */
function randomCompactor(rand: () => number): Compactor {
  let n = 0;
  return {
    name: "random",
    compact(context: CompactionContext) {
      n += 1;
      const entries = context.entries;
      const throughIndex = Math.floor(rand() * entries.length);
      const keepEntryIds = entries.filter((_, index) => index !== throughIndex && rand() < 0.25).map((entry) => entry.id);
      const summary = `summary ${n}`;
      return {
        summary,
        entries: [
          createSessionEntry({
            sessionId: context.sessionId,
            kind: "compaction",
            summary,
            data: { throughEntryId: entries[throughIndex]?.id, keepEntryIds, strategy: "random" },
          }),
        ],
      };
    },
  };
}

/** Keeps the newest `keep` entries: summarizes everything before them. */
function keepLast(keep: number, pin: (entries: readonly SessionEntry[]) => readonly string[] = () => []): Compactor {
  return {
    name: "keep-last",
    compact(context) {
      const through = context.entries.at(-keep - 1);
      const kept = context.entries.slice(-keep).map((entry) => entry.id);
      return {
        summary: "summary",
        entries: [
          createSessionEntry({
            sessionId: context.sessionId,
            kind: "compaction",
            summary: "summary",
            data: { throughEntryId: through?.id, keepEntryIds: [...pin(context.entries), ...kept] },
          }),
        ],
      };
    },
  };
}

async function sessionWith(store: SessionStore, compactor: Compactor, id = "s"): Promise<RuntimeAgentSession> {
  const agent = await createAgent({ model: MODEL, packages: [mockProvider()], slots: { store, compaction: compactor } });
  return new RuntimeAgentSession({ agent, id, store, snapshotCacheTtlMs: 0 });
}

const text = (role: Message["role"], value: string): Message => ({ role, content: [{ type: "text", text: value }] }) as Message;

async function say(session: RuntimeAgentSession, value: string, role: Message["role"] = "user"): Promise<void> {
  await session.appendEntry(
    createSessionEntry({ sessionId: session.id, parentId: session.leafId, kind: "message", message: text(role, value) }),
  );
}

async function setState(session: RuntimeAgentSession, key: string, value: number, op: "set" | "append" = "set"): Promise<void> {
  await session.appendEntry(
    createSessionEntry({
      sessionId: session.id,
      parentId: session.leafId,
      kind: "package_state",
      data: { schemaVersion: 1, package: "pkg", key, value, op },
    }),
  );
}

function stateOf(entries: readonly SessionEntry[], base: Parameters<SessionStateStore["hydrate"]>[1] = []) {
  const state = new SessionStateStore({ append: async () => undefined, ready: async () => undefined, redact: (value) => value });
  state.hydrate(entries, base);
  return ["a", "b", "c"].map((key) => ({ value: state.read("pkg", key), records: state.readRecords("pkg", key) }));
}

const sortTotals = (totals: ReturnType<typeof foldExternalState>) => [...totals].sort((a, b) => a.key.localeCompare(b.key));

async function full(store: SessionStore, session: RuntimeAgentSession) {
  return rebuildSessionContext(await store.list(session.id), { leafId: session.leafId });
}

describe("tail snapshot (plan 230 Task 3)", () => {
  it("tail_snapshot_equals_full_snapshot", async () => {
    let tails = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const rand = mulberry32(seed);
      const store = createMemorySessionStore();
      const session = await sessionWith(store, randomCompactor(rand));
      const compactions = Math.floor(rand() * 4);
      const steps = 25 + Math.floor(rand() * 20);
      const compactAt = new Set(Array.from({ length: compactions }, () => 1 + Math.floor(rand() * (steps - 1))));
      for (let step = 0; step < steps; step += 1) {
        const pick = rand();
        if (pick < 0.55) await say(session, `m${step}`, rand() < 0.5 ? "user" : "assistant");
        else if (pick < 0.65)
          await session.appendEntry(
            createSessionEntry({ sessionId: session.id, parentId: session.leafId, kind: "summary", summary: `s${step}` }),
          );
        else if (pick < 0.85) await setState(session, ["a", "b", "c"][step % 3]!, step, rand() < 0.5 ? "set" : "append");
        else await session.externalState("vendor", ["x", "y"][step % 2]!).append([{ step }]);
        if (compactAt.has(step)) await session.compact();
      }
      const tail = await readSessionSnapshot(store, { sessionId: session.id, leafId: session.leafId });
      const whole = await full(store, session);
      assert.deepEqual(tail.messages, whole.messages, `seed ${seed}: messages`);
      assert.deepEqual(tail.summaries, whole.summaries, `seed ${seed}: summaries`);
      assert.equal(tail.leafId, whole.leafId, `seed ${seed}: leaf`);
      assert.equal(snapshotTail(tail).branchLength, whole.entries.length, `seed ${seed}: branch length`);
      const source = snapshotTail(tail);
      assert.deepEqual(stateOf(source.entries, source.packageState), stateOf(whole.entries), `seed ${seed}: package state`);
      assert.deepEqual(
        sortTotals(foldExternalState(source.entries, source.externalState)),
        sortTotals(foldExternalState(whole.entries)),
        `seed ${seed}: external state`,
      );
      if (tail.entries.length < whole.entries.length) tails += 1;
    }
    assert.ok(tails >= 10, `the corpus must exercise real tails, got ${tails}`);
  });

  it("tail_read_returns_no_entry_before_the_compaction_except_kept_and_required", async () => {
    const store = createMemorySessionStore();
    // Pins the first message, the way the coding compactor re-pins a plan turn.
    const session = await sessionWith(
      store,
      keepLast(2, (entries) => [entries[0]!.id]),
    );
    for (let index = 0; index < 20; index += 1) await say(session, `m${index}`);
    await session.compact();
    await say(session, "after");
    const ids = (await store.list(session.id)).map((entry) => entry.id);
    const read = await store.readBranchPath!({ sessionId: session.id, leafId: session.leafId, from: "compaction" });
    // The pinned first message, then throughEntryId (m17), the two kept, the compaction, and what follows.
    assert.deepEqual(
      read.items.map((entry) => entry.id),
      [ids[0], ids[17], ids[18], ids[19], ids[20], ids[21]],
    );
  });

  it("store_without_tail_read_falls_back", async () => {
    for (const options of [{ ignoreFrom: true }, { noReader: true }]) {
      const inner = createMemorySessionStore();
      const { store, counts } = countingStore(inner, options);
      const session = await sessionWith(store, keepLast(2));
      for (let index = 0; index < 10; index += 1) await say(session, `m${index}`);
      await session.compact();
      await say(session, "after");
      const before = counts.readBranchPath + counts.list;
      const snapshot = await session.snapshot();
      assert.equal(counts.readBranchPath + counts.list - before, 1, "one read: the store's whole branch is used as is");
      assert.deepEqual(snapshot.messages, (await full(inner, session)).messages);
      assert.equal(snapshot.entries.length, 12, "the whole branch");
    }
  });

  it("compaction_without_checkpoint_falls_back_to_full_read", async () => {
    const inner = createMemorySessionStore();
    const { store, counts } = countingStore(inner);
    const session = await sessionWith(store, keepLast(2));
    for (let index = 0; index < 10; index += 1) await say(session, `m${index}`);
    const branch = await inner.list(session.id);
    // A compaction written before plan 230: no checkpoint.
    await session.appendEntry(
      createSessionEntry({
        sessionId: session.id,
        parentId: session.leafId,
        kind: "compaction",
        summary: "legacy",
        data: { throughEntryId: branch[7]!.id, keepEntryIds: [branch[8]!.id, branch[9]!.id] },
      }),
    );
    await say(session, "after");
    counts.entries = 0;
    const snapshot = await session.snapshot();
    assert.equal(counts.entries, 5 + 12, "the tail, then the whole branch");
    const whole = await full(inner, session);
    assert.deepEqual(snapshot.messages, whole.messages);
    assert.equal(snapshot.entries.length, whole.entries.length);
    assert.equal(snapshotTail(snapshot).branchLength, 12);
  });

  it("entry_count_still_counts_the_whole_branch", async () => {
    const store = createMemorySessionStore();
    const counts: number[] = [];
    const agent = await createAgent({
      model: MODEL,
      packages: [mockProvider()],
      slots: { store, compaction: keepLast(2) },
      compaction: { thresholdEntries: 1_000 },
      hooks: (hooks) =>
        hooks.on("compaction.when", (payload) => {
          counts.push(payload.entryCount);
          return undefined;
        }),
    });
    const session = (await agent.session({ id: "count", create: true })) as RuntimeAgentSession;
    for (let index = 0; index < 30; index += 1) await say(session, `m${index}`);
    await session.compact();
    await say(session, "after");
    const snapshot = await session.snapshot();
    assert.ok(snapshot.entries.length < 10, "the snapshot is the tail");
    assert.equal(snapshotTail(snapshot).branchLength, 32);
    await session.run("go");
    assert.equal(counts[0], 33, "compaction.when sees the whole branch: 32 entries and the run's input");
  });

  it("session_open_reads_the_tail", async () => {
    const inner = createMemorySessionStore();
    const writer = await sessionWith(inner, keepLast(2), "open");
    for (let index = 0; index < 50; index += 1) await say(writer, `m${index}`);
    await setState(writer, "a", 7);
    await writer.compact();
    await say(writer, "after");
    const { store, counts } = countingStore(inner);
    const agent = await createAgent({ model: MODEL, packages: [mockProvider()], slots: { store } });
    const session = (await agent.session({ id: "open" })) as RuntimeAgentSession;
    assert.equal(counts.readBranchPath, 1, "one read at open");
    assert.equal(counts.entries, 5, "throughEntryId, two kept, the compaction, and one after it");
    assert.deepEqual(await session.messages(), (await full(inner, session)).messages);
    assert.equal(counts.readBranchPath, 1, "the open's read is the first snapshot");
  });

  it("package_state_before_compaction_is_still_hydrated", async () => {
    const store = createMemorySessionStore();
    const writer = await sessionWith(store, keepLast(2), "state");
    await setState(writer, "a", 1);
    await setState(writer, "b", 10, "append");
    for (let index = 0; index < 10; index += 1) await say(writer, `m${index}`);
    await setState(writer, "a", 2);
    await setState(writer, "b", 11, "append");
    for (let index = 10; index < 15; index += 1) await say(writer, `m${index}`);
    await writer.compact();
    await setState(writer, "b", 12, "append");
    const snapshot = await readSessionSnapshot(store, { sessionId: "state", leafId: writer.leafId });
    assert.ok(snapshot.entries.length < 6);
    const source = snapshotTail(snapshot);
    const [a, b] = stateOf(source.entries, source.packageState);
    assert.equal(a?.value, 2);
    assert.deepEqual(b?.records, [10, 11, 12]);
  });

  it("external_state_write_does_not_read_the_branch", async () => {
    const inner = createMemorySessionStore();
    const { store, counts } = countingStore(inner);
    const agent = await createAgent({ model: MODEL, packages: [mockProvider()], slots: { store, compaction: keepLast(2) } });
    const session = new RuntimeAgentSession({ agent, id: "ext", store });
    for (let index = 0; index < 10; index += 1) await say(session, `m${index}`);
    await session.compact();
    const handle = session.externalState("vendor", "k");
    await handle.append([1]);
    const reads = counts.readBranchPath + counts.list;
    for (let index = 0; index < 5; index += 1) await handle.append([index]);
    assert.equal(counts.readBranchPath + counts.list, reads, "the cached snapshot and its checkpoint answer the caps");
    assert.deepEqual(await handle.load(), [1, 0, 1, 2, 3, 4]);
  });

  it("external_state_caps_count_records_before_the_compaction", async () => {
    const store = createMemorySessionStore();
    const session = await sessionWith(store, keepLast(2), "caps");
    const handle = session.externalState("vendor", "k");
    await handle.append(Array.from({ length: 9_998 }, (_, index) => index));
    for (let index = 0; index < 10; index += 1) await say(session, `m${index}`);
    await session.compact();
    const snapshot = await session.snapshot();
    assert.ok(!snapshot.entries.some((entry) => entry.kind === "external_state"), "the archive is before the tail");
    await handle.append([1, 2]);
    await assert.rejects(handle.append([3]), (error: { code?: string }) => error.code === "external_state_limit");
    const seqs = (await store.list("caps")).flatMap((entry) =>
      entry.kind === "external_state" ? [(entry.data as { seq: number }).seq] : [],
    );
    assert.deepEqual(seqs, [1, 2], "seq continues from the checkpoint");
  });

  it("pending_suspension_before_compaction_is_still_found", async () => {
    const store = createMemorySessionStore();
    let turn = 0;
    const executed: string[] = [];
    const build = () =>
      createAgent({
        id: "tail-resume",
        model: MODEL,
        slots: { store, compaction: keepLast(2) },
        hooks: askEveryTool(),
        packages: [
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate() {
                turn += 1;
                if (turn === 1) {
                  yield { type: "tool_call" as const, call: toolCallContent("call-1", "write", {}) };
                  yield providerDone();
                  return;
                }
                yield providerTextDelta("finished");
                yield providerDone();
              },
            },
          ]),
        ],
        tools: {
          add: [
            {
              name: "write",
              parameters: { type: "object", properties: {} },
              execute: (_args, context) => {
                executed.push(context.toolCallId);
                return { toolCallId: context.toolCallId, name: "write", value: "done" };
              },
            },
          ],
        },
      });
    const first = (await (await build()).session({ id: "susp", create: true })) as RuntimeAgentSession;
    for (let index = 0; index < 10; index += 1) await say(first, `m${index}`);
    await first.compact();
    const suspended = await first.run("go");
    assert.equal(suspended.status, "suspended");
    const reopened = await (await build()).session({ id: "susp" });
    const events: AgentEvent[] = [];
    const decisions = (suspended.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const }));
    for await (const event of reopened.resume(decisions)) events.push(event);
    assert.deepEqual(executed, ["call-1"], "the reopened session found the suspension at its tip");
  });

  it("store_conformance_tail_read", async () => {
    await storeConformance(() => createMemorySessionStore());
  });

  it("compaction_reads_tail_not_full_branch", async () => {
    const inner = createMemorySessionStore();
    const { store, counts } = countingStore(inner);
    const session = await sessionWith(store, keepLast(2), "compact-tail");
    for (let index = 0; index < 30; index += 1) await say(session, `m${index}`);
    await session.compact();
    for (let index = 30; index < 40; index += 1) await say(session, `m${index}`);
    counts.readBranchPath = 0;
    counts.list = 0;
    counts.entries = 0;
    await session.compact();
    assert.ok(counts.entries < 20, `second compaction must read only the tail, not all 40+ entries (read ${counts.entries})`);
  });

  it("session_releases_per_run_objects_after_run_ends", async () => {
    const store = createMemorySessionStore();
    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              yield providerTextDelta("x".repeat(4_096));
              yield providerDone();
            },
          },
        ]),
      ],
      slots: { store },
    });
    const session = (await agent.session({ id: "cleanup", create: true })) as RuntimeAgentSession;
    await session.run("hello");
    assert.deepEqual(session.activeRunMessages, []);
    assert.deepEqual(session.activeRunSkills, []);
    assert.equal(session.tailSegments.size, 0);
    assert.equal(session.activeDurable, undefined);
  });
});
