import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, ModelConfig, ProviderEvent, ProviderRequest } from "prism";
import { assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "prism/testing/provider-conformance";
import { createOpenCodeGoProvider, createOpenCodeGoProviderPackage } from "../index.js";

const baseRequest: ProviderRequest = {
  model: { provider: "opencode-go", model: "gpt-5.1-go", compat: { route: "openai" } },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session with spaces" },
};

describe("@prism/provider-opencode-go", () => {
  it("opencode_go_registers_pi_model_metadata", async () => {
    const registered: unknown[] = [];
    await createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "opencode-go"));
    assert(registered.some((item: any) => item.provider === "opencode-go" && item.model === "gpt-5.1-go"));
    assert(registered.some((item: any) => item.provider === "opencode-go" && item.kind === "api_key"));
  });

  it("opencode_go_openai_route_streams_text_thinking_tool_calls", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: mockFetch(sse([
      { choices: [{ delta: { content: "hi", reasoning_content: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 } } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("opencode_go_anthropic_route_streams_text_tool_calls_and_usage", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: mockFetch(sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"y\"}" } },
      { type: "message_delta", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
    ])) });
    const request = { ...baseRequest, model: { provider: "opencode-go", model: "claude-sonnet-4.5-go", compat: { route: "anthropic" } } };
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "y" } }]);
  });

  it("opencode_go_applies_session_cache_headers", async () => {
    let url = "";
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(url.endsWith("/chat/completions"), true);
    assert.equal(headers.get("x-opencode-session"), "session-with-spaces");
    assert.equal(headers.get("authorization"), "Bearer fake-opencode-key");
  });

  it("opencode_go_openai_and_anthropic_routes_cover_tool_result_replay", async () => {
    const replayOpenAI: ProviderRequest = {
      model: { provider: "opencode-go", model: "gpt-5.1-go", compat: { route: "openai" }, capabilities: { input: ["text"] } },
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let bodyOpenAI: unknown;
    const openAI = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      bodyOpenAI = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider: openAI, request: replayOpenAI });
    assertSerializedRequestCoversContent(replayOpenAI, bodyOpenAI);

    const replayAnthropic: ProviderRequest = {
      model: { provider: "opencode-go", model: "claude-sonnet-4.5-go", compat: { route: "anthropic" }, capabilities: { input: ["text"] } },
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "tool_1", name: "lookup", arguments: { q: "y" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "tool_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let bodyAnthropic: unknown;
    const anthropic = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      bodyAnthropic = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider: anthropic, request: replayAnthropic });
    assertSerializedRequestCoversContent(replayAnthropic, bodyAnthropic);
  });

  it("opencode_go_redacts_api_key_from_errors", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => new Response("bad fake-opencode-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-opencode-key"));
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
