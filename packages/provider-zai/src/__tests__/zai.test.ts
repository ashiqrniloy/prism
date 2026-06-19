import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderEvent, ProviderRequest } from "prism";
import { assertProviderStreamConforms, assertToolCallDeltasReconstruct } from "prism/testing/provider-conformance";
import { createZaiProvider, createZaiProviderPackage, zaiModels } from "../index.js";

const request: ProviderRequest = {
  model: zaiModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
};

describe("@prism/provider-zai", () => {
  it("zai_registers_glm_model_metadata", async () => {
    const registered: unknown[] = [];
    await createZaiProviderPackage({ apiKey: "fake-zai-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "zai"));
    assert(registered.some((item: any) => item.provider === "zai" && item.model === "glm-4.7"));
    assert(registered.some((item: any) => item.provider === "zai" && item.kind === "api_key"));
  });

  it("zai_uses_system_role_when_developer_role_is_unsupported", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, "developer instructions");
  });

  it("zai_maps_thinking_and_reasoning_effort", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { compat: { reasoning_effort: "high", thinking: { type: "enabled" } } } } });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, "high");
  });

  it("zai_enables_tool_stream_for_supported_models", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([
        { choices: [{ delta: { content: "hi", reasoning_content: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 } } },
      ]));
    }) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assert.equal(body.tool_stream, true);
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("zai_redacts_api_key_from_http_errors", async () => {
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async () => new Response("bad fake-zai-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-zai-key"));
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
