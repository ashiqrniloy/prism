import assert from "node:assert/strict";
import test from "node:test";
import { assertCompactionStrategyConforms } from "@arnilo/prism/testing/compaction-conformance";
import { createAgent, createMockProvider, createSessionEntry, providerDone, providerError, providerTextDelta, toolCallContent, type AgentEvent, type ContentBlock, type ProviderRequest, type SessionEntry } from "@arnilo/prism";
import { createCodingCompactionStrategy } from "../index.js";

const model = { provider: "mock", model: "summary" };
const timestamp = "2026-01-01T00:00:00.000Z";

function message(id: string, role: "user" | "assistant", content: readonly ContentBlock[], parentId?: string): SessionEntry {
  return createSessionEntry({ id, parentId, sessionId: "s1", timestamp, kind: "message", message: { role, content } });
}

async function take(iterable: AsyncIterable<AgentEvent>, count: number): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  while (events.length < count) events.push((await iterator.next()).value);
  await iterator.return?.();
  return events;
}

test("coding_compaction_preset_prioritizes_coding_handoff_and_redacts_paths", async () => {
  const secret = "secret-token";
  const requests: ProviderRequest[] = [];
  const strategy = createCodingCompactionStrategy({
    provider: createMockProvider([providerTextDelta(`## Progress\ncheck ${secret}`), providerDone()], { onRequest: (request) => requests.push(request) }),
    model,
    keepRecentTokens: 1,
    maxSummaryTokens: 100,
    customInstructions: "Prefer the remaining TODO.",
  });
  const previous = createSessionEntry({ id: "c0", sessionId: "s1", timestamp, kind: "compaction", summary: "prior decision: retain tests", data: { firstKeptEntryId: "u1" } });
  const entries = [
    previous,
    message("u1", "user", [{ type: "text", text: "Plan: fix parser TODO; blocker is failing npm test." }], "c0"),
    message("a2", "assistant", [
      toolCallContent("read-1", "read", { path: `src/${secret}.ts` }),
      toolCallContent("edit-1", "edit", { path: "src/parser.ts", oldText: "old", newText: "new" }),
    ], "u1"),
    message("u3", "user", [{ type: "text", text: "Run npm test next; parser check failed." }], "a2"),
  ];

  const result = await strategy.compact({ sessionId: "s1", entries, secrets: [secret] });
  const prompt = requests[0]?.messages[1]?.content[0];

  assert.equal(strategy.name, "coding");
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /prior decision/);
  assert.match(prompt.text, /modified and read file paths/);
  assert.match(prompt.text, /failing-check summaries/);
  assert.match(prompt.text, /Prefer the remaining TODO/);
  assert.equal(prompt.text.includes(secret), false);
  assert.match(result.summary, /<modified-files>\nsrc\/parser.ts/);
  assert.equal(result.summary.includes(secret), false);
  const data = result.entries?.[0]?.data as { throughEntryId?: string; keepEntryIds?: string[]; strategy?: string; firstKeptEntryId?: string; estimatedTokensBefore?: number; estimatedTokensAfter?: number; readFiles?: string[]; modifiedFiles?: string[] };
  assert.equal(data.throughEntryId, "a2");
  assert.deepEqual(data.keepEntryIds, ["u3"]);
  assert.equal(data.strategy, "coding");
  assert.equal(data.firstKeptEntryId, "u3");
  assert.ok((data.estimatedTokensBefore ?? 0) > (data.estimatedTokensAfter ?? 0));
  assert.deepEqual(data.readFiles, ["src/[REDACTED].ts"]);
  assert.deepEqual(data.modifiedFiles, ["src/parser.ts"]);
  assert.equal(entries.length, 4);
});

test("coding_compaction_preset keeps the shared summary cap", async () => {
  const strategy = createCodingCompactionStrategy({ provider: createMockProvider([providerTextDelta("x".repeat(100)), providerDone()]), model, keepRecentTokens: 1, maxSummaryTokens: 1 });
  const result = await strategy.compact({ sessionId: "s1", entries: [message("u1", "user", [{ type: "text", text: "old" }]), message("a2", "assistant", [{ type: "text", text: "new" }], "u1")] });
  assert.ok(result.summary.length <= 4);
});

test("coding_compaction_preset_redacts runtime output and appends nothing on provider failure", async () => {
  const secret = "runtime-secret";
  const session = createAgent({ model, provider: createMockProvider([providerTextDelta("reply"), providerDone()]) }).createSession();
  await session.run(`old ${secret}`);
  await session.run("new");
  const events = take(session.subscribe(), 2);

  await session.compact({ strategy: createCodingCompactionStrategy({ provider: createMockProvider([providerTextDelta(`summary ${secret}`), providerDone()]), model, keepRecentTokens: 1 }), secrets: [secret] });
  assert.equal(JSON.stringify(await events).includes(secret), false);
  assert.equal(JSON.stringify((await session.entries()).filter((entry) => entry.kind === "compaction")).includes(secret), false);

  const before = await session.entries();
  await assert.rejects(session.compact({ strategy: createCodingCompactionStrategy({ provider: createMockProvider([providerError(new Error("boom"))]), model, keepRecentTokens: 1 }) }), /Summarization failed: boom/);
  assert.deepEqual(await session.entries(), before);
});

test("coding_compaction_preset_conforms without a second runtime", async () => {
  const strategy = createCodingCompactionStrategy({ provider: createMockProvider([providerTextDelta("## Goal\nsummary"), providerDone()]), model, keepRecentTokens: 1 });
  const { summary } = await assertCompactionStrategyConforms(strategy, { secrets: ["secret-value"], exerciseAbort: true });
  assert.match(summary, /summary/);
});
