import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CacheControlledMessage, JsonObject, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { anthropicMessagesBody, anthropicMessagesEvents, type AnthropicMessagesRouteHooks } from "../anthropic-messages.js";

const model: ModelConfig = {
  provider: "shared-fixture",
  model: "test-model",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "anthropic", preserveThinking: true, ownedTwist: "must-not-leak" },
  cache: { kind: "cache_control" },
  limits: { maxOutputTokens: 2048 },
};

const hooks: AnthropicMessagesRouteHooks = {
  applyCacheControl: (request) => {
    const messages: CacheControlledMessage[] = [...request.messages] as CacheControlledMessage[];
    const last = messages.at(-1);
    if (last && last.role !== "tool") {
      messages[messages.length - 1] = {
        ...last,
        content: last.content.map((block, blockIndex) =>
          blockIndex === last.content.length - 1 ? { ...block, cache_control: { type: "ephemeral" } } : block,
        ),
      };
    }
    return messages;
  },
  preserveThinking: () => true,
  stripOwnedCompat: (compat) => {
    const {
      route: _route,
      reasoning_effort: _effort,
      preserveThinking: _preserve,
      ownedTwist: _ownedTwist,
      ...rest
    } = (compat ?? {}) as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? (rest as JsonObject) : undefined;
  },
};

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "be brief" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", text: "hidden", signature: "sig" },
        { type: "text", text: "ok" },
      ],
    },
  ],
  tools: [
    {
      name: "lookup",
      parameters: { type: "object", properties: { b: {}, a: {} } },
      execute: () => ({ toolCallId: "c", name: "lookup", content: [] }),
    },
  ],
  options: { compat: { route: "anthropic", preserveThinking: true, ownedTwist: "must-not-leak" } },
};

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("@arnilo/prism-providers/shared/anthropic-messages", () => {
  it("shared_anthropic_body_serializes_messages_system_tools_and_drops_owned_compat", async () => {
    const body = await anthropicMessagesBody(request, hooks);
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.system, "be brief");
    assert.deepEqual(
      (body.messages as any[]).map((m: any) => m.role),
      ["user", "assistant"],
    );
    const assistant = (body.messages as any[])[1];
    assert.deepEqual(assistant.content[0], { type: "thinking", thinking: "hidden", signature: "sig" });
    // cache marker applied to the last-stable message only (here: assistant); user untouched
    assert.equal(assistant.content[1].cache_control?.type, "ephemeral");
    const user = (body.messages as any[])[0];
    assert.equal(user.content[0].cache_control, undefined);
    // owned compat removed, caller compat preserved
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("ownedTwist"), "provider-owned compat must not reach the wire");
    assert.ok(!serialized.includes("preserveThinking"), "provider-owned compat must not reach the wire");
    // tool schema canonicalized (keys sorted: a before b)
    assert.ok(serialized.includes('"properties":{"a":{},"b":{}}'));
  });

  it("shared_anthropic_events_yields_deltas_tool_usage_and_done", async () => {
    const stream = ok(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "thinking" } },
        { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "think" } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } },
        { type: "content_block_stop", index: 2 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
        },
        { type: "message_stop" },
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);

    assert.equal(events[0].type, "content_delta");
    assert.equal((events[0] as any).content.text, "hi");
    assert(events.some((e) => e.type === "content_delta" && e.content.type === "thinking"));
    const usage = events.find((e) => e.type === "usage") as any;
    assert.equal(usage.usage.inputTokens, 10);
    assert.equal(usage.usage.outputTokens, 5);
    assert.equal(usage.usage.cacheReadTokens, 4);
    assert.equal(usage.usage.cacheWriteTokens, 2);
    assert.deepEqual(
      events.filter((e) => e.type === "tool_call").map((e: any) => e.call),
      [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }],
    );
    assert.equal(events.at(-1)?.type, "done");
  });

  it("shared_anthropic_events_fails_truncated_stream_without_done", async () => {
    const stream = ok(
      sse([
        { type: "message_start" },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
        // no content_block_stop, no message_stop
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as any).error?.message ?? events.at(-1)), /completion evidence/);
    assert.ok(!events.some((e) => e.type === "done"), "truncated stream must not emit done");
  });
});
