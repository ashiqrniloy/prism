import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type Agent, type AgentConfig, type CompactionOptions, type CompactionEntryData, createAgent, createDefaultCompactor, createSessionEntry, providerDone, rebuildSessionContext } from "../index.js";
import { mockProvider } from "../testing/index.js";

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
    const strategy = createDefaultCompactor({ keepRecentEntries: 1, maxSummaryChars: 20 });

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
    const strategy = createDefaultCompactor({ keepRecentEntries: 1, secrets: [secret] });

    const result = await strategy.compact({ sessionId: "s1", entries });

    assert.equal(result.summary.includes(secret), false);
    assert.equal(result.summary.includes("[REDACTED]"), true);
  });

  it("rebuild session context uses latest compaction summary and recent messages", async () => {
    const entries = [message("u1", "old"), message("a2", "older", "u1"), message("u3", "recent", "a2")];
    const result = await createDefaultCompactor({ keepRecentEntries: 1 }).compact({ sessionId: "s1", entries });
    const compacted = result.entries![0]!;

    const snapshot = rebuildSessionContext([...entries, compacted], { leafId: compacted.id });

    assert.deepEqual(
      snapshot.entries.map((entry) => entry.id),
      [...entries.map((entry) => entry.id), compacted.id],
    );
    assert.deepEqual(snapshot.summaries, [result.summary]);
    assert.deepEqual(
      snapshot.messages.map((item) => (item.content[0]?.type === "text" ? item.content[0].text : "")),
      ["recent"],
    );
  });

  it("rebuild session context without compaction is unchanged", () => {
    const entries = [message("u1", "old"), message("a2", "new", "u1")];

    const snapshot = rebuildSessionContext(entries, { leafId: "a2" });

    assert.deepEqual(snapshot.summaries, []);
    assert.deepEqual(
      snapshot.messages.map((item) => (item.content[0]?.type === "text" ? item.content[0].text : "")),
      ["old", "new"],
    );
  });

  it("compaction_slot_default_drops_oldest_whole_turns_and_marks", async () => {
    const toolCall = createSessionEntry({
      id: "a3",
      parentId: "u3",
      sessionId: "s1",
      timestamp: now().toISOString(),
      kind: "message",
      message: {
        role: "assistant",
        content: [{ type: "tool_call", id: "t1", name: "echo", arguments: {} }],
      },
    });
    const toolResult = createSessionEntry({
      id: "t4",
      parentId: "a3",
      sessionId: "s1",
      timestamp: now().toISOString(),
      kind: "message",
      message: { role: "tool", content: [{ type: "tool_result", toolCallId: "t1", name: "echo", result: { ok: true } }] },
    });
    const entries = [message("u1", "first"), message("a2", "second", "u1"), message("u3", "third", "a2"), toolCall, toolResult];

    // Keep 1 *message*, but a tool result is never separated from its tool call.
    const result = await createDefaultCompactor({ keepRecentEntries: 1 }).compact({ sessionId: "s1", entries, trigger: "auto" });
    const data = result.entries?.[0]?.data as CompactionEntryData | undefined;

    assert.deepEqual(data?.keepEntryIds, ["a3", "t4"], "the tool call stays with its result, not just the last message");
    assert.equal(data?.throughEntryId, "u3", "the marker records the last compacted entry");
    assert.equal(data?.strategy, "default-compaction", "the slot default names itself in the marker");
    assert.equal(data?.trigger, "auto");
    assert.equal(result.entries?.[0]?.kind, "compaction", "the result carries the marker entry");
    assert.ok(result.summary.includes("first"), "the dropped turn is summarized");
  });

  it("compaction_slot_direct_implementation_used_by_session_compact", async () => {
    const compactor = { name: "slot", compact: () => ({ summary: "from the slot" }) };
    const agent: Agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerDone()]])],
      slots: { compaction: compactor },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("old");

    const result = await session.compact();

    assert.equal(result.summary, "from the slot", "session.compact() routes through the compaction slot");
    assert.equal((await session.entries()).at(-1)?.summary, "from the slot");
  });
});

describe("retired compaction seams", () => {
  it("middleware_field_is_gone", () => {
    // Compaction has exactly two seams: the `compaction` slot and the `compaction.when` hook.
    // `CompactionOptions` carries sizing knobs only, and there is no middleware registry to hang
    // a pre- or post-compaction callback off any more.
    const options: CompactionOptions = { keepRecentEntries: 4, thresholdEntries: 20, maxSummaryChars: 800 };
    // @ts-expect-error `strategy` was retired: the implementation is the `compaction` slot.
    void ({ ...options, strategy: createDefaultCompactor() } satisfies CompactionOptions);
    // @ts-expect-error `trigger` was retired: the auto trigger is the `compaction.when` hook.
    void ({ ...options, trigger: { type: "each_turn" } } satisfies CompactionOptions);
    // @ts-expect-error `middleware` was retired: the whole registry left with the last hook names.
    void ({ model: { provider: "mock", model: "demo" }, middleware: undefined } satisfies AgentConfig);
    assert.deepEqual(options, { keepRecentEntries: 4, thresholdEntries: 20, maxSummaryChars: 800 });
  });
});
