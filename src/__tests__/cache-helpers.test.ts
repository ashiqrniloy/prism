import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message, ModelConfig } from "../index.js";
import { applyCacheControl, cacheHitRate, cacheSavings, cacheUsageReport, mapCacheRetention, sanitizeCacheKey } from "../index.js";

const messages: readonly Message[] = [
  { id: "sys", role: "system", content: [{ type: "text", text: "rules" }] },
  { id: "ctx", role: "user", content: [{ type: "text", text: "context" }] },
  { id: "tool", role: "assistant", content: [{ type: "tool_call", id: "call", name: "search", arguments: {} }] },
  { id: "last", role: "user", content: [{ type: "text", text: "question" }] },
];

describe("cache helpers", () => {
  it("sanitizes and truncates cache keys", () => {
    assert.equal(sanitizeCacheKey("session#1!", 128), "session-1");
    assert.equal(sanitizeCacheKey("abcdefghijklmnopqrstuvwxyz", 4), "abcd");
    assert.equal(sanitizeCacheKey("###", 128), undefined);
    assert.equal(sanitizeCacheKey(undefined, 128), undefined);
  });

  it("maps retention through generic model capabilities", () => {
    const long: ModelConfig = { provider: "mock", model: "long", cache: { kind: "cache_control", longRetention: true } };
    const shortOnly: ModelConfig = { provider: "mock", model: "short", cache: { kind: "cache_control", longRetention: false } };
    const none: ModelConfig = { provider: "mock", model: "none", cache: { kind: "none" } };

    assert.equal(mapCacheRetention("long", long), "long");
    assert.equal(mapCacheRetention("long", shortOnly), "short");
    assert.equal(mapCacheRetention("short", shortOnly), "short");
    assert.equal(mapCacheRetention("none", long), undefined);
    assert.equal(mapCacheRetention("long", none), undefined);
  });

  it("applies cache_control only to selected breakpoint messages", () => {
    const stamped = applyCacheControl(messages, [
      { location: "system_prompt" },
      { location: "last_user_message" },
      { location: "message_id", messageId: "tool" },
    ], { maxBreakpoints: 2, ttl: "1h" });

    assert.deepEqual(stamped.map((message) => message.content.at(-1)?.cache_control), [
      { type: "ephemeral", ttl: "1h" },
      undefined,
      undefined,
      { type: "ephemeral", ttl: "1h" },
    ]);
    assert.equal(messages[0]?.content[0]?.type, "text", "original messages are not mutated");
  });

  it("computes cache hit rate and estimated read savings", () => {
    assert.equal(cacheHitRate({ inputTokens: 1000, cacheReadTokens: 800 }), 0.8);
    assert.equal(cacheHitRate({ inputTokens: 0, cacheReadTokens: 1 }), undefined);
    assert.equal(cacheSavings(
      { inputTokens: 1_000_000, cacheReadTokens: 500_000 },
      { provider: "mock", model: "priced", cost: { input: 10, cacheRead: 2, unit: "1M tokens" } },
    ), 4);
    assert.equal(cacheSavings({ cacheReadTokens: 1 }, { provider: "mock", model: "free" }), undefined);
  });

  it("reports cache usage for read-only provider accounting", () => {
    assert.deepEqual(cacheUsageReport({ inputTokens: 1000, cacheReadTokens: 750 }), {
      cacheReadTokens: 750,
      cacheWriteTokens: 0,
      hitRate: 0.75,
      estimatedSavings: undefined,
      currency: undefined,
    });
    assert.equal(cacheUsageReport(undefined), undefined);
  });

  it("reports cache savings and currency from model pricing", () => {
    assert.deepEqual(cacheUsageReport(
      { inputTokens: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 1000 },
      { provider: "mock", model: "priced", cost: { input: 10, cacheRead: 2, unit: "1M tokens", currency: "USD" } },
    ), {
      cacheReadTokens: 500_000,
      cacheWriteTokens: 1000,
      hitRate: 0.5,
      estimatedSavings: 4,
      currency: "USD",
    });
  });
});
