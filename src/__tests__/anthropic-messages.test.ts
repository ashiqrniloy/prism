import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import type { CacheControlledMessage } from "@arnilo/prism/provider-kit";
import {
  type AnthropicMessagesRouteHooks,
  anthropicMessagesBody,
  anthropicMessagesEvents,
} from "../provider-kit/codecs/anthropic-messages.js";
import { createToolNameMap } from "../provider-kit/tool-names.js";

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
  thinking: () => undefined,
  effort: () => undefined,
  stripOwnedCompat: (compat) => {
    const {
      route: _route,
      reasoning_effort: _effort,
      preserveThinking: _preserve,
      ownedTwist: _ownedTwist,
      thinkingFamily: _family,
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

describe("@arnilo/prism/provider-kit (anthropic-messages)", () => {
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

  it("shared_anthropic_body_carries_trailing_tool_result_text", async () => {
    const withTool: ProviderRequest = {
      model,
      messages: [
        {
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: "call_1", name: "read", result: "file body" },
            { type: "text", text: "[context-files] nested rule" },
          ],
        },
      ],
    };
    const body = await anthropicMessagesBody(withTool, hooks);
    const content = (body.messages as any[])[0]?.content;
    assert.equal(content?.[0]?.content, "file body\n[context-files] nested rule");
  });

  it("shared_anthropic_body_emits_resolved_thinking_and_output_config_effort", async () => {
    const body = await anthropicMessagesBody(
      { ...request, options: { compat: { thinking: { type: "adaptive" }, reasoning_effort: "medium" } } },
      {
        ...hooks,
        thinking: (r) => r.options?.compat?.thinking as JsonObject | undefined,
        effort: (r) => (r.options?.compat?.reasoning_effort as string | undefined) ?? undefined,
      },
    );
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.deepEqual(body.output_config, { effort: "medium" });
    assert.equal(body.effort, undefined, "no top-level effort field may reach the wire");
    assert.ok(!JSON.stringify(body).includes("reasoning_effort"), "resolved effort must not leak as a raw compat key");
  });

  it("shared_anthropic_body_and_events_encode_dotted_tool_names", async () => {
    const dotted = { ...request, tools: [{ ...request.tools![0], name: "memory.recall" }] };
    const body = await anthropicMessagesBody(dotted, hooks);
    assert.equal((body.tools as JsonObject[])[0]?.name, "memory_recall");
    const replay = await anthropicMessagesBody(
      {
        ...dotted,
        messages: [
          ...dotted.messages,
          { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "memory.recall", arguments: {} }] },
        ],
      },
      hooks,
    );
    const replayed = (replay.messages as JsonObject[]).at(-1)?.content as JsonObject[];
    assert.equal(replayed?.at(-1)?.name, "memory_recall");

    const stream = ok(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "memory_recall" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ]),
    );
    const events = [];
    for await (const event of anthropicMessagesEvents(stream.body!, { toolNames: createToolNameMap(dotted.tools) })) events.push(event);
    const call = events.find((event) => event.type === "tool_call") as { call?: { name?: string } } | undefined;
    assert.equal(call?.call?.name, "memory.recall", "the decoded call uses the product name");
  });

  it("shared_anthropic_body_emits_no_thinking_fields_when_hooks_return_none", async () => {
    const body = await anthropicMessagesBody(request, hooks);
    assert.equal(body.thinking, undefined);
    assert.equal(body.output_config, undefined);
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
    assert.equal(usage.usage.inputTokens, 16);
    assert.equal(usage.usage.outputTokens, 5);
    assert.equal(usage.usage.totalTokens, 21);
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

  it("anthropic_message_delta_sets_stop_reason_and_usage", async () => {
    const stream = ok(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 2 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 8 },
        },
        { type: "message_stop" },
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);

    const usageEvent = events.find((e) => e.type === "usage") as any;
    assert.ok(usageEvent, "providerUsage must be yielded on message_delta");
    assert.equal(usageEvent.usage.inputTokens, 12);
    assert.equal(usageEvent.usage.outputTokens, 8);
    assert.equal(usageEvent.usage.totalTokens, 20);

    const doneEvent = events.at(-1) as any;
    assert.equal(doneEvent?.type, "done");
    assert.equal(doneEvent?.stopReason, "end_turn");
    assert.equal(doneEvent?.usage?.inputTokens, 12);
    assert.equal(doneEvent?.usage?.outputTokens, 8);
  });

  it("anthropic_usage_merges_start_and_delta", async () => {
    const stream = ok(
      sse([
        {
          type: "message_start",
          message: { usage: { input_tokens: 12, cache_read_input_tokens: 900 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ans" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 40 },
        },
        { type: "message_stop" },
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);

    const doneEvent = events.at(-1) as any;
    assert.equal(doneEvent?.type, "done");
    assert.deepEqual(doneEvent.usage, {
      inputTokens: 912,
      outputTokens: 40,
      cacheReadTokens: 900,
      totalTokens: 952,
    });
  });

  it("anthropic_signature_delta_is_captured_and_replayed", async () => {
    const stream = ok(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "deep thought" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_12345" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "result" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
        { type: "message_stop" },
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);

    const thinkingDeltas = events.filter((e) => e.type === "content_delta" && e.content.type === "thinking");
    assert.ok(thinkingDeltas.length >= 2, "must yield thinking text and signature deltas");
    const sigDelta = thinkingDeltas.find((e: any) => e.content.signature === "sig_12345");
    assert.ok(sigDelta, "signature_delta must be emitted in content_delta");

    // Test encoder replay with signature
    const replayRequest: ProviderRequest = {
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: "question" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "deep thought", signature: "sig_12345" },
            { type: "text", text: "result" },
          ],
        },
        { role: "user", content: [{ type: "text", text: "follow up" }] },
      ],
    };
    const body = await anthropicMessagesBody(replayRequest, hooks);
    const assistantMsg = (body.messages as any[])[1];
    assert.deepEqual(assistantMsg.content[0], {
      type: "thinking",
      thinking: "deep thought",
      signature: "sig_12345",
    });
  });

  it("anthropic_unsigned_thinking_replays_as_text", async () => {
    const replayRequest: ProviderRequest = {
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: "question" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "unsigned reasoning" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    };
    const body = await anthropicMessagesBody(replayRequest, hooks);
    const assistantMsg = (body.messages as any[])[1];
    // Must replay as text, NEVER as an unsigned thinking block
    assert.deepEqual(assistantMsg.content[0], {
      type: "text",
      text: "unsigned reasoning",
    });
  });

  it("anthropic_redacted_thinking_round_trips", async () => {
    const stream = ok(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "enc_blob_xyz" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "safe answer" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ]),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);

    const redacted = events.find((e) => e.type === "content_delta" && e.content.type === "thinking" && e.content.redacted === true) as any;
    assert.ok(redacted, "redacted_thinking block must be emitted");
    assert.equal(redacted.content.data, "enc_blob_xyz");

    // Replay through encoder
    const replayRequest: ProviderRequest = {
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: "prompt" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "", redacted: true, data: "enc_blob_xyz" },
            { type: "text", text: "safe answer" },
          ],
        },
      ],
    };
    const body = await anthropicMessagesBody(replayRequest, hooks);
    const assistantMsg = (body.messages as any[])[1];
    assert.deepEqual(assistantMsg.content[0], {
      type: "redacted_thinking",
      data: "enc_blob_xyz",
    });
  });

  it("anthropic_error_event_maps_transient_codes", async () => {
    // 1. overloaded_error -> transient
    const stream1 = ok(sse([{ type: "message_start" }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
    const events1: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream1.body!, undefined)) events1.push(event);
    assert.equal(events1.length, 1);
    assert.equal(events1[0].type, "error");
    assert.equal((events1[0] as any).error.code, "overloaded_error");
    assert.equal((events1[0] as any).error.failureClass, "transient");

    // 2. api_error -> transient
    const stream2 = ok(sse([{ type: "error", error: { type: "api_error", message: "Internal server error" } }]));
    const events2: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream2.body!, undefined)) events2.push(event);
    assert.equal(events2[0].type, "error");
    assert.equal((events2[0] as any).error.code, "api_error");
    assert.equal((events2[0] as any).error.failureClass, "transient");

    // 3. invalid_request_error -> permanent
    const stream3 = ok(sse([{ type: "error", error: { type: "invalid_request_error", message: "Invalid model" } }]));
    const events3: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream3.body!, undefined)) events3.push(event);
    assert.equal(events3[0].type, "error");
    assert.equal((events3[0] as any).error.code, "invalid_request_error");
    assert.equal((events3[0] as any).error.failureClass, "permanent");
  });

  it("anthropic_malformed_frame_is_terminal_error", async () => {
    const encoder = new TextEncoder();
    const stream = ok(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: {invalid json frame\n\n"));
          controller.close();
        },
      }),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(String((events[0] as any).error.message), /Malformed Anthropic SSE frame/);
    assert.ok(!events.some((e) => e.type === "done"), "stream must not emit done on malformed frame");
  });

  it("anthropic_ignores_ping", async () => {
    const encoder = new TextEncoder();
    const stream = ok(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "message_start",
                message: { usage: { input_tokens: 3, output_tokens: 1 } },
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "content_block_start",
                index: 0,
                content_block: { type: "text" },
              })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "pong" },
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                usage: { output_tokens: 2 },
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`));
          controller.close();
        },
      }),
    );
    const events: ProviderEvent[] = [];
    for await (const event of anthropicMessagesEvents(stream.body!, undefined)) events.push(event);
    assert.equal(events[0].type, "content_delta");
    assert.equal((events[0] as any).content.text, "pong");
    assert.equal(events.at(-1)?.type, "done");
  });

  it("anthropic_tool_result_sets_is_error", async () => {
    const body = await anthropicMessagesBody(
      {
        model,
        messages: [
          {
            role: "tool",
            content: [{ type: "tool_result", toolCallId: "call_1", name: "shell", error: { name: "Error", message: "boom" } }],
          },
        ],
      },
      hooks,
    );
    const block = (body.messages as any[])[0].content[0];
    assert.equal(block.type, "tool_result");
    assert.equal(block.is_error, true);
    assert.equal(block.content, "boom");
  });

  it("anthropic_tool_result_carries_image_block", async () => {
    const body = await anthropicMessagesBody(
      {
        model: { ...model, capabilities: { input: ["text", "image"], output: ["text"] } },
        messages: [
          {
            role: "tool",
            content: [
              { type: "tool_result", toolCallId: "call_1", name: "read", result: "screenshot" },
              { type: "image", mimeType: "image/png", data: PNG_1X1 },
            ],
          },
        ],
      },
      hooks,
    );
    const block = (body.messages as any[])[0].content[0];
    assert.equal(block.content[0].type, "text");
    assert.equal(block.content[0].text, "screenshot");
    assert.equal(block.content[1].type, "image");
    assert.equal(block.content[1].source.type, "base64");
    assert.equal(block.content[1].source.data, PNG_1X1);
  });

  it("anthropic_tool_result_image_without_capability_is_noted", async () => {
    const body = await anthropicMessagesBody(
      {
        model,
        messages: [
          {
            role: "tool",
            content: [
              { type: "tool_result", toolCallId: "call_1", name: "read", result: "screenshot" },
              { type: "image", mimeType: "image/png", data: PNG_1X1 },
            ],
          },
        ],
      },
      hooks,
    );
    const block = (body.messages as any[])[0].content[0];
    assert.equal(typeof block.content, "string");
    assert.match(block.content, /screenshot/);
    assert.match(block.content, /\[image omitted: the model does not accept images\]/);
  });
});

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
