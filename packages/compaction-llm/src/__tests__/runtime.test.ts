import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgent,
  createExtensionKernel,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerError,
  providerTextDelta,
  rebuildSessionContext,
  type AgentEvent,
  type ProviderRequest,
} from "prism";
import { createLlmCompactionExtension, createLlmCompactionStrategy } from "../index.js";

const model = { provider: "mock", model: "demo" };
const summaryModel = { provider: "mock", model: "summary" };

async function take(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  while (events.length < count) events.push((await iterator.next()).value);
  await iterator.return?.();
  return events;
}

test("llm_compaction_extension_registers_strategy_in_contribution_registry", async () => {
  const kernel = createExtensionKernel();
  await kernel.load([createLlmCompactionExtension({ provider: createMockProvider([providerTextDelta("summary"), providerDone()]), model: summaryModel })]);

  assert.equal(kernel.registries.compactionStrategies.resolve("llm-compaction").name, "llm-compaction");
});

test("session_manual_compact_with_llm_strategy_appends_compaction_entry", async () => {
  const store = createMemorySessionStore();
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]), store }).createSession({ id: "s1" });
  await session.run("old");
  await session.run("new");
  const events = take(session.subscribe(), 2);

  const result = await session.compact({ strategy: createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]), model: summaryModel, keepRecentTokens: 1 }) });

  assert.equal(result.entries?.[0]?.kind, "compaction");
  assert.match(result.summary, /compact summary/);
  assert.equal((await events).some((event) => event.type === "compaction_finished" && /compact summary/.test(event.summary)), true);
});

test("session_auto_compact_with_llm_strategy_uses_existing_threshold_entries", async () => {
  const requests: ProviderRequest[] = [];
  const provider = createMockProvider([providerTextDelta("reply"), providerDone()], { onRequest: (request) => requests.push(request) });
  const strategy = createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]), model: summaryModel, keepRecentTokens: 1 });
  const session = createAgent({ model, provider, compaction: { strategy, thresholdEntries: 1 } }).createSession();

  await session.run("one");
  await session.run("two");

  const text = requests.at(-1)?.messages.flatMap((message) => message.content).map((block) => block.type === "text" ? block.text : "").join("\n") ?? "";
  assert.match(text, /compact summary/);
});

test("llm_compaction_preserves_raw_history_and_rebuilds_summary_plus_recent_messages", async () => {
  const store = createMemorySessionStore();
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]), store }).createSession({ id: "s1" });
  await session.run("old");
  await session.run("new");
  const before = await session.entries();

  await session.compact({ strategy: createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("compact summary"), providerDone()]), model: summaryModel, keepRecentTokens: 1 }) });
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
  const message = createSessionEntry({ id: "u2", parentId: "sum1", sessionId: "s1", kind: "message", message: { role: "user", content: [{ type: "text", text: "recent" }] } });
  const strategy = createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("compact summary"), providerDone()], { onRequest: (value) => { request = value; } }), model: summaryModel, keepRecentTokens: 1 });

  await strategy.compact({ sessionId: "s1", entries: [summary, message] });

  const prompt = request.messages[1]?.content[0];
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /branch summary text/);
});

test("llm_compaction_provider_error_appends_no_entry", async () => {
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]) }).createSession();
  await session.run("old");
  const before = await session.entries();
  const strategy = createLlmCompactionStrategy({ provider: createMockProvider([providerError(new Error("boom"))]), model: summaryModel, keepRecentTokens: 1 });

  await assert.rejects(session.compact({ strategy }), /Summarization failed: boom/);
  assert.deepEqual(await session.entries(), before);
});

test("llm_compaction_abort_appends_no_entry", async () => {
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]) }).createSession();
  await session.run("old");
  const before = await session.entries();
  const controller = new AbortController();
  controller.abort(new Error("stop"));

  await assert.rejects(session.compact({ strategy: createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("unused")]), model: summaryModel }), signal: controller.signal }), /stop/);
  assert.deepEqual(await session.entries(), before);
});

test("llm_compaction_runtime_redacts_secret_from_events_and_store", async () => {
  const secret = "runtime-secret";
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]) }).createSession();
  await session.run(`old ${secret}`);
  const events = take(session.subscribe(), 2);

  await session.compact({ strategy: createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta(`summary ${secret}`), providerDone()]), model: summaryModel, keepRecentTokens: 1 }), secrets: [secret] });

  assert.equal(JSON.stringify(await events).includes(secret), false);
  const compactionEntries = (await session.entries()).filter((entry) => entry.kind === "compaction");
  assert.equal(JSON.stringify(compactionEntries).includes(secret), false);
});
