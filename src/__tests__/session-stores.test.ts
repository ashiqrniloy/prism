import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BranchReader, SessionEntry } from "../index.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, listSessionBranches, rebuildSessionContext, SESSION_APPEND_CONFLICT_CODE, SessionAppendConflictError, isSessionAppendConflict } from "../index.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const userMessage = { role: "user" as const, content: [{ type: "text" as const, text: "Hi" }] };
const assistantMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hello" }] };

function entry(id: string, parentId?: string): SessionEntry {
  return createSessionEntry({
    id,
    parentId,
    sessionId: "s1",
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "message",
    message: id === "a" ? userMessage : assistantMessage,
  });
}

describe("session store helpers", () => {
  it("session entry helper creates typed label model custom summary and compaction entries", () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const createId = () => "entry_1";
    const entries = [
      createSessionEntry({ sessionId: "s1", kind: "label", label: "investigation", createId, now }),
      createSessionEntry({ id: "model", sessionId: "s1", kind: "model_change", model: { provider: "mock", model: "next" }, now }),
      createSessionEntry({ id: "custom", sessionId: "s1", kind: "custom", data: { ok: true }, now }),
      createSessionEntry({ id: "summary", sessionId: "s1", kind: "summary", summary: "Short recap", now }),
      createSessionEntry({ id: "compact", sessionId: "s1", kind: "compaction", summary: "Compacted", data: { through: "summary" }, now }),
    ];

    assert.equal(entries[0]?.id, "entry_1");
    assert.equal(entries[0]?.timestamp, "2026-01-01T00:00:00.000Z");
    assert.equal(entries[1]?.model?.model, "next");
    assert.deepEqual(entries.map((item) => item.kind), ["label", "model_change", "custom", "summary", "compaction"]);
  });

  it("rebuild session context uses only current leaf path", () => {
    const entries = [entry("a"), entry("b", "a"), entry("c", "a")];

    const snapshot = rebuildSessionContext(entries, { leafId: "c" });

    assert.deepEqual(snapshot.entries.map((item) => item.id), ["a", "c"]);
    assert.deepEqual(snapshot.messages, [userMessage, assistantMessage]);
  });

  it("list session branches returns leaf paths without mutating entries", () => {
    const entries = [entry("a"), entry("b", "a"), entry("c", "a")];
    const before = entries.map((item) => ({ ...item }));

    const branches = listSessionBranches(entries);

    assert.deepEqual(branches.map((branch) => branch.leafId), ["b", "c"]);
    assert.deepEqual(branches.map((branch) => branch.entries.map((item) => item.id)), [["a", "b"], ["a", "c"]]);
    assert.deepEqual(entries, before);
  });

  it("rebuild session context rejects missing parent or duplicate id", () => {
    assert.throws(() => getSessionBranchEntries([entry("a"), entry("a")]), /Duplicate session entry id: a/);
    assert.throws(() => rebuildSessionContext([entry("a", "missing")]), /Missing session parent: missing/);
  });

  it("memory session store round trips all entry kinds", async () => {
    const entries = [
      entry("message"),
      createSessionEntry({ id: "event", sessionId: "s1", kind: "event", event: { type: "agent_started", sessionId: "s1", runId: "r1" } }),
      createSessionEntry({ id: "summary", sessionId: "s1", kind: "summary", summary: "recap" }),
      createSessionEntry({ id: "metadata", sessionId: "s1", kind: "metadata", data: { ok: true } }),
      createSessionEntry({ id: "model", sessionId: "s1", kind: "model_change", model: { provider: "mock", model: "next" } }),
      createSessionEntry({ id: "label", sessionId: "s1", kind: "label", label: "demo" }),
      createSessionEntry({ id: "custom", sessionId: "s1", kind: "custom", data: { custom: true } }),
      createSessionEntry({ id: "compaction", sessionId: "s1", kind: "compaction", summary: "short" }),
    ];
    const store = createMemorySessionStore(entries.slice(0, 1));
    for (const item of entries.slice(1)) await store.append(item);

    assert.deepEqual((await store.list("s1")).map((item) => item.kind), ["message", "event", "summary", "metadata", "model_change", "label", "custom", "compaction"]);
    assert.equal((await store.get?.("custom"))?.id, "custom");
  });

  it("memory session store isolates session ids", async () => {
    const store = createMemorySessionStore([entry("a")]);
    await store.append(createSessionEntry({ id: "other", sessionId: "s2", kind: "custom" }));

    assert.deepEqual((await store.list("s1")).map((item) => item.id), ["a"]);
    assert.deepEqual((await store.list("s2")).map((item) => item.id), ["other"]);
  });

  it("memory session store rejects duplicate entry ids", async () => {
    const store = createMemorySessionStore([entry("a")]);

    await assert.rejects(store.append(entry("a")), /Duplicate session entry id: a/);
    assert.throws(() => createMemorySessionStore([entry("a"), entry("a")]), /Duplicate session entry id: a/);
  });

  it("memory session store list and get return defensive copies", async () => {
    const original = createSessionEntry({
      id: "a",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "Hi" }] },
    });
    const store = createMemorySessionStore([original]);
    const list = await store.list("s1") as unknown as SessionEntry[];
    list.length = 0;
    assert.equal((await store.list("s1")).length, 1);

    const list2 = await store.list("s1") as unknown as Mutable<SessionEntry>[];
    list2[0]!.id = "mutated";
    ((list2[0]!.message!.content as unknown) as { type: string; text: string }[])[0] = { type: "text", text: "mutated" };
    assert.equal((await store.get?.("a"))?.id, "a");

    const got = await store.get?.("a") as unknown as Mutable<SessionEntry> | undefined;
    if (got?.kind === "message" && got.message) {
      (got.message.content as unknown as { type: string; text: string }[])[0] = { type: "text", text: "mutated" };
    }
    const refetched = await store.get?.("a");
    assert.equal(
      refetched?.kind === "message" && refetched.message
        ? (refetched.message.content[0] as { text: string }).text
        : undefined,
      "Hi",
    );
  });

  it("getSessionBranchEntries returns defensive copies", () => {
    const entries = [entry("a"), entry("b", "a")];
    const branch = [...getSessionBranchEntries(entries, { leafId: "b" })] as unknown as Mutable<SessionEntry>[];
    branch[0]!.id = "mutated";
    (branch[0]!.message!.content as unknown as { type: string; text: string }[])[0] = { type: "text", text: "mutated" };
    assert.equal(entries[0]!.id, "a");
    assert.equal((entries[0]!.message!.content[0] as { text: string }).text, "Hi");
  });

  it("rebuildSessionContext returns defensive copies", () => {
    const entries = [entry("a"), entry("b", "a")];
    const snapshot = rebuildSessionContext(entries, { leafId: "b" });
    (snapshot.entries as unknown as Mutable<SessionEntry>[])[0]!.id = "mutated";
    (((snapshot.messages[0]!.content as unknown) as { type: string; text: string }[])[0]) = { type: "text", text: "mutated" };
    assert.equal(entries[0]!.id, "a");
    assert.equal((entries[0]!.message!.content[0] as { text: string }).text, "Hi");
  });

  it("memory session store preserves branch parent links", async () => {
    const store = createMemorySessionStore([entry("a"), entry("b", "a"), entry("c", "a")]);

    assert.deepEqual(listSessionBranches(await store.list("s1")).map((branch) => branch.leafId), ["b", "c"]);
  });
});

describe("branch reader overloads (DB-friendly path)", () => {
  it("getSessionBranchEntries(reader) returns the ancestor chain in order across pages", async () => {
    const a = entry("a");
    const b = entry("b", "a");
    const c = entry("c", "b");
    const queries: Parameters<BranchReader>[0][] = [];
    // reader yields leaf-first, across two pages, to prove ordering + pagination tolerance
    const reader: BranchReader = async (query) => {
      queries.push(query);
      if (!query.cursor) return { items: [c, b], nextCursor: "p2" };
      return { items: [a] };
    };
    const branch = await getSessionBranchEntries(reader, { sessionId: "s1", leafId: "c", limit: 2 });
    assert.deepEqual(branch.map((e) => e.id), ["a", "b", "c"]);
    assert.deepEqual(queries, [
      { sessionId: "s1", leafId: "c", limit: 2 },
      { sessionId: "s1", leafId: "c", limit: 2, cursor: "p2" },
    ]);
  });

  it("getSessionBranchEntries(reader) still rejects a missing parent", async () => {
    const c = entry("c", "b"); // b never returned -> broken chain
    const reader = async () => ({ items: [c] });
    await assert.rejects(() => getSessionBranchEntries(reader, { sessionId: "s1", leafId: "c" }), /Missing session parent: b/);
  });

  it("rebuildSessionContext(reader) yields the same snapshot as the sync path", async () => {
    const a = entry("a");
    const b = entry("b", "a");
    const all = [a, b];
    const reader = async () => ({ items: [b, a] });
    const viaReader = await rebuildSessionContext(reader, { sessionId: "s1", leafId: "b" });
    const viaSync = rebuildSessionContext(all, { leafId: "b" });
    assert.deepEqual(viaReader.messages, viaSync.messages);
    assert.deepEqual(viaReader.entries.map((e) => e.id), viaSync.entries.map((e) => e.id));
    assert.equal(viaReader.leafId, viaSync.leafId);
  });

  it("array input stays synchronous (overload dispatch)", () => {
    const result = getSessionBranchEntries([entry("a")], { leafId: "a" });
    assert.ok(!(result instanceof Promise));
    assert.equal(result[0]!.id, "a");
  });
});

describe("atomic append guards (memory store)", () => {
  it("throws SessionAppendConflictError when expectedParentId does not exist", async () => {
    const store = createMemorySessionStore();
    const orphan = createSessionEntry({ sessionId: "s1", kind: "label", label: "orphan" });
    await assert.rejects(
      () => store.append(orphan, { expectedParentId: "missing" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "missing",
    );
    // nothing appended
    assert.equal((await store.list("s1")).length, 0);
  });

  it("accepts append when expectedParentId exists (branching from any leaf, not just the tip)", async () => {
    const store = createMemorySessionStore();
    const root = createSessionEntry({ sessionId: "s1", kind: "label", label: "root" });
    await store.append(root);
    const tip = createSessionEntry({ sessionId: "s1", parentId: root.id, kind: "label", label: "tip" });
    await store.append(tip);
    // Branching from the NON-tip root must succeed (existence validation, not tip-CAS).
    const branch = createSessionEntry({ sessionId: "s1", parentId: root.id, kind: "label", label: "branch" });
    await store.append(branch, { expectedParentId: root.id });
    assert.equal((await store.list("s1")).length, 3);
  });

  it("deduplicates an exact retry at the same position by idempotencyKey", async () => {
    const store = createMemorySessionStore();
    const root = createSessionEntry({ sessionId: "s1", kind: "label", label: "root" });
    await store.append(root, { idempotencyKey: "k1" });
    await assert.rejects(
      () => store.append(createSessionEntry({ id: "dup", sessionId: "s1", kind: "label", label: "dup" }), { idempotencyKey: "k1" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.idempotencyDuplicate === true,
    );
    assert.equal((await store.list("s1")).length, 1);
  });

  it("does not collapse distinct linear appends sharing a run-level idempotencyKey", async () => {
    const store = createMemorySessionStore();
    const a = createSessionEntry({ sessionId: "s1", kind: "label", label: "a" });
    await store.append(a, { idempotencyKey: "run-1" });
    const b = createSessionEntry({ sessionId: "s1", parentId: a.id, kind: "label", label: "b" });
    await store.append(b, { idempotencyKey: "run-1", expectedParentId: a.id });
    assert.equal((await store.list("s1")).length, 2);
  });

  it("a rejected append leaves the existing chain's parent order untouched (atomicity)", async () => {
    // Roadmap goal: two workers on the same branch cannot silently corrupt parent order.
    // Existence-validation (Task 3 deviation from tip-CAS) guarantees no entry ends up with a
    // dangling parent, and a rejected append writes nothing, so the surviving chain is intact.
    const store = createMemorySessionStore();
    const root = createSessionEntry({ sessionId: "s1", kind: "label", label: "root" });
    await store.append(root);
    const tip = createSessionEntry({ sessionId: "s1", parentId: root.id, kind: "label", label: "tip" });
    await store.append(tip);

    // A second writer races in with a stale/dangling expectedParentId. It must be rejected.
    const orphan = createSessionEntry({ id: "orphan", sessionId: "s1", parentId: "ghost", kind: "label", label: "orphan" });
    await assert.rejects(
      () => store.append(orphan, { expectedParentId: "ghost" }),
      (error: unknown) => isSessionAppendConflict(error) && error.conflict.expectedParentId === "ghost",
    );

    const after = await store.list("s1");
    assert.equal(after.length, 2, "rejected append wrote nothing");
    // Parent order of the surviving chain is unchanged: root <- tip still resolves tip.parentId === root.id.
    const survivors = getSessionBranchEntries(after, { leafId: tip.id });
    assert.deepEqual(survivors.map((e) => e.id), [root.id, tip.id]);
    assert.equal(after.some((e) => e.id === "orphan"), false, "orphan was not persisted");
  });
});

describe("isSessionAppendConflict", () => {
  it("returns true only for errors carrying the session_append_conflict code", () => {
    const conflict = new SessionAppendConflictError({
      code: SESSION_APPEND_CONFLICT_CODE,
      expectedParentId: "p1",
      currentLeafId: "p2",
    });
    assert.equal(isSessionAppendConflict(conflict), true);
    assert.equal(conflict.code, "session_append_conflict");
    assert.equal(conflict.conflict.currentLeafId, "p2");

    // A plain Error whose message happens to mention the code is NOT recognized.
    assert.equal(isSessionAppendConflict(new Error("session append conflict: boom")), false);
    // A non-Error object carrying the code is NOT recognized (guard narrows to the Error class).
    assert.equal(isSessionAppendConflict({ code: "session_append_conflict" }), false);
    assert.equal(isSessionAppendConflict(null), false);
    assert.equal(isSessionAppendConflict(undefined), false);
    assert.equal(isSessionAppendConflict(42), false);
  });
});
