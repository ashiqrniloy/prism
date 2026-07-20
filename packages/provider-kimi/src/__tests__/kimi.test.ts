import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, Message, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import {
  createKimiCodingProvider,
  createKimiProviderPackage,
  createMoonshotProvider,
  kimiAnthropicBody,
  kimiCodingModels,
  listKimiModels,
  mapKimiModel,
  moonshotBody,
  moonshotKimiModels,
  stripKimiThinkingCompat,
} from "../index.js";

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
    assert(registered.some((item: any) => item.provider === "kimi-coding" && item.model === "kimi-for-coding"));
    assert(registered.some((item: any) => item.provider === "kimi-coding" && item.model === "k3"));
    assert(!registered.some((item: any) => item.provider === "moonshot" || item.id === "moonshot"));
  });

  it("kimi_provider_setup_does_not_call_model_discovery", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch;
    await createKimiProviderPackage({
      kimiApiKey: "fake-kimi-key",
      includeMoonshotModels: true,
      moonshotApiKey: "fake-moonshot-key",
      fetch: fetchImpl,
    }).setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as any);
    assert.equal(fetchCalls, 0);
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

  it("kimi_preserves_reasoning_for_tool_replay_and_maps_max_tokens", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 444, temperature: 0.5 } } } });
    assert.equal(body.system, "instructions");
    assert.deepEqual(body.messages[0].content, [{ type: "thinking", thinking: "prior reasoning" }]);
    assert.equal(body.max_tokens, 444);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.5);
    // Official: omit thinking for K2.7-code unless the host sets compat.thinking
    assert.equal(body.thinking, undefined);
  });

  it("kimi_per_turn_thinking_and_reasoning_effort_override_model_defaults", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const model: ModelConfig = {
      ...kimiCodingModels.find((item) => item.model === "k3")!,
      compat: { route: "anthropic", preserveThinking: true, reasoning_effort: "max" },
    };
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        model,
        options: { compat: { reasoning_effort: "high", thinking: { type: "enabled" } } },
      },
    });
    assert.equal(body.reasoning_effort, "high");
    assert.deepEqual(body.thinking, { type: "enabled" });
  });

  it("kimi_optional_moonshot_registers_callable_provider_and_models", async () => {
    const registered: unknown[] = [];
    await createKimiProviderPackage({
      kimiApiKey: "fake-kimi-key",
      includeMoonshotModels: true,
      moonshotApiKey: "fake-moonshot-key",
      moonshotModels: moonshotKimiModels,
      fetch: mockFetch(sse([])),
    }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "moonshot"));
    assert(registered.some((item: any) => item.provider === "moonshot" && item.model === "kimi-k2.7-code"));
    assert(registered.some((item: any) => item.provider === "moonshot" && item.model === "kimi-k3"));
    assert(registered.some((item: any) => item.provider === "moonshot" && item.kind === "api_key"));
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

  it("kimi_default_model_emits_no_cache_control_for_implicit_caching", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } } } });
    assert.ok(!JSON.stringify(body).includes("cache_control"), "default Kimi body must not contain cache_control");
  });

  it("kimi_opted_in_cache_control_applies_only_to_selected_breakpoints", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "stable" }] },
      { role: "user", content: [{ type: "text", text: "current" }] },
    ];
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      model: { ...request.model, cache: { kind: "cache_control" as const, longRetention: true } },
      messages,
      options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } },
    } });
    assert.deepEqual(body.messages.find((m: any) => m.role === "assistant").content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
    const others = body.messages.filter((m: any) => m.role !== "assistant");
    for (const m of others) for (const block of m.content) assert.equal(block.cache_control, undefined);
  });

  it("moonshot_openai_route_never_emits_anthropic_cache_control", async () => {
    const body = moonshotBody({
      model: { ...moonshotKimiModels[0], cache: { kind: "cache_control" as const } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: {
        cacheRetention: "long",
        cache: { breakpoints: [{ location: "last_stable_message" as const }] },
      },
    });
    assert.ok(!JSON.stringify(body).includes("cache_control"));
  });

  it("moonshot_preserves_reasoning_content_on_assistant_replay", async () => {
    let body: any;
    const provider = createMoonshotProvider({
      apiKey: "fake-moonshot-key",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return ok(chatSse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        model: moonshotKimiModels[0],
        messages: [
          { role: "assistant", content: [{ type: "thinking", text: "plan" }, { type: "text", text: "done" }] },
          { role: "user", content: [{ type: "text", text: "continue" }] },
        ],
      },
    });
    assert.equal(body.messages[0].role, "assistant");
    assert.equal(body.messages[0].content, "done");
    assert.equal(body.messages[0].reasoning_content, "plan");
    assert.equal(body.thinking, undefined);
  });

  it("moonshot_stream_maps_reasoning_content_and_usage", async () => {
    const provider = createMoonshotProvider({
      apiKey: "fake-moonshot-key",
      fetch: mockFetch(chatSse([
        { choices: [{ delta: { reasoning_content: "think" } }] },
        { choices: [{ delta: { content: "hello" } }] },
        { usage: { prompt_tokens: 2, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 1 } } },
      ])),
    });
    await assertProviderStreamConforms({
      provider,
      request: { model: moonshotKimiModels[0], messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      expect: { text: "hello", usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 1 } },
    });
  });

  it("list_kimi_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let headers: Headers | undefined;
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const models = await listKimiModels({
      apiKey: "sk-moonshot-secret",
      baseUrl: "https://example.test/v1/",
      signal: controller.signal,
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        signal = init?.signal;
        return new Response(JSON.stringify({
          object: "list",
          data: [
            {
              id: "kimi-k3",
              object: "model",
              created: 1,
              owned_by: "moonshot",
              context_length: 1_048_576,
              supports_image_in: true,
              supports_video_in: false,
              supports_reasoning: true,
            },
            {
              id: "kimi-k2.7-code",
              object: "model",
              created: 2,
              owned_by: "moonshot",
              context_length: 256_000,
              supports_image_in: false,
              supports_reasoning: true,
            },
            {
              id: "moonshot-v1-8k",
              object: "model",
              created: 3,
              owned_by: "moonshot",
              context_length: 8192,
              supports_image_in: false,
              supports_reasoning: false,
            },
          ],
        }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(url, "https://example.test/v1/models");
    assert.equal(headers?.get("authorization"), "Bearer sk-moonshot-secret");
    assert.equal(signal ?? undefined, controller.signal);
    assert.equal(models.length, 3);
    assert.equal(models[0]?.model, "kimi-k3");
    assert.equal(models[0]?.provider, "moonshot");
    assert.equal(models[0]?.compat?.route, "openai");
    assert.equal(models[0]?.compat?.reasoning_effort, "max");
    assert.equal(models[0]?.limits?.contextWindow, 1_048_576);
    assert.deepEqual(models[0]?.capabilities?.input, ["text", "image"]);
    assert.equal(models[1]?.model, "kimi-k2.7-code");
    assert.equal(models[1]?.compat?.preserveThinking, true);
    assert.equal(models[1]?.compat?.thinking, undefined);
    assert.equal(models[2]?.capabilities?.reasoning, false);
  });

  it("list_kimi_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listKimiModels({
        apiKey: "sk-leaked-moonshot",
        fetch: (async () => new Response("unauthorized sk-leaked-moonshot", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, /Kimi model discovery failed: 401/);
        assert.equal(message.includes("sk-leaked-moonshot"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      },
    );
  });

  it("map_kimi_model_rejects_malformed_entry", () => {
    assert.throws(() => mapKimiModel({ id: "" } as any), /missing id/);
  });

  it("kimi_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", userAgent: "MyApp/2.0", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { ...request.options, headers: { authorization: "Bearer attacker", "content-type": "text/plain", "user-agent": "attacker-ua", "x-caller": "kept" } } } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-kimi-key", "content-type": "application/json", "user-agent": "MyApp/2.0" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "user-agent": "attacker-ua", "x-caller": "kept" },
    });
  });

  it("kimi_redacts_subscription_or_api_key_errors", async () => {
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async () => new Response("bad fake-kimi-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-kimi-key"));
  });

  it("featured_coding_ids_prefer_official_over_pi_k2p7_alias", () => {
    assert.ok(kimiCodingModels.some((model) => model.model === "kimi-for-coding"));
    assert.ok(kimiCodingModels.some((model) => model.model === "kimi-for-coding-highspeed"));
    assert.ok(kimiCodingModels.some((model) => model.model === "k3"));
    assert.ok(!kimiCodingModels.some((model) => model.model === "k2p7"));
    assert.ok(!kimiCodingModels.some((model) => model.model === "kimi-k2.7-code"), "Open Platform id belongs on moonshot featured catalog");
  });

  it("featured_catalogs_match_official_context_windows_and_reasoning_defaults", () => {
    const coding = (id: string) => kimiCodingModels.find((model) => model.model === id)!;
    // Official: 256K-class models are 262_144 tokens; Coding k3 default effort is "high".
    assert.equal(coding("kimi-for-coding").limits?.contextWindow, 262_144);
    assert.equal(coding("kimi-for-coding-highspeed").limits?.contextWindow, 262_144);
    assert.equal(coding("k3").limits?.contextWindow, 1_048_576);
    assert.equal(coding("k3").compat?.reasoning_effort, "high");

    const moonshot = (id: string) => moonshotKimiModels.find((model) => model.model === id)!;
    // Official Open Platform catalog: k2.7-code (+highspeed), k2.6, k2.5, k3.
    for (const id of ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5", "kimi-k3"]) {
      assert.ok(moonshotKimiModels.some((model) => model.model === id), `missing featured moonshot model ${id}`);
    }
    assert.equal(moonshot("kimi-k2.7-code").limits?.contextWindow, 262_144);
    assert.equal(moonshot("kimi-k2.7-code-highspeed").limits?.contextWindow, 262_144);
    assert.equal(moonshot("kimi-k2.6").limits?.contextWindow, 262_144);
    assert.equal(moonshot("kimi-k2.5").limits?.contextWindow, 262_144);
    // Official Open Platform K3 default effort is "max".
    assert.equal(moonshot("kimi-k3").compat?.reasoning_effort, "max");
    // Official: K2.7-code / K3 preserve; K2.5 must not (no Preserved Thinking support).
    assert.equal(moonshot("kimi-k2.7-code").compat?.preserveThinking, true);
    assert.equal(moonshot("kimi-k2.7-code-highspeed").compat?.preserveThinking, true);
    assert.equal(moonshot("kimi-k2.5").compat?.preserveThinking, undefined);
    // Official: K2.6/K2.5 thinking enabled default.
    assert.deepEqual(moonshot("kimi-k2.6").compat?.thinking, { type: "enabled" });
    assert.deepEqual(moonshot("kimi-k2.5").compat?.thinking, { type: "enabled" });
  });

  it("strip_kimi_thinking_compat_removes_routing_and_serialization_keys", () => {
    assert.deepEqual(
      stripKimiThinkingCompat({ route: "anthropic", preserveThinking: true, preserve_thinking: true, thinking: false, reasoning_effort: "max", reasoningEffort: "max", custom: "kept" }),
      { custom: "kept" },
    );
  });

  it("compat_route_and_preserve_thinking_do_not_leak_into_wire_bodies", async () => {
    const codingBody = await kimiAnthropicBody({ ...request, options: { compat: { route: "anthropic", preserve_thinking: true, custom: "kept" } } });
    assert.equal(codingBody.route, undefined);
    assert.equal(codingBody.preserve_thinking, undefined);
    assert.equal(codingBody.custom, "kept");

    const chatBody = moonshotBody({ ...request, model: moonshotKimiModels[0], options: { compat: { route: "openai", preserve_thinking: true, custom: "kept" } } });
    assert.equal(chatBody.route, undefined);
    assert.equal(chatBody.preserve_thinking, undefined);
    assert.equal(chatBody.custom, "kept");
  });

  it("kimi_coding_route_sends_provider_owned_anthropic_auth_headers", async () => {
    let headers = new Headers();
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(headers.get("authorization"), "Bearer fake-kimi-key");
    assert.equal(headers.get("x-api-key"), "fake-kimi-key");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
  });

  it("kimi_coding_route_caller_headers_cannot_override_anthropic_auth", async () => {
    let headers = new Headers();
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { headers: { authorization: "Bearer attacker", "x-api-key": "attacker-key", "anthropic-version": "1999-01-01", "x-caller": "kept" } },
    } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-kimi-key", "x-api-key": "fake-kimi-key", "anthropic-version": "2023-06-01" },
      caller: { authorization: "Bearer attacker", "x-api-key": "attacker-key", "anthropic-version": "1999-01-01", "x-caller": "kept" },
    });
  });

  it("kimi_anthropic_route_fails_stream_without_message_stop", async () => {
    const truncated = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } })}\n\n`,
      ));
      controller.close();
    } });
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: mockFetch(truncated) });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!events.some((event) => event.type === "done"));
  });

  it("moonshot_route_fails_truncated_stream_without_done_or_finish_reason", async () => {
    const truncated = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
      ));
      controller.close();
    } });
    const provider = createMoonshotProvider({ apiKey: "fake-moonshot-key", fetch: mockFetch(truncated) });
    const events = await assertProviderStreamConforms({ provider, request: { ...request, model: moonshotKimiModels[0] } });
    assert.equal(events.at(-1)?.type, "error");
    assert(!events.some((event) => event.type === "done"));
  });

  it("moonshot_route_succeeds_with_done_marker_and_finish_reason", async () => {
    const provider = createMoonshotProvider({ apiKey: "fake-moonshot-key", fetch: mockFetch(sse([
      { choices: [{ delta: { content: "hello" } }] },
      { choices: [{ finish_reason: "stop", delta: {} }] },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request: { ...request, model: moonshotKimiModels[0] } });
    assert.equal(events.at(-1)?.type, "done");
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

function chatSse(events: readonly object[]): ReadableStream<Uint8Array> {
  return sse(events);
}
