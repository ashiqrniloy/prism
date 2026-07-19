import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import {
  createOpenAIProviderPackage,
  createOpenAIResponsesProvider,
  listOpenAIModels,
  mapOpenAIModel,
} from "../index.js";

const request: ProviderRequest = {
  model: { provider: "openai", model: "gpt-5.1" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session-1", cacheKey: "x".repeat(80), cacheRetention: "short" },
};

describe("@arnilo/prism-provider-openai responses", () => {
  it("openai_responses_stream_maps_text_thinking_tool_usage_and_done", async () => {
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: mockFetch(sse([
      { type: "response.output_text.delta", delta: "hello" },
      { type: "response.reasoning_text.delta", delta: "think" },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: "{\"q\":" },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: "\"x\"}" },
      { type: "response.function_call_arguments.done", output_index: 0, arguments: "{\"q\":\"x\"}" },
      { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 4 } } } },
    ])) });

    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4 } } });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "think"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("openai_responses_parses_string_function_call_arguments_delta", async () => {
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: mockFetch(sse([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", id: "fc_weather", call_id: "call_weather", name: "get_weather", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_weather", delta: "{\"location\":" },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_weather", delta: "\"Paris\"}" },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ])) });

    const events = await assertProviderStreamConforms({ provider, request });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_weather", name: "get_weather", arguments: { location: "Paris" } }]);
  });

  it("openai_responses_applies_prompt_cache_policy_session_headers_and_max_tokens", async () => {
    let body: any;
    let headers: Headers;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    } });

    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 321, temperature: 0.2 } } } });
    assert.equal(body.prompt_cache_key, "x".repeat(64));
    // short retention is OpenAI's automatic/implicit caching; do not emit an
    // invalid literal retention value.
    assert.equal(body.prompt_cache_retention, undefined);
    assert.equal(body.max_output_tokens, 321);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.2);
    assert.equal(headers!.get("x-client-request-id"), "session-1");
    assert.equal(headers!.get("authorization"), "Bearer fake-openai-key");
  });

  it("openai_responses_prompt_cache_key_and_24h_retention_match_docs", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    const longSupported = {
      ...request,
      options: { ...request.options, cacheKey: "tenant:demo:v1", cacheRetention: "long" as const },
      model: { ...request.model, cache: { kind: "openai_key" as const, longRetention: true } },
    };
    await assertProviderStreamConforms({ provider, request: longSupported });
    assert.equal(body.prompt_cache_key, "tenant:demo:v1");
    assert.equal(body.prompt_cache_retention, "24h");
  });

  it("openai_responses_long_retention_emits_24h_only_when_supported", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    const longSupported = { ...request, options: { ...request.options, cacheRetention: "long" as const }, model: { ...request.model, cache: { kind: "openai_key" as const, longRetention: true } } };
    await assertProviderStreamConforms({ provider, request: longSupported });
    assert.equal(body.prompt_cache_retention, "24h");

    let body2: any;
    const provider2 = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body2 = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    // Unknown model with no cache metadata must not emit an unsupported value.
    const longUnsupported = { ...request, options: { ...request.options, cacheRetention: "long" as const } };
    await assertProviderStreamConforms({ provider: provider2, request: longUnsupported });
    assert.equal(body2.prompt_cache_retention, undefined);
  });

  it("openai_responses_sanitizes_and_clamps_prompt_cache_key", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { cacheKey: "team/agent#1@" + "x".repeat(80), cacheRetention: "short" },
    } });
    // Disallowed chars stripped to "-", leading/trailing dashes trimmed, clamped to 64.
    assert.equal(body.prompt_cache_key.length, 64);
    assert.match(body.prompt_cache_key, /^team-agent-1-x+$/);
  });

  it("openai_responses_reasoning_effort_from_compat_and_per_turn_override", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        model: {
          ...request.model,
          compat: { api: "openai-responses", reasoning: { effort: "medium", summary: "auto" } },
        },
        options: {
          ...request.options,
          compat: { reasoning: { effort: "high" } },
        },
      },
    });
    assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" });
    assert.equal(body.api, undefined);
  });

  it("openai_responses_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers: Headers;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    } });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { ...request.options, headers: { authorization: "Bearer attacker", "x-client-request-id": "attacker-req", "content-type": "text/plain", "x-caller": "kept" } },
    } });
    assertProviderOwnedHeadersWin(headers!, {
      owned: { authorization: "Bearer fake-openai-key", "content-type": "application/json", "x-client-request-id": "session-1" },
      caller: { authorization: "Bearer attacker", "x-client-request-id": "attacker-req", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("openai_responses_aborts_fetch", async () => {
    const provider = createOpenAIResponsesProvider({ fetch: async (_url, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw init?.signal?.reason ?? new Error("aborted");
    } });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(async () => {
      for await (const _ of provider.generate({ ...request, signal: controller.signal })) { /* drain */ }
    }, /stop/);
  });

  it("openai_responses_serializes_assistant_output_text_and_top_level_function_call_with_call_id", async () => {
    const replay: ProviderRequest = {
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text"] } },
      messages: [
        { role: "assistant", content: [
          { type: "text", text: "calling tool" },
          { type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } },
        ] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        { role: "user", content: [{ type: "text", text: "thanks" }] },
      ],
    };
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });

    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
    assert.equal(body.input[0].role, "assistant");
    assert.deepEqual(body.input[0].content, [{ type: "output_text", text: "calling tool" }]);
    assert.deepEqual(body.input[1], {
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: "{\"q\":\"x\"}",
    });
    assert.equal((body.input[1] as { id?: unknown }).id, undefined);
    assert.deepEqual(body.input[2], {
      type: "function_call_output",
      call_id: "call_1",
      output: "{\"ok\":true}",
    });
    assert.deepEqual(body.input[3].content, [{ type: "input_text", text: "thanks" }]);
  });

  it("openai_responses_serializes_full_prism_content_replay", async () => {
    const replay: ProviderRequest = {
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text", "image"] } },
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] },
      ],
    };
    let body: unknown;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });

    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("openai_provider_setup_does_not_call_models", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createOpenAIProviderPackage({ apiKey: "fake-openai-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert.equal(fetchCalls, 0);
    assert(registered.some((item: any) => item.id === "openai"));
  });

  it("openai_provider_package_accepts_models_override", async () => {
    const custom: ModelConfig = { provider: "openai", model: "gpt-custom", displayName: "Custom" };
    const registered: ModelConfig[] = [];
    await createOpenAIProviderPackage({
      apiKey: "fake-openai-key",
      models: [custom],
      codexModels: [],
      fetch: mockFetch(sse([])),
    }).setup({
      registerProvider: () => {},
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: () => {},
    } as any);
    assert.deepEqual(registered.map((model) => model.model), ["gpt-custom"]);
  });

  it("openai_package_passes_provider_conformance_without_network", async () => {
    const registered: unknown[] = [];
    await createOpenAIProviderPackage({ apiKey: "fake-openai-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "openai"));
    assert(registered.some((item: any) => item.provider === "openai" && item.kind === "api_key"));
    assert(registered.some((item: any) => item.provider === "openai-codex" && item.kind === "oauth"));
  });

  it("list_openai_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let headers: Headers | undefined;
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const models = await listOpenAIModels({
      apiKey: "sk-secret-token",
      baseUrl: "https://example.test/v1/",
      signal: controller.signal,
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        signal = init?.signal;
        return new Response(JSON.stringify({
          object: "list",
          data: [
            { id: "gpt-5.1", object: "model", created: 1, owned_by: "openai" },
            { id: "gpt-4.1", object: "model", created: 2, owned_by: "openai" },
            { id: "gpt-5.6", object: "model", created: 3, owned_by: "openai" },
          ],
        }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(url, "https://example.test/v1/models");
    assert.equal(headers?.get("authorization"), "Bearer sk-secret-token");
    assert.equal(signal ?? undefined, controller.signal);
    assert.equal(models.length, 3);
    assert.equal(models[0]?.model, "gpt-5.1");
    assert.equal(models[0]?.cache?.kind, "openai_key");
    assert.equal(models[0]?.cache?.longRetention, true);
    assert.equal(models[1]?.cache?.longRetention, true);
    assert.equal(models[2]?.cache?.longRetention, false, "GPT-5.6+ uses prompt_cache_options, not 24h retention");
    assert.equal(models[0]?.compat?.api, "openai-responses");
  });

  it("list_openai_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listOpenAIModels({
        apiKey: "sk-leaked-secret",
        fetch: (async () => new Response("unauthorized sk-leaked-secret", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, /OpenAI model discovery failed: 401/);
        assert.equal(message.includes("sk-leaked-secret"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      },
    );
  });

  it("map_openai_model_rejects_malformed_entry", () => {
    assert.throws(() => mapOpenAIModel({ id: "" } as any), /missing id/);
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
