import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type Agent,
  type AgentConfig,
  type CompactionContext,
  type CompactionOptions,
  type CompactionEntryData,
  createAgent,
  createDefaultCompactor,
  createSessionEntry,
  definePackage,
  type JsonObject,
  type JsonValue,
  providerDone,
  rebuildSessionContext,
  type SessionEntry,
} from "../index.js";
import { filesSection, recentSection, summarizeDropped, taskSection, toolsSection } from "../compaction.js";
import { mockProvider } from "../testing/index.js";
import { assertCompactorConforms } from "../testing/compaction-conformance.js";

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

  it("compaction_context_carries_owner_session", async () => {
    let seen: CompactionContext | undefined;
    const owner = definePackage({
      name: "@acme/compactor",
      version: "1.0.0",
      requires: { api: 1 },
      capabilities: ["slot:compaction", "session-state"],
      setup: ({ slots, state }) => {
        const mark = state.session<JsonValue>("mark", { n: 5 });
        slots.compaction.provide({
          compact: (context) => {
            seen = context;
            return { summary: `session ${context.session?.id} state ${JSON.stringify(mark.get(context.session!))}` };
          },
        });
      },
    });
    const agent: Agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [owner, mockProvider([[providerDone()]])],
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("old");

    const result = await session.compact();

    assert.equal(seen?.session?.id, "s1", "a package compactor reads its own session");
    assert.equal(result.summary, 'session s1 state {"n":5}', "session state is hydrated when the compactor runs");
  });

  it("compaction_context_omits_session_for_a_host_compactor", async () => {
    let seen: CompactionContext | undefined;
    const agent: Agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerDone()]])],
      slots: {
        compaction: {
          compact: (context) => {
            seen = context;
            return { summary: "host" };
          },
        },
      },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("old");
    await session.compact();

    assert.equal(seen?.sessionId, "s1");
    assert.equal(seen?.session, undefined, "a host or kernel compactor gets no session view");
  });
});

let seq = 0;
function entry(message: SessionEntry["message"]): SessionEntry {
  seq += 1;
  return createSessionEntry({ id: `e${seq}`, sessionId: "s1", timestamp: now().toISOString(), kind: "message", message });
}
const user = (text: string) => entry({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string) => entry({ role: "assistant", content: [{ type: "text", text }] });
const call = (name: string, args: JsonObject, id = `c${seq + 1}`) =>
  entry({ role: "assistant", content: [{ type: "tool_call", id, name, arguments: args }] });
const result = (name: string, id: string) =>
  entry({ role: "tool", content: [{ type: "tool_result", toolCallId: id, name, result: { ok: true } }] });

describe("default compactor keeps what a continuing agent needs (plan 229 Task 5)", () => {
  it("summary_keeps_first_user_request_and_latest_progress", async () => {
    const entries = [
      user("Port the parser to the new grammar"),
      ...Array.from({ length: 40 }, (_, i) => assistant(`working step ${i} ${"x".repeat(400)}`)),
      assistant("Parser ported; next: fix the three failing tests"),
      user("recent ask"),
      assistant("recent reply"),
    ];
    const out = await createDefaultCompactor({ keepRecentEntries: 2 }).compact({ sessionId: "s1", entries });

    assert.ok(out.summary.startsWith("Task: Port the parser to the new grammar"), "the first user request leads");
    assert.ok(out.summary.includes("Latest progress: Parser ported; next: fix the three failing tests"));
    assert.ok(out.summary.length <= 8_000, "default cap is 8,000 characters");
    assert.ok(out.summary.includes("characters cut]"), "older recent text is marked as cut");
    assert.equal(out.summary.includes("recent reply"), false, "kept entries are not summarized");
  });

  it("summary_lists_files_and_tools", () => {
    const entries = [
      user("task"),
      call("read", { path: "c.ts" }, "r1"),
      result("read", "r1"),
      call("edit", { path: "b.ts" }, "e1"),
      call("write", { path: "a.ts" }, "w1"),
      call("read", { path: "a.ts" }, "r2"),
      call("shell", { command: "bun test" }, "s1"),
      call("read", { path: "d.ts" }, "r3"),
    ];
    assert.deepEqual(filesSection(entries), ["Files modified: a.ts, b.ts", "Files read: c.ts, d.ts"]);
    assert.equal(toolsSection(entries), "Tools used: read ×3, edit ×1, shell ×1, write ×1");
    assert.equal(toolsSection([user("no tools")]), undefined);
    assert.equal(taskSection(undefined), undefined);
    assert.ok(summarizeDropped(entries).includes("Files modified: a.ts, b.ts"));
  });

  it("tail_is_chosen_by_token_budget", async () => {
    // Each message is ~1,000 estimated tokens (4,000 characters).
    const entries = Array.from({ length: 10 }, (_, i) => (i % 2 ? assistant : user)(`${i}`.padEnd(4_000, "y")));
    const keep = async (context: Partial<CompactionContext>) =>
      (
        (await createDefaultCompactor().compact({ sessionId: "s1", entries, ...context })).entries?.[0]?.data as
          | CompactionEntryData
          | undefined
      )?.keepEntryIds?.length;

    assert.equal(await keep({}), 2, "no cap: the 2,000-token floor keeps the newest two messages");
    assert.equal(await keep({ inputCapTokens: 20_000 }), 4, "20% of a 20,000-token cap keeps 4,000 tokens");
    assert.equal(await keep({ inputCapTokens: 20_000, keepRecentEntries: 7 }), 7, "an explicit count still wins");
    const fixed = await createDefaultCompactor({ keepRecentTokens: 3_000 }).compact({ sessionId: "s1", entries, inputCapTokens: 100_000 });
    assert.equal(
      (fixed.entries?.[0]?.data as CompactionEntryData | undefined)?.keepEntryIds?.length,
      3,
      "a fixed budget replaces the ratio",
    );
  });

  it("tool_result_never_split_from_its_call", async () => {
    const big = "z".repeat(9_000);
    // The call alone is over the 2,000-token floor; its small result fits.
    const callEntry = call("write", { path: "big.ts", content: big }, "rb");
    const resultEntry = entry({
      role: "tool",
      content: [
        { type: "tool_result", toolCallId: "rb", name: "read", result: { ok: true } },
        { type: "text", text: "ok" },
      ],
    });
    const entries = [user(big), assistant(big), callEntry, resultEntry];
    const out = await createDefaultCompactor().compact({ sessionId: "s1", entries });
    assert.deepEqual((out.entries?.[0]?.data as CompactionEntryData | undefined)?.keepEntryIds, [callEntry.id, resultEntry.id]);
  });

  it("summary_is_capped_and_marks_the_cut", async () => {
    const entries = [user("t".repeat(3_000)), assistant("p".repeat(3_000)), user("recent")];
    const out = await createDefaultCompactor({ keepRecentEntries: 1, maxSummaryChars: 1_000 }).compact({ sessionId: "s1", entries });
    assert.equal(out.summary.length, 1_000);
    assert.match(out.summary, /\n\[…\d+ characters cut\]$/);
    assert.match(
      out.summary,
      /^Task: t+\n\[…\d+ characters cut\]$/,
      "the task section is itself clipped to 1,500 characters before the cap",
    );
    assert.ok(summarizeDropped(entries.slice(0, 2)).includes(`t${"t".repeat(1_499)} […1500 characters cut]`));
    const tiny = await createDefaultCompactor({ keepRecentEntries: 1, maxSummaryChars: 1 }).compact({ sessionId: "s1", entries });
    assert.equal(tiny.summary.length, 1, "a one-character cap still holds");
    const recent = recentSection([user("a".repeat(50)), user("b".repeat(50))], new Set(), 80);
    assert.ok(recent?.startsWith("Recent:\n[…"), "the older cut text is marked before what was kept");
  });

  it("secret_in_dropped_text_is_redacted", async () => {
    const secret = "sk-test-0123456789abcdef";
    const entries = [user(`deploy with ${secret}`), assistant(`used ${secret} ok`), call("read", { path: "x.ts" }, "rx"), user("recent")];
    const out = await createDefaultCompactor({ keepRecentEntries: 1 }).compact({
      sessionId: "s1",
      entries,
      secrets: [secret],
      maxSummaryChars: 30,
    });
    assert.equal(out.summary.includes(secret.slice(0, 10)), false, "redaction runs before the cap");
    const full = await createDefaultCompactor({ keepRecentEntries: 1 }).compact({ sessionId: "s1", entries, secrets: [secret] });
    assert.equal(full.summary.includes(secret), false);
    assert.ok(full.summary.includes("[REDACTED]"));
  });

  it("compaction_conformance_passes_for_the_default_compactor", async () => {
    await assertCompactorConforms(createDefaultCompactor(), { secrets: ["secret-value"] });
    await assertCompactorConforms(createDefaultCompactor({ keepRecentTokens: 0 }), { secrets: ["secret-value"] });
  });

  it("compaction_options_max_summary_chars_reaches_the_compactor", async () => {
    let seen: CompactionContext | undefined;
    const agent: Agent = await createAgent({
      model: { provider: "mock", model: "demo", limits: { contextWindow: 11_024, maxOutputTokens: 0 } },
      packages: [mockProvider([[providerDone()]])],
      compaction: { maxSummaryChars: 123 },
      slots: {
        compaction: {
          compact: (context) => {
            seen = context;
            return { summary: "host" };
          },
        },
      },
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("old");
    await session.compact();

    assert.equal(seen?.maxSummaryChars, 123);
    assert.equal(seen?.inputCapTokens, 10_000, "the cap is the window less the default 1,024-token reserve");
  });
});

describe("retired compaction seams", () => {
  it("middleware_field_is_gone", () => {
    // Compaction has exactly two seams: the `compaction` slot and the `compaction.when` hook.
    // `CompactionOptions` carries sizing knobs and the fallback trigger, and there is no middleware registry to hang
    // a pre- or post-compaction callback off any more.
    const options: CompactionOptions = { keepRecentEntries: 4, thresholdEntries: 20, maxSummaryChars: 800 };
    // @ts-expect-error `strategy` was retired: the implementation is the `compaction` slot.
    void ({ ...options, strategy: createDefaultCompactor() } satisfies CompactionOptions);
    // `trigger` came back in plan 229 Task 4 as the kernel fallback's trigger, behind `compaction.when`.
    void ({ ...options, trigger: { type: "each_turn" } } satisfies CompactionOptions);
    // @ts-expect-error `middleware` was retired: the whole registry left with the last hook names.
    void ({ model: { provider: "mock", model: "demo" }, middleware: undefined } satisfies AgentConfig);
    assert.deepEqual(options, { keepRecentEntries: 4, thresholdEntries: 20, maxSummaryChars: 800 });
  });
});
