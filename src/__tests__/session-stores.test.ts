import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "../index.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, listSessionBranches, rebuildSessionContext } from "../index.js";

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
