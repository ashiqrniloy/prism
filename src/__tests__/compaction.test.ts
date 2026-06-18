import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDefaultCompactionStrategy, createSessionEntry, rebuildSessionContext, type CompactionEntryData } from "../index.js";

const now = () => new Date("2026-01-01T00:00:00.000Z");

function message(id: string, text: string, parentId?: string) {
  return createSessionEntry({
    id,
    parentId,
    sessionId: "s1",
    timestamp: now().toISOString(),
    kind: "message",
    message: { role: id.startsWith("a") ? "assistant" : "user", content: [{ type: "text", text }] },
  });
}

describe("compaction", () => {
  it("default compaction strategy summarizes old entries and keeps recent ids", async () => {
    const entries = [message("u1", "first"), message("a2", "second", "u1"), message("u3", "third", "a2")];
    const strategy = createDefaultCompactionStrategy({ keepRecentEntries: 1, maxSummaryChars: 20 });

    const result = await strategy.compact({ sessionId: "s1", entries, trigger: "manual" });
    const entry = result.entries?.[0];
    const data = entry?.data as CompactionEntryData | undefined;

    assert.equal(entry?.kind, "compaction");
    assert.equal(entry?.parentId, "u3");
    assert.equal(data?.throughEntryId, "a2");
    assert.deepEqual(data?.keepEntryIds, ["u3"]);
    assert.equal(data?.strategy, "default-compaction");
    assert.equal(data?.trigger, "manual");
    assert.ok(result.summary.length <= 20);
  });

  it("default compaction strategy redacts known secret strings", async () => {
    const secret = "secret-value";
    const entries = [message("u1", `token ${secret}`), message("a2", "recent", "u1")];
    const strategy = createDefaultCompactionStrategy({ keepRecentEntries: 1, secrets: [secret] });

    const result = await strategy.compact({ sessionId: "s1", entries });

    assert.equal(result.summary.includes(secret), false);
    assert.equal(result.summary.includes("[REDACTED]"), true);
  });

  it("rebuild session context uses latest compaction summary and recent messages", async () => {
    const entries = [message("u1", "old"), message("a2", "older", "u1"), message("u3", "recent", "a2")];
    const result = await createDefaultCompactionStrategy({ keepRecentEntries: 1 }).compact({ sessionId: "s1", entries });
    const compacted = result.entries![0]!;

    const snapshot = rebuildSessionContext([...entries, compacted], { leafId: compacted.id });

    assert.deepEqual(snapshot.entries.map((entry) => entry.id), [...entries.map((entry) => entry.id), compacted.id]);
    assert.deepEqual(snapshot.summaries, [result.summary]);
    assert.deepEqual(snapshot.messages.map((item) => item.content[0]?.type === "text" ? item.content[0].text : ""), ["recent"]);
  });

  it("rebuild session context without compaction is unchanged", () => {
    const entries = [message("u1", "old"), message("a2", "new", "u1")];

    const snapshot = rebuildSessionContext(entries, { leafId: "a2" });

    assert.deepEqual(snapshot.summaries, []);
    assert.deepEqual(snapshot.messages.map((item) => item.content[0]?.type === "text" ? item.content[0].text : ""), ["old", "new"]);
  });
});
