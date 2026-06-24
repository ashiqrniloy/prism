import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import { createKimiCodingProvider, createKimiProviderPackage, kimiCodingModels, moonshotKimiModels } from "../index.js";

const request: ProviderRequest = {
  model: kimiCodingModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "assistant", content: [{ type: "thinking", text: "prior reasoning" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "tool_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-provider-kimi", () => {
  it("kimi_registers_kimi_coding_models_by_default", async () => {
    const registered: unknown[] = [];
    await createKimiProviderPackage({ kimiApiKey: "fake-kimi-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "kimi-coding"));
    assert(registered.some((item: any) => item.provider === "kimi-coding" && item.model === "kimi-k2.7-code"));
    assert(!registered.some((item: any) => item.provider === "moonshot"));
  });

  it("kimi_anthropic_stream_maps_text_thinking_tool_calls_usage", async () => {
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: mockFetch(sse([
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "think" } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"x\"}" } },
      { type: "message_delta", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("kimi_preserves_reasoning_for_tool_replay", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(body.system, "instructions");
    assert.deepEqual(body.messages[0].content, [{ type: "thinking", thinking: "prior reasoning" }]);
  });

  it("kimi_optional_moonshot_metadata_is_app_selected", async () => {
    const registered: unknown[] = [];
    await createKimiProviderPackage({ kimiApiKey: "fake-kimi-key", includeMoonshotModels: true, moonshotModels: moonshotKimiModels, fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.provider === "moonshot" && item.model === "kimi-k2.7-code-preview"));
  });

  it("kimi_anthropic_preserves_thinking_tool_use_and_tool_result", async () => {
    const replay: ProviderRequest = {
      model: kimiCodingModels[0],
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "tool_1", name: "lookup", arguments: { q: "x" } }, { type: "thinking", text: "plan" }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "tool_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let body: unknown;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("kimi_redacts_subscription_or_api_key_errors", async () => {
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async () => new Response("bad fake-kimi-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-kimi-key"));
  });
});

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () => ok(body)) as typeof fetch;
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
