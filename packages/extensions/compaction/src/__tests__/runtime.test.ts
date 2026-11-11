import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  type AgentEvent,
  type ProviderRequest,
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  definePackage,
  providerDone,
  providerError,
  providerTextDelta,
  rebuildSessionContext,
} from "@arnilo/prism";
import { mockProvider, createMockProvider } from "@arnilo/prism/testing";
import { createLlmCompactor } from "../strategy.js";
import memoryCompaction from "../index.js";
import { summaryClient } from "./helpers.js";

const model = { provider: "mock", model: "demo" };
const summaryModel = { provider: "mock", model: "summary" };
const reply = (text = "reply") => [providerTextDelta(text), providerDone()];

async function take(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  while (events.length < count) events.push((await iterator.next()).value);
  await iterator.return?.();
  return events;
}

/** A package that records the `package.event`s it observes, so a test reads them without a stream. */
function eventObserver(seen: AgentEvent[]) {
  return definePackage({
    name: "@acme/event-observer",
    version: "1.0.0",
    requires: { api: 1 },
    setup: ({ hooks }) => {
      hooks.on("package.event", (event) => {
        seen.push(event);
      });
    },
  });
}

test("session_manual_compact_with_llm_strategy_appends_compaction_entry", async () => {
  const store = createMemorySessionStore();
  const session = await (
    await createAgent({
      model,
      packages: [memoryCompaction(), mockProvider([reply(), reply(), reply("compact summary")])],
      slots: { store },
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
  const session = await (
    await createAgent({
      model,
      packages: [memoryCompaction(), mockProvider([reply(), reply("compact summary")], { onRequest: (request) => requests.push(request) })],
      compaction: { thresholdEntries: 1 },
    })
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
  const session = await (
    await createAgent({
      model,
      packages: [memoryCompaction(), mockProvider([reply(), reply(), reply("compact summary")])],
      slots: { store },
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

test("llm_compaction_summary_call_reads_the_package_config_keep_budget", async () => {
  const requests: ProviderRequest[] = [];
  const session = await (
    await createAgent({
      model,
      packages: [
        memoryCompaction({ keepRecentTokens: 0 }),
        mockProvider([reply(), reply("compact summary")], { onRequest: (request) => requests.push(request) }),
      ],
    })
  ).session({ id: "s1", create: true });
  await session.run("old");

  await session.compact();

  const prompt = requests.at(-1)?.messages[1]?.content[0];
  assert.equal(prompt?.type === "text" ? prompt.text.includes("old") : false, true, "the whole history is summarized");
});

test("memory_compaction_falls_back_on_model_error", async () => {
  const seen: AgentEvent[] = [];
  const session = await (
    await createAgent({
      model,
      packages: [
        memoryCompaction(),
        mockProvider([reply("old history to summarize"), [providerError(new Error("boom"))]]),
        eventObserver(seen),
      ],
      // The kernel default keeps nothing, so its fallback summary holds all the raw history.
      compaction: { keepRecentEntries: 0 },
    })
  ).session();
  await session.run("old");

  const result = await session.compact();

  assert.equal(result.entries?.[0]?.kind, "compaction", "a failed summary still compacts");
  assert.match(result.summary, /old history to summarize/, "the kernel default summarized the raw history");
  const fallback = seen.find((event) => event.type === "package.event" && event.name === "compaction.fallback");
  assert.ok(fallback, "the failure is reported as a package event");
  assert.match(JSON.stringify(fallback), /boom/);
});

test("llm_compaction_abort_appends_no_entry", async () => {
  const session = await (
    await createAgent({
      model,
      packages: [memoryCompaction(), mockProvider([reply(), reply("unused")])],
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
      packages: [memoryCompaction(), mockProvider([reply(), reply(`summary ${secret}`)])],
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
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("compact summary"), providerDone()], {
        onRequest: (value) => {
          request = value;
        },
      }),
      summaryModel,
    ),
    keepRecentTokens: 1,
  });

  await strategy.compact({ sessionId: "s1", entries: [summary, message] });

  const prompt = request.messages[1]?.content[0];
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /branch summary text/);
});
