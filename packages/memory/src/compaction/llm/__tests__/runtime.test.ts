import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  type ProviderRequest,
  providerDone,
  providerError,
  providerTextDelta,
  rebuildSessionContext,
} from "@arnilo/prism";
import { createLlmCompactor } from "../index.js";

const model = { provider: "mock", model: "demo" };
const summaryModel = { provider: "mock", model: "summary" };

async function take(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  while (events.length < count) events.push((await iterator.next()).value);
  await iterator.return?.();
  return events;
}

test("session_manual_compact_with_llm_strategy_appends_compaction_entry", async () => {
  const store = createMemorySessionStore();
  // Roadmap §2.5: the compactor is the `compaction` slot; `compaction` only sizes it.
  const session = await (
    await createAgent({
      model,
      provider: createMockProvider([providerTextDelta("reply"), providerDone()]),
      slots: {
        store,
        compaction: createLlmCompactor({
          provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]),
          model: summaryModel,
          keepRecentTokens: 1,
        }),
      },
    })
  ).session({ id: "s1", create: true });
  await session.run("old");
  await session.run("new");
  const events = take(session.subscribe(), 2);

  const result = await session.compact();

  assert.equal(result.entries?.[0]?.kind, "compaction");
  assert.match(result.summary, /compact summary/);
  assert.equal(
    (await events).some((event) => event.type === "compaction.completed" && /compact summary/.test(event.summary ?? "")),
    true,
  );
});

test("session_auto_compact_with_llm_strategy_uses_existing_threshold_entries", async () => {
  const requests: ProviderRequest[] = [];
  const provider = createMockProvider([providerTextDelta("reply"), providerDone()], { onRequest: (request) => requests.push(request) });
  const strategy = createLlmCompactor({
    provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]),
    model: summaryModel,
    keepRecentTokens: 1,
  });
  const session = await (
    await createAgent({ model, provider, compaction: { thresholdEntries: 1 }, slots: { compaction: strategy } })
  ).session();

  await session.run("one");
  await session.run("two");

  const text =
    requests
      .at(-1)
      ?.messages.flatMap((message) => message.content)
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n") ?? "";
  assert.match(text, /compact summary/);
});

test("llm_compaction_preserves_raw_history_and_rebuilds_summary_plus_recent_messages", async () => {
  const store = createMemorySessionStore();
  // Roadmap §2.5: the compactor is the `compaction` slot; `compaction` only sizes it.
  const session = await (
    await createAgent({
      model,
      provider: createMockProvider([providerTextDelta("reply"), providerDone()]),
      slots: {
        store,
        compaction: createLlmCompactor({
          provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]),
          model: summaryModel,
          keepRecentTokens: 1,
        }),
      },
    })
  ).session({ id: "s1", create: true });
  await session.run("old");
  await session.run("new");
  const before = await session.entries();

  await session.compact();
  const after = await session.entries();
  const snapshot = rebuildSessionContext(after);

  assert.equal(after.length, before.length + 1);
  assert.equal(after.filter((entry) => entry.kind === "message").length, before.filter((entry) => entry.kind === "message").length);
  assert.match(snapshot.summaries[0] ?? "", /compact summary/);
  assert.ok(snapshot.messages.length >= 1);
});

test("llm_compaction_includes_branch_summary_entries_in_summary_input", async () => {
  let request!: ProviderRequest;
  const summary = createSessionEntry({ id: "sum1", sessionId: "s1", kind: "summary", summary: "branch summary text" });
  const message = createSessionEntry({
    id: "u2",
    parentId: "sum1",
    sessionId: "s1",
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "recent" }] },
  });
  const strategy = createLlmCompactor({
    provider: createMockProvider([providerTextDelta("compact summary"), providerDone()], {
      onRequest: (value) => {
        request = value;
      },
    }),
    model: summaryModel,
    keepRecentTokens: 1,
  });

  await strategy.compact({ sessionId: "s1", entries: [summary, message] });

  const prompt = request.messages[1]?.content[0];
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /branch summary text/);
});

test("llm_compaction_provider_error_appends_no_entry", async () => {
  const session = await (
    await createAgent({
      model,
      provider: createMockProvider([providerTextDelta("reply"), providerDone()]),
      // Roadmap §2.5: the compactor is the `compaction` slot.
      slots: {
        compaction: createLlmCompactor({
          provider: createMockProvider([providerError(new Error("boom"))]),
          model: summaryModel,
          keepRecentTokens: 1,
        }),
      },
    })
  ).session();
  await session.run("old");
  const before = await session.entries();

  await assert.rejects(session.compact(), /Summarization failed: boom/);
  assert.deepEqual(await session.entries(), before);
});

test("llm_compaction_abort_appends_no_entry", async () => {
  const session = await (
    await createAgent({
      model,
      provider: createMockProvider([providerTextDelta("reply"), providerDone()]),
      slots: {
        compaction: createLlmCompactor({ provider: createMockProvider([providerTextDelta("unused")]), model: summaryModel }),
      },
    })
  ).session();
  await session.run("old");
  const before = await session.entries();
  const controller = new AbortController();
  controller.abort(new Error("stop"));

  await assert.rejects(session.compact({ signal: controller.signal }), /stop/);
  assert.deepEqual(await session.entries(), before);
});

test("llm_compaction_runtime_redacts_secret_from_events_and_store", async () => {
  const secret = "runtime-secret";
  const session = await (
    await createAgent({
      model,
      provider: createMockProvider([providerTextDelta("reply"), providerDone()]),
      slots: {
        compaction: createLlmCompactor({
          provider: createMockProvider([providerTextDelta(`summary ${secret}`), providerDone()]),
          model: summaryModel,
          keepRecentTokens: 1,
        }),
      },
      compaction: { secrets: [secret] },
    })
  ).session();
  await session.run(`old ${secret}`);
  const events = take(session.subscribe(), 2);

  await session.compact();

  assert.equal(JSON.stringify(await events).includes(secret), false);
  const compactionEntries = (await session.entries()).filter((entry) => entry.kind === "compaction");
  assert.equal(JSON.stringify(compactionEntries).includes(secret), false);
});
