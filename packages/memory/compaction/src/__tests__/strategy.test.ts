import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  type ModelConfig,
  type ModelProvider,
  type ProviderRequest,
  createSessionEntry,
  providerError,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import { createMockProvider } from "@arnilo/prism/testing";
import { HARD_MAX_SUMMARY_ERROR_BYTES, HARD_MAX_SUMMARY_TOKENS, HARD_RESERVE_TOKENS } from "../limits.js";
import { createLlmCompactor } from "../strategy.js";
import { summaryClient } from "./helpers.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const model = { provider: "mock", model: "summary", limits: { maxOutputTokens: 1000 } };

function textEntry(id: string, role: "user" | "assistant", text: string, parentId?: string): SessionEntry {
  return createSessionEntry({
    id,
    parentId,
    sessionId: "s1",
    timestamp,
    kind: "message",
    message: { role, content: [{ type: "text", text }] },
  });
}

test("llm_compaction_strategy_builds_provider_request_and_returns_compaction_entry", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("## Goal\nSummarized"), { type: "done" }], {
        onRequest: (value) => {
          request = value;
        },
      }),
      model,
    ),
    keepRecentTokens: 2,
    reserveTokens: 100,
    customInstructions: "focus on decisions",
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
  assert.equal((result.entries?.[0]?.data as { strategy?: string })!.strategy, "llm-compaction");
  assert.equal(request?.model.parameters?.maxTokens, 80);
  assert.equal(request?.options?.sessionId, "s1");
  assert.equal(request?.options?.cacheKey, "s1");
  const prompt = request?.messages[1]?.content[0];
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /<conversation>/);
  assert.match(prompt.text, /Additional focus: focus on decisions/);
  assert.equal(prompt.text.includes("secret-value"), false);
});

test("llm_compaction_strategy_updates_previous_summary_and_split_turn_prefix", async () => {
  const requests: ProviderRequest[] = [];
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("summary"), { type: "done" }], { onRequest: (request) => requests.push(request) }),
      model,
    ),
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
    textEntry("u3", "user", `request ${"x".repeat(400)}`, "c2"),
    textEntry("a4", "assistant", `work ${"x".repeat(400)}`, "u3"),
  ];

  const result = await strategy.compact({ sessionId: "s1", entries });

  assert.equal(requests.length, 2);
  const historyPrompt = requests[0]!.messages[1]!.content[0];
  assert.equal(historyPrompt.type, "text");
  assert.match(historyPrompt.text, /<previous-summary>\nprevious summary/);
  assert.match(result.summary, /\*\*Turn Context \(split turn\):\*\*/);
  assert.equal((result.entries?.[0]?.data as { isSplitTurn?: boolean })!.isSplitTurn, true);
});

test("llm_compaction_strategy_maps_max_summary_tokens_to_request_budget", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("summary"), { type: "done" }], {
        onRequest: (value) => {
          request = value;
        },
      }),
      { ...model, parameters: { temperature: 0.1 } },
    ),
    keepRecentTokens: 1,
    maxSummaryTokens: 123,
  });

  await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")] });

  assert.equal(request?.model.parameters?.maxTokens, 123);
  assert.equal(request?.model.parameters?.temperature, 0.1);
});

test("llm_compaction_strategy_replaces_the_summary_system_prompt_when_configured", async () => {
  const requests: ProviderRequest[] = [];
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("x".repeat(20)), { type: "done" }], { onRequest: (value) => requests.push(value) }),
      model,
    ),
    keepRecentTokens: 1,
    maxSummaryTokens: 2,
    summaryPrompt: "Summarize in one line.",
  });

  const result = await strategy.compact({
    sessionId: "s1",
    entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")],
  });

  const system = requests[0]?.messages[0]?.content[0];
  assert.equal(system?.type === "text" ? system.text : undefined, "Summarize in one line.");
  assert.equal(result.summary.length, 8);
});

test("llm_compaction_strategy_throws_on_provider_error_without_result", async () => {
  const strategy = createLlmCompactor({
    clientFor: summaryClient(createMockProvider([providerError(new Error("boom"))]), model),
    keepRecentTokens: 1,
  });
  const entries = [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")];

  await assert.rejects(async () => strategy.compact({ sessionId: "s1", entries }), /Summarization failed: boom/);
});

test("llm_compaction_strategy_bounds_streamed_text_events_unicode_and_errors", async () => {
  let closed = false;
  let request: ProviderRequest | undefined;
  const provider: ModelProvider = {
    id: "bounded",
    async *generate(value) {
      request = value;
      try {
        yield providerTextDelta("😀".repeat(100));
        while (true) yield { type: "done" };
      } finally {
        closed = true;
      }
    },
  };
  const strategy = createLlmCompactor({ clientFor: summaryClient(provider, model), keepRecentTokens: 1, maxSummaryTokens: 10 });
  const result = await strategy.compact({
    sessionId: "s1",
    entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")],
  });
  assert.ok(result.summary.length <= 40);
  assert.equal(result.summary.includes("\uFFFD"), false);
  assert.equal(closed, true);
  assert.equal(request?.model.parameters?.maxTokens, 10);

  const splitUnicode = createLlmCompactor({
    clientFor: summaryClient(createMockProvider([providerTextDelta("\uD83D"), providerTextDelta("\uDE00"), { type: "done" }]), model),
    keepRecentTokens: 1,
    maxSummaryTokens: 2,
  });
  const splitUnicodeSummary = (
    await splitUnicode.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")] })
  ).summary;
  assert.equal(splitUnicodeSummary.startsWith("😀"), true);
  assert.equal(splitUnicodeSummary.includes("\uFFFD"), false);
  assert.ok(splitUnicodeSummary.length <= 8);

  const secret = "provider-secret";
  const throwing: ModelProvider = {
    id: "throwing",
    async *generate() {
      throw new Error(`${secret}-${"x".repeat(100)}`);
    },
  };
  await assert.rejects(
    async () =>
      createLlmCompactor({ clientFor: summaryClient(throwing, model), keepRecentTokens: 1, maxErrorBytes: 16 }).compact({
        sessionId: "s1",
        entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")],
        secrets: [secret],
      }),
    (error: unknown) => error instanceof Error && !error.message.includes(secret) && Buffer.byteLength(error.message, "utf8") <= 40,
  );

  const infiniteEvents: ModelProvider = {
    id: "events",
    async *generate() {
      while (true) yield { type: "done" };
    },
  };
  await assert.rejects(
    async () =>
      createLlmCompactor({ clientFor: summaryClient(infiniteEvents, model), keepRecentTokens: 1, maxSummaryTokens: 1 }).compact({
        sessionId: "s1",
        entries: [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "new", "u1")],
      }),
    /provider event limit exceeded/,
  );
});

test("llm_compaction_strategy_rejects_invalid_limits_and_accepts_hard_boundaries", () => {
  const base = { clientFor: summaryClient(createMockProvider([{ type: "done" }]), model) };
  const limits = [
    ["maxSummaryTokens", HARD_MAX_SUMMARY_TOKENS],
    ["reserveTokens", HARD_RESERVE_TOKENS],
    ["maxErrorBytes", HARD_MAX_SUMMARY_ERROR_BYTES],
  ] as const;
  for (const [name, hardCap] of limits) {
    assert.doesNotThrow(() => createLlmCompactor({ ...base, [name]: hardCap }));
    for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, hardCap + 1]) {
      assert.throws(() => createLlmCompactor({ ...base, [name]: value }), new RegExp(name));
    }
  }
});

test("llm_compaction_strategy_observes_abort_signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  const strategy = createLlmCompactor({ clientFor: summaryClient(createMockProvider([providerTextDelta("unused")]), model) });

  await assert.rejects(
    async () => strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old")], signal: controller.signal }),
    /stop/,
  );
});

test("llm_compaction_keeps_the_model_ref_options_the_client_carries", async () => {
  let request: ProviderRequest | undefined;
  const googleModel = {
    provider: "google",
    model: "gemini-3.5-flash",
    compat: { thinkingConfig: {} },
    capabilities: { reasoning: true },
  } as ModelConfig;
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("summary text"), { type: "done" }], {
        onRequest: (value) => {
          request = value;
        },
      }),
      googleModel,
    ),
    keepRecentTokens: 1,
  });
  await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old")] });
  assert.equal(request?.model.provider, "google");
  assert.equal(request?.model.model, "gemini-3.5-flash");
  // Nothing invents a thinking field: the model ref's own compat is what the provider sees.
  assert.equal(request?.options?.compat?.reasoning_effort, undefined);
  assert.equal(request?.options?.compat?.thinkingLevel, undefined);
});

test("llm_compaction_stamps_context_sessionId_without_policies", async () => {
  let request: ProviderRequest | undefined;
  const strategy = createLlmCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta("summary text"), { type: "done" }], {
        onRequest: (value) => {
          request = value;
        },
      }),
      model,
    ),
    keepRecentTokens: 1,
  });
  await strategy.compact({ sessionId: "s1", entries: [textEntry("u1", "user", "old")] });
  assert.equal(request?.options?.sessionId, "s1");
  assert.equal(request?.options?.cacheKey, "s1");
});
