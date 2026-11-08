import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  anthropicMessagesEvents,
  cacheHitRate,
  mapOpenAIChatUsage,
  mapOpenAIResponsesUsage,
  mapSystemOneUsage,
  normalizeUsage,
} from "../provider-kit/index.js";
import type { ProviderEvent } from "../contracts.js";

function sse(events: readonly Record<string, unknown>[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function streamOf(payload: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
}

describe("provider usage contract (plan 182 Task 4)", () => {
  it("anthropic_usage_is_inclusive_of_cache", async () => {
    // Anthropic wire contract: input_tokens excludes cache read and creation tokens.
    // The mapper must normalize inputTokens = input_tokens + cache_read + cache_creation.
    const body = streamOf(
      sse([
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [],
            model: "claude-3-7-sonnet",
            usage: {
              input_tokens: 10,
              cache_read_input_tokens: 900,
              cache_creation_input_tokens: 90,
            },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message.delta",
          delta: { stop_reason: "end_turn" },
          usage: {
            input_tokens: 10,
            output_tokens: 40,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 90,
          },
        },
        { type: "message_stop" },
      ]),
    );

    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(body, undefined)) {
      events.push(event);
    }

    const usageEvent = events.find((e) => e.type === "usage") as Extract<ProviderEvent, { type: "usage" }> | undefined;
    assert(usageEvent, "Expected usage event in stream");
    assert.deepEqual(usageEvent.usage, {
      inputTokens: 1000,
      outputTokens: 40,
      totalTokens: 1040,
      cacheReadTokens: 900,
      cacheWriteTokens: 90,
    });
  });

  it("chat_usage_is_inclusive_of_cache", () => {
    // OpenAI Chat wire contract: prompt_tokens is already inclusive of cached tokens.
    const usage = mapOpenAIChatUsage({
      prompt_tokens: 1000,
      completion_tokens: 40,
      total_tokens: 1040,
      prompt_tokens_details: {
        cached_tokens: 900,
        cache_write_tokens: 90,
      },
    });

    assert.deepEqual(usage, {
      inputTokens: 1000,
      outputTokens: 40,
      totalTokens: 1040,
      cacheReadTokens: 900,
      cacheWriteTokens: 90,
    });
  });

  it("chat_usage_derives_total_tokens_when_vendor_omits_it", () => {
    const usage = mapOpenAIChatUsage({
      prompt_tokens: 1000,
      completion_tokens: 40,
      prompt_tokens_details: {
        cached_tokens: 900,
      },
    });

    assert.deepEqual(usage, {
      inputTokens: 1000,
      outputTokens: 40,
      totalTokens: 1040,
      cacheReadTokens: 900,
    });
  });

  it("chat_usage_reads_a_top_level_cache_creation_count", () => {
    // Command Code (measured 2026-11-08): `cache_creation_input_tokens` sits beside `prompt_tokens`, not in the details.
    const usage = mapOpenAIChatUsage({
      prompt_tokens: 3277,
      completion_tokens: 91,
      total_tokens: 3368,
      prompt_tokens_details: { cached_tokens: 0 },
      cache_creation_input_tokens: 3274,
    });

    assert.deepEqual(usage, {
      inputTokens: 3277,
      outputTokens: 91,
      totalTokens: 3368,
      cacheReadTokens: 0,
      cacheWriteTokens: 3274,
    });
  });

  it("responses_usage_reads_cache_write_tokens_as_a_subset_of_input", () => {
    // Command Code Responses (measured 2026-11-08): input_tokens 3045 is inclusive of cached 3042 on a warm request.
    const cold = mapOpenAIResponsesUsage({
      input_tokens: 3045,
      output_tokens: 5,
      total_tokens: 3050,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 3042 },
    });
    const warm = mapOpenAIResponsesUsage({
      input_tokens: 3045,
      output_tokens: 5,
      total_tokens: 3050,
      input_tokens_details: { cached_tokens: 3042, cache_write_tokens: 0 },
    });

    assert.deepEqual(cold, { inputTokens: 3045, outputTokens: 5, totalTokens: 3050, cacheReadTokens: 0, cacheWriteTokens: 3042 });
    assert.deepEqual(warm, { inputTokens: 3045, outputTokens: 5, totalTokens: 3050, cacheReadTokens: 3042, cacheWriteTokens: 0 });
  });

  it("cache_hit_rate_is_at_most_one", () => {
    // On the old exclusive Anthropic mapping:
    // { input_tokens: 10, cache_read_input_tokens: 900 } mapped to
    // { inputTokens: 10, cacheReadTokens: 900 }, making cacheHitRate = 900 / 10 = 90 (invalid hit rate > 1).
    // Under the inclusive contract:
    // inputTokens = 10 + 900 = 910, cacheHitRate = 900 / 910 ≈ 0.989 <= 1.
    const normalized = normalizeUsage({
      inputTokens: 10,
      cacheReadTokens: 900,
      inputTokensInclusive: false,
    });

    assert(normalized, "Expected normalized usage");
    assert.equal(normalized.inputTokens, 910);
    assert.equal(normalized.cacheReadTokens, 900);

    const hitRate = cacheHitRate(normalized);
    assert(hitRate !== undefined, "Expected valid hit rate");
    assert(hitRate <= 1.0, `Expected hit rate <= 1.0, got ${hitRate}`);
    assert.equal(hitRate, 900 / 910);
  });

  it("system_one_usage_derives_total_tokens_and_is_inclusive", () => {
    const usage = mapSystemOneUsage({ input_tokens: 50 });
    assert.deepEqual(usage, {
      inputTokens: 50,
      outputTokens: 0,
      totalTokens: 50,
    });
  });
});
