import assert from "node:assert/strict";
import test from "node:test";
import { createMockProvider, createSessionEntry, providerError, providerTextDelta, type ProviderRequest, type SessionEntry } from "@arnilo/prism";
import { createLlmCompactionStrategy } from "../strategy.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const model = { provider: "mock", model: "summary", limits: { maxOutputTokens: 1000 } };

function textEntry(id: string, role: "user" | "assistant", text: string, parentId?: string): SessionEntry {
  return createSessionEntry({ id, parentId, sessionId: "s1", timestamp, kind: "message", message: { role, content: [{ type: "text", text }] } });
}

test("llm_compaction_strategy_builds_provider_request_and_returns_compaction_entry", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactionStrategy({
    provider: createMockProvider([providerTextDelta("## Goal\nSummarized"), { type: "done" }], { onRequest: (value) => { request = value; } }),
    model,
    keepRecentTokens: 2,
    reserveTokens: 100,
    customInstructions: "focus on decisions",
    providerOptions: { cacheRetention: "short" },
  });
  const entries = [
    textEntry("u1", "user", "old secret-value"),
    textEntry("a2", "assistant", "older details", "u1"),
    textEntry("u3", "user", "new", "a2"),
  ];

  const result = await strategy.compact({ sessionId: "s1", entries, trigger: "manual", secrets: ["secret-value"] });

  assert.equal(result.summary, "## Goal\nSummarized");
  assert.equal(result.entries?.[0]?.kind, "compaction");
  assert.equal(result.entries?.[0]?.parentId, "u3");
  assert.equal((result.entries?.[0]?.data as { strategy?: string }).strategy, "llm-compaction");
  assert.equal(request?.model.parameters?.maxTokens, 80);
  assert.equal(request?.options?.cacheRetention, "short");
  const prompt = request?.messages[1]?.content[0];
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /<conversation>/);
  assert.match(prompt.text, /Additional focus: focus on decisions/);
  assert.equal(prompt.text.includes("secret-value"), false);
});

test("llm_compaction_strategy_updates_previous_summary_and_split_turn_prefix", async () => {
  const requests: ProviderRequest[] = [];
  const strategy = createLlmCompactionStrategy({
    provider: createMockProvider([providerTextDelta("summary"), { type: "done" }], { onRequest: (request) => requests.push(request) }),
    model,
    keepRecentTokens: 50,
  });
  const previous = createSessionEntry({
    id: "c2",
    parentId: "u1",
    sessionId: "s1",
    timestamp,
    kind: "compaction",
    summary: "previous summary",
    data: { throughEntryId: "u1", keepEntryIds: ["u3"], firstKeptEntryId: "u3" },
  });
  const entries = [
    textEntry("u1", "user", "old"),
    previous,
    textEntry("u3", "user", "request " + "x".repeat(400), "c2"),
    textEntry("a4", "assistant", "work " + "x".repeat(400), "u3"),
  ];

  const result = await strategy.compact({ sessionId: "s1", entries });

  assert.equal(requests.length, 2);
  const historyPrompt = requests[0]!.messages[1]!.content[0];
  assert.equal(historyPrompt.type, "text");
  assert.match(historyPrompt.text, /<previous-summary>\nprevious summary/);
  assert.match(result.summary, /\*\*Turn Context \(split turn\):\*\*/);
  assert.equal((result.entries?.[0]?.data as { isSplitTurn?: boolean }).isSplitTurn, true);
});

test("llm_compaction_strategy_maps_max_output_tokens_to_request_model", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactionStrategy({
    provider: createMockProvider([providerTextDelta("summary"), { type: "done" }], { onRequest: (value) => { request = value; } }),
    model: { ...model, parameters: { temperature: 0.1 } },
    keepRecentTokens: 1,
    maxOutputTokens: 123,
  });

  await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")] });

  assert.equal(request?.model.parameters?.maxTokens, 123);
  assert.equal(request?.model.parameters?.temperature, 0.1);
});

test("llm_compaction_strategy_applies_policy_thinking_and_max_summary_tokens", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactionStrategy({
    provider: createMockProvider([providerTextDelta("x".repeat(20)), { type: "done" }], { onRequest: (value) => { request = value; } }),
    model,
    keepRecentTokens: 1,
    maxSummaryTokens: 2,
    thinkingLevel: "low",
    providerRequestPolicies: {
      name: "cache",
      apply: ({ request }) => ({ request: { ...request, options: { ...request.options, cacheRetention: "long" } }, secrets: ["policy-secret"] }),
    },
  });

  const result = await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")] });

  assert.equal(request?.options?.cacheRetention, "long");
  assert.equal(request?.options?.extra?.thinkingLevel, "low");
  assert.equal(request?.model.parameters?.maxTokens, 2);
  assert.match(result.summary, /characters truncated/);
});

test("llm_compaction_strategy_resolves_credential_per_call_without_storing_it", async () => {
  let credentialSeen: string | undefined;
  const strategy = createLlmCompactionStrategy({
    summaryProvider: (credential) => {
      credentialSeen = credential;
      return createMockProvider([providerTextDelta("summary secret-token"), { type: "done" }]);
    },
    summaryModel: model,
    credential: () => "secret-token",
    credentialRequest: { provider: "mock", name: "apiKey" },
    keepRecentTokens: 1,
  });

  const result = await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")] });

  assert.equal(credentialSeen, "secret-token");
  assert.equal(result.summary.includes("secret-token"), false);
  assert.equal(JSON.stringify(result.entries?.[0]?.data).includes("secret-token"), false);
});

test("llm_compaction_strategy_throws_on_provider_error_without_result", async () => {
  const strategy = createLlmCompactionStrategy({ provider: createMockProvider([providerError(new Error("boom"))]), model, keepRecentTokens: 1 });
  const entries = [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")];

  await assert.rejects(async () => strategy.compact({ sessionId: "s1", entries }), /Summarization failed: boom/);
});

test("llm_compaction_strategy_observes_abort_signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  const strategy = createLlmCompactionStrategy({ provider: createMockProvider([providerTextDelta("unused")]), model });

  await assert.rejects(async () => strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old")], signal: controller.signal }), /stop/);
});
