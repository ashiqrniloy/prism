import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { Message, ModelConfig } from "../index.js";
import {
  anthropicMessagesBody,
  applyCacheControl,
  applyDefaultProviderRequestOptions,
  cacheHitRate,
  cacheSavings,
  cacheUsageReport,
  mapCacheRetention,
  resolveBreakpoint,
  sanitizeCacheKey,
} from "../provider-kit/index.js";

const messages: readonly Message[] = [
  { id: "sys", role: "system", content: [{ type: "text", text: "rules" }] },
  { id: "ctx", role: "user", content: [{ type: "text", text: "context" }] },
  { id: "tool", role: "assistant", content: [{ type: "tool_call", id: "call", name: "search", arguments: {} }] },
  { id: "last", role: "user", content: [{ type: "text", text: "question" }] },
];

describe("cache helpers", () => {
  it("resolves last_message, last_stable_message, and tools breakpoints", () => {
    assert.equal(resolveBreakpoint(messages, { location: "last_message" }), 3);
    assert.equal(resolveBreakpoint(messages, { location: "last_stable_message" }), 2);
    assert.equal(resolveBreakpoint(messages, { location: "tools" }), -1, "tools marks tool definitions, not messages");
    assert.equal(resolveBreakpoint([], { location: "last_message" }), -1);
    assert.equal(resolveBreakpoint([], { location: "last_stable_message" }), -1);
    assert.equal(resolveBreakpoint([{ id: "only", role: "user", content: [{ type: "text", text: "hi" }] }], { location: "last_message" }), 0);
    assert.equal(resolveBreakpoint([{ id: "only", role: "user", content: [{ type: "text", text: "hi" }] }], { location: "last_stable_message" }), 0);
  });

  it("applies maxBreakpoints after de-duplicating duplicate targets", () => {
    const stamped = applyCacheControl(
      messages,
      [
        { location: "system_prompt" },
        { location: "system_prompt" }, // duplicate target
        { location: "last_message" },
      ],
      { maxBreakpoints: 2 },
    );

    // Both index 0 (system) and index 3 (last_message) must receive cache_control
    assert.deepEqual(
      stamped.map((m) => m.content.at(-1)?.cache_control),
      [{ type: "ephemeral" }, undefined, undefined, { type: "ephemeral" }],
    );
  });

  it("markers never land on an empty block", () => {
    const messagesWithEmpty: readonly Message[] = [
      { id: "m1", role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "" }] },
      { id: "m2", role: "assistant", content: [{ type: "text", text: "   " }] },
    ];

    const stamped = applyCacheControl(
      messagesWithEmpty,
      [{ location: "last_message" }, { location: "stable_context" }],
      { maxBreakpoints: 2 },
    );

    // m1: the first block is non-empty ("hello"), the second is empty (""). Cache_control lands on block 0!
    assert.deepEqual(stamped[0]?.content[0]?.cache_control, { type: "ephemeral" });
    assert.equal(stamped[0]?.content[1]?.cache_control, undefined);

    // m2: all blocks are empty whitespace. No block in m2 receives cache_control!
    assert.equal(stamped[1]?.content[0]?.cache_control, undefined);
  });
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
    const stamped = applyCacheControl(
      messages,
      [{ location: "system_prompt" }, { location: "last_user_message" }, { location: "message_id", messageId: "tool" }],
      { maxBreakpoints: 2, ttl: "1h" },
    );

    assert.deepEqual(
      stamped.map((message) => message.content.at(-1)?.cache_control),
      [{ type: "ephemeral", ttl: "1h" }, undefined, undefined, { type: "ephemeral", ttl: "1h" }],
    );
    assert.equal(messages[0]?.content[0]?.type, "text", "original messages are not mutated");
  });

  it("computes cache hit rate and estimated read savings", () => {
    assert.equal(cacheHitRate({ inputTokens: 1000, cacheReadTokens: 800 }), 0.8);
    assert.equal(cacheHitRate({ inputTokens: 0, cacheReadTokens: 1 }), undefined);
    assert.equal(
      cacheSavings(
        { inputTokens: 1_000_000, cacheReadTokens: 500_000 },
        { provider: "mock", model: "priced", cost: { input: 10, cacheRead: 2, unit: "1M tokens" } },
      ),
      4,
    );
    assert.equal(cacheSavings({ cacheReadTokens: 1 }, { provider: "mock", model: "free" }), undefined);
  });

  it("reports only cache fields supplied by the provider", () => {
    assert.deepEqual(cacheUsageReport({ inputTokens: 1000, cacheReadTokens: 750 }), {
      cacheReadTokens: 750,
      hitRate: 0.75,
    });
    assert.equal(cacheUsageReport({ inputTokens: 1000 }), undefined);
    assert.equal(cacheUsageReport(undefined), undefined);
  });

  it("reports cache savings and currency from model pricing", () => {
    assert.deepEqual(
      cacheUsageReport(
        { inputTokens: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 1000 },
        { provider: "mock", model: "priced", cost: { input: 10, cacheRead: 2, unit: "1M tokens", currency: "USD" } },
      ),
      {
        cacheReadTokens: 500_000,
        cacheWriteTokens: 1000,
        hitRate: 0.5,
        estimatedSavings: 4,
        currency: "USD",
      },
    );
  });

  it("tools_breakpoint_marks_last_tool_definition", async () => {
    const request = {
      model: {
        provider: "hyper",
        model: "qwen-anthropic",
        cache: { kind: "cache_control" as const },
      },
      messages: [
        { role: "system" as const, content: [{ type: "text" as const, text: "sys rules" }] },
        { role: "user" as const, content: [{ type: "text" as const, text: "execute" }] },
      ],
      tools: [
        { name: "read_file", description: "read a file", parameters: { type: "object" as const }, execute: async () => ({ toolCallId: "", name: "", result: "" }) },
        { name: "write_file", description: "write a file", parameters: { type: "object" as const }, execute: async () => ({ toolCallId: "", name: "", result: "" }) },
        { name: "bash", description: "run a command", parameters: { type: "object" as const }, execute: async () => ({ toolCallId: "", name: "", result: "" }) },
      ],
      options: {
        cache: {
          breakpoints: [{ location: "tools" as const }],
        },
      },
    };

    const body = await anthropicMessagesBody(request);
    const tools = body.tools as any[];
    assert.equal(tools.length, 3);
    assert.equal(tools[0].name, "read_file");
    assert.equal(tools[0].cache_control, undefined);
    assert.equal(tools[1].name, "write_file");
    assert.equal(tools[1].cache_control, undefined);
    assert.equal(tools[2].name, "bash");
    assert.deepEqual(tools[2].cache_control, { type: "ephemeral" });

    // Assert messages have NO cache_control markers from the tools breakpoint
    const messagesArray = body.messages as any[];
    for (const msg of messagesArray) {
      for (const block of msg.content) {
        assert.equal(block.cache_control, undefined);
      }
    }
  });

  it("uncached_tail_is_one_turn_in_ten_turn_loop", async () => {
    // Construct a 10-turn tool loop
    const turns: Message[][] = [];
    const baseMessages: Message[] = [
      { role: "system", content: [{ type: "text", text: "system prompt instructions" }] },
      { role: "user", content: [{ type: "text", text: "start task" }] },
    ];
    turns.push([...baseMessages]);

    for (let i = 1; i <= 9; i++) {
      const prev = turns[i - 1]!;
      const nextTurn: Message[] = [
        ...prev,
        {
          role: "assistant",
          content: [
            { type: "text", text: `I am running step ${i}` },
            { type: "tool_call", id: `call_${i}`, name: "tool", arguments: { step: i } },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: `call_${i}`, name: "tool", result: `result of step ${i}` },
          ],
        },
      ];
      turns.push(nextTurn);
    }

    const req9 = applyDefaultProviderRequestOptions({
      model: { provider: "mock", model: "demo", cache: { kind: "cache_control" } },
      messages: turns[8]!,
    });
    const body9 = await anthropicMessagesBody(req9);
    const body9Messages = body9.messages as any[];
    let lastMarkedBlockIndexTurn9 = -1;
    for (let i = body9Messages.length - 1; i >= 0; i--) {
      if (body9Messages[i].content.some((b: any) => b.cache_control !== undefined)) {
        lastMarkedBlockIndexTurn9 = i;
        break;
      }
    }
    assert.equal(lastMarkedBlockIndexTurn9, body9Messages.length - 1, "last message of turn 9 is cached");

    const req10 = applyDefaultProviderRequestOptions({
      model: { provider: "mock", model: "demo", cache: { kind: "cache_control" } },
      messages: turns[9]!,
    });
    const body10 = await anthropicMessagesBody(req10);
    const body10Messages = body10.messages as any[];

    // Tokens/messages outside the previously cached prefix (turn 9's last marked message):
    const messagesOutsideCachedPrefix = body10Messages.slice(body9Messages.length);
    assert.equal(messagesOutsideCachedPrefix.length, 2, "uncached tail is strictly the single newest assistant+tool turn");

    // Contrast with the old last_stable_message behavior:
    const oldStableIndex = body9Messages.length - 2;
    const oldMessagesOutsideCached = body10Messages.slice(oldStableIndex + 1);
    assert.equal(oldMessagesOutsideCached.length, 3, "old last_stable_message left two full turns uncached");
  });
});
