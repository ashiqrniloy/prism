import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, Message, ModelConfig, ProviderRequest } from "@arnilo/prism";
import {
  assertNoForeignCacheFields,
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  assertToolCallDeltasReconstruct,
} from "@arnilo/prism/testing/provider-conformance";
import {
  alibabaBaseUrl,
  alibabaBody,
  createAlibabaProvider,
  createAlibabaProviderPackage,
  defineAlibabaModel,
  listAlibabaModels,
  mapAlibabaModel,
} from "../index.js";

const model = defineAlibabaModel({
  model: "qwen-plus",
  displayName: "Qwen Plus",
  limits: { contextWindow: 131_072, maxOutputTokens: 8_192 },
});

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "tool_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-providers/alibaba", () => {
  it("base_url_resolver_covers_presets_and_explicit_override", () => {
    assert.equal(alibabaBaseUrl(), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
    assert.equal(alibabaBaseUrl({ preset: "beijing" }), "https://dashscope.aliyuncs.com/compatible-mode/v1");
    assert.equal(alibabaBaseUrl({ preset: "us" }), "https://dashscope-us.aliyuncs.com/compatible-mode/v1");
    assert.equal(alibabaBaseUrl({ preset: "coding-plan" }), "https://coding-intl.dashscope.aliyuncs.com/v1");
    assert.equal(
      alibabaBaseUrl({ baseUrl: "https://ws123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/" }),
      "https://ws123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    );
    // Explicit baseUrl wins over preset.
    assert.equal(alibabaBaseUrl({ preset: "beijing", baseUrl: "https://override.test/v1" }), "https://override.test/v1");
  });

  it("request_shape_is_openai_chat_completions_with_bearer_usage_and_tools", async () => {
    let url = "";
    let headers: Headers | undefined;
    let body: any;
    const provider = createAlibabaProvider({
      apiKey: "sk-dashscope-secret",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return ok(chatSse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    assert.equal(headers?.get("authorization"), "Bearer sk-dashscope-secret");
    assert.equal(headers?.get("content-type"), "application/json");
    assert.equal(body.model, "qwen-plus");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.max_tokens, 8_192);
    assert.deepEqual(body.tools[0], { type: "function", function: { name: "lookup", parameters: { type: "object" } } });
    assert.equal(body.messages[0].role, "system");
    // enable_thinking omitted unless explicitly boolean.
    assert.equal(body.enable_thinking, undefined);
  });

  it("enable_thinking_passthrough_request_overrides_model_default", () => {
    const thinkingModel = defineAlibabaModel({ model: "qwen3-max", compat: { enable_thinking: false } });
    const off = alibabaBody({ model: thinkingModel, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    assert.equal(off.enable_thinking, false);
    const on = alibabaBody({
      model: thinkingModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { compat: { enable_thinking: true } },
    });
    assert.equal(on.enable_thinking, true);
    // Provider-owned compat keys are stripped from the opaque spread.
    assert.equal((on as any).route, undefined);
  });

  it("stream_maps_text_reasoning_tool_calls_and_usage", async () => {
    const provider = createAlibabaProvider({
      apiKey: "sk-dashscope-secret",
      fetch: mockFetch(
        chatSse([
          { choices: [{ delta: { reasoning_content: "think" } }] },
          { choices: [{ delta: { content: "hello" } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "tool_1", function: { name: "lookup", arguments: '{"q":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: "tool_calls" }] },
          {
            usage: {
              prompt_tokens: 4,
              completion_tokens: 3,
              total_tokens: 7,
              prompt_tokens_details: { cached_tokens: 1, cache_creation_input_tokens: 2 },
            },
          },
        ]),
      ),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("cache_usage_maps_dashscope_cached_and_creation_tokens", async () => {
    const provider = createAlibabaProvider({
      apiKey: "sk-dashscope-secret",
      fetch: mockFetch(
        chatSse([
          { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
          {
            usage: {
              prompt_tokens: 100,
              completion_tokens: 5,
              prompt_tokens_details: { cached_tokens: 80, cache_creation_input_tokens: 10 },
            },
          },
        ]),
      ),
    });
    await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "ok", usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 80, cacheWriteTokens: 10 } },
    });
  });

  it("default_model_emits_no_cache_control_for_implicit_caching", () => {
    const body = alibabaBody({
      model,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { cacheRetention: "long", cache: { breakpoints: [{ location: "last_stable_message" }] } },
    });
    assert.ok(!JSON.stringify(body).includes("cache_control"), "implicit-cache model must not emit cache_control");
  });

  it("explicit_cache_applies_markers_only_to_selected_breakpoints_capped_at_four", () => {
    const cacheModel = defineAlibabaModel({ model: "qwen-plus", cache: { kind: "cache_control" } });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "m0" }] },
      { role: "assistant", content: [{ type: "text", text: "m1" }] },
      { role: "user", content: [{ type: "text", text: "m2" }] },
      { role: "assistant", content: [{ type: "text", text: "m3" }] },
      { role: "user", content: [{ type: "text", text: "m4" }] },
      { role: "assistant", content: [{ type: "text", text: "m5" }] },
    ];
    const body = alibabaBody({
      model: cacheModel,
      messages,
      options: {
        cache: {
          breakpoints: [
            { location: "message_id", messageId: "x" }, // no match
            { location: "stable_context" },
            { location: "last_stable_message" },
            { location: "last_user_message" },
          ],
        },
      },
    });
    const marked = (body.messages as any[]).filter((m) => Array.isArray(m.content) && m.content.some((b: any) => b.cache_control));
    assert.ok(marked.length >= 1 && marked.length <= 4, `expected 1..4 marked messages, got ${marked.length}`);
    for (const m of marked) {
      assert.deepEqual(m.content.at(-1).cache_control, { type: "ephemeral" });
    }
  });

  it("explicit_cache_breakpoint_count_is_hard_capped_at_four", () => {
    const cacheModel = defineAlibabaModel({ model: "qwen-plus", cache: { kind: "cache_control", maxBreakpoints: 99 } });
    const messages: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: [{ type: "text" as const, text: `m${i}` }],
    }));
    const body = alibabaBody({
      model: cacheModel,
      messages,
      options: { cache: { breakpoints: messages.map((_, i) => ({ location: "message_id" as const, messageId: `m${i}` })) } },
    });
    // message_id breakpoints match by Message.id which is unset here, so fall back to a
    // location that always resolves to exercise the cap deterministically.
    const body2 = alibabaBody({
      model: cacheModel,
      messages,
      options: {
        cache: {
          breakpoints: [
            { location: "stable_context" },
            { location: "last_stable_message" },
            { location: "last_user_message" },
            { location: "system_prompt" },
            { location: "tools" },
            { location: "last_user_message" },
          ],
        },
      },
    });
    const countMarkers = (b: unknown) => JSON.stringify(b).split('"cache_control"').length - 1;
    assert.ok(countMarkers(body2) <= 4, `expected <= 4 cache_control markers, got ${countMarkers(body2)}`);
    assert.equal(countMarkers(body), 0);
  });

  it("truncated_stream_without_done_fails_loudly", async () => {
    const text = [`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`].join("");
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
    const provider = createAlibabaProvider({ apiKey: "sk-x", fetch: (async () => new Response(stream, { status: 200 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
  });

  it("http_error_maps_to_provider_error_and_redacts_api_key", async () => {
    const provider = createAlibabaProvider({
      apiKey: "sk-dashscope-secret",
      fetch: (async () =>
        new Response(
          JSON.stringify({ error: { message: "bad key sk-dashscope-secret", type: "invalid_request_error", code: "invalid_api_key" } }),
          { status: 401 },
        )) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "error");
    const message = (terminal as any).error?.message ?? String((terminal as any).message ?? "");
    assert.ok(!message.includes("sk-dashscope-secret"), `error must redact api key: ${message}`);
    assert.ok(message.includes("401"), "error must surface status");
  });

  it("serialized_request_covers_video_content", () => {
    const request: ProviderRequest = {
      model: defineAlibabaModel({ model: "qwen-vl-max", capabilities: { input: ["text", "image", "file", "video"] } }),
      messages: [
        {
          role: "user",
          content: [
            { type: "video", mediaType: "video/mp4", data: "AAAA" },
            { type: "text", text: "Summarize this video." },
          ],
        },
      ],
    };
    const body = alibabaBody(request);
    assertSerializedRequestCoversContent(request as any, body);
  });

  it("map_alibaba_model_infers_capabilities_from_id", () => {
    const reasoning = mapAlibabaModel({ id: "qwq-plus", owned_by: "system", created: 1 });
    assert.equal(reasoning.capabilities?.reasoning, true);
    const vision = mapAlibabaModel({ id: "qwen-vl-max" });
    assert.deepEqual(vision.capabilities?.input, ["text", "image", "file", "video"]);
    const plain = mapAlibabaModel({ id: "qwen-plus" });
    assert.equal(plain.provider, "alibaba");
    assert.equal(plain.capabilities?.tools, true);
    assert.throws(() => mapAlibabaModel({ id: "" }), /missing id/);
  });

  it("typed_video_blocks_serialize_to_video_url_parts_when_video_capability_declared", () => {
    const body = alibabaBody({
      model: defineAlibabaModel({ model: "qwen-vl-max", capabilities: { input: ["text", "image", "file", "video"] } }),
      messages: [
        {
          role: "user",
          content: [
            { type: "video", mediaType: "video/mp4", url: "https://example.com/clip.mp4" },
            { type: "text", text: "Summarize this video." },
          ],
        },
      ],
    });
    const content = (body.messages as any[])[0].content;
    assert.deepEqual(content[0], { type: "video_url", video_url: { url: "https://example.com/clip.mp4" } });
    assert.equal(content[1].type, "text");
  });

  it("video_blocks_require_the_video_input_capability_before_fetch", () => {
    const model = defineAlibabaModel({ model: "qwen-plus" }); // text-only
    assert.throws(
      () =>
        alibabaBody({
          model,
          messages: [{ role: "user", content: [{ type: "video", mediaType: "video/mp4", url: "https://example.com/clip.mp4" }] }],
        }),
      /does not declare video input capability/,
    );
  });

  it("video_base64_data_urls_pass_through_and_resourceUri_only_blocks_throw", () => {
    const model = defineAlibabaModel({ model: "qwen-vl-max", capabilities: { input: ["text", "image", "file", "video"] } });
    const dataBody = alibabaBody({
      model,
      messages: [{ role: "user", content: [{ type: "video", mediaType: "video/mp4", data: "AAAA" }] }],
    });
    assert.deepEqual((dataBody.messages as any[])[0].content[0], {
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAA" },
    });
    assert.throws(
      () =>
        alibabaBody({
          model,
          messages: [{ role: "user", content: [{ type: "video", mediaType: "video/mp4", resourceUri: "file:///tmp/clip.mp4" }] }],
        }),
      /missing url or data/,
    );
  });

  it("non_video_file_and_document_blocks_still_throw_before_fetch", () => {
    const model = defineAlibabaModel({ model: "qwen-vl-max", capabilities: { input: ["text", "image", "file"] } });
    assert.throws(
      () =>
        alibabaBody({
          model,
          messages: [{ role: "user", content: [{ type: "file", mediaType: "application/pdf", url: "https://example.com/doc.pdf" }] }],
        }),
      /does not support file content blocks/,
    );
    assert.throws(
      () =>
        alibabaBody({
          model,
          messages: [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", url: "https://example.com/doc.pdf" }] }],
        }),
      /does not support document content blocks/,
    );
  });

  it("cache_marker_lands_on_the_last_content_block_with_video_parts", () => {
    const cacheModel = defineAlibabaModel({
      model: "qwen-vl-max",
      cache: { kind: "cache_control" },
      capabilities: { input: ["text", "image", "file", "video"] },
    });
    const body = alibabaBody({
      model: cacheModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "video", mediaType: "video/mp4", url: "https://example.com/clip.mp4" },
            { type: "text", text: "Summarize." },
          ],
        },
      ],
      options: { cache: { breakpoints: [{ location: "last_user_message" }] } },
    });
    const content = (body.messages as any[])[0].content;
    assert.deepEqual(content.at(-1).cache_control, { type: "ephemeral" });
    assert.equal(content[0].cache_control, undefined);
  });

  it("list_alibaba_models_discovers_dynamically_with_auth_and_baseurl", async () => {
    let url = "";
    let headers: Headers | undefined;
    const models = await listAlibabaModels({
      apiKey: "sk-dashscope-secret",
      preset: "coding-plan",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return new Response(
          JSON.stringify({ object: "list", data: [{ id: "qwen3-coder-plus", owned_by: "system", created: 1 }, { id: "qwen3-max" }] }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(url, "https://coding-intl.dashscope.aliyuncs.com/v1/models");
    assert.equal(headers?.get("authorization"), "Bearer sk-dashscope-secret");
    assert.deepEqual(
      models.map((m) => m.model),
      ["qwen3-coder-plus", "qwen3-max"],
    );
    assert.equal(models[0]?.provider, "alibaba");
  });

  it("list_alibaba_models_redacts_api_key_from_discovery_errors", async () => {
    await assert.rejects(
      () =>
        listAlibabaModels({
          apiKey: "sk-dashscope-secret",
          fetch: (async () => new Response("upstream said sk-dashscope-secret is invalid", { status: 401 })) as typeof fetch,
        }),
      (error: Error) => {
        assert.ok(error.message.includes("401"));
        assert.ok(!error.message.includes("sk-dashscope-secret"), `must redact key: ${error.message}`);
        return true;
      },
    );
  });

  it("package_setup_registers_provider_auth_and_host_models_without_discovery", async () => {
    let fetchCalls = 0;
    const registered: unknown[] = [];
    const discovered = [mapAlibabaModel({ id: "qwen-plus" })];
    await createAlibabaProviderPackage({
      apiKey: "sk-dashscope-secret",
      models: discovered,
      fetch: (async () => {
        fetchCalls += 1;
        return ok(chatSse([]));
      }) as typeof fetch,
    }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (m: ModelConfig) => registered.push(m),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert.equal(fetchCalls, 0, "setup must not call model discovery");
    assert.ok(registered.some((item: any) => item.id === "alibaba"));
    assert.ok(registered.some((item: any) => item.provider === "alibaba" && item.model === "qwen-plus"));
    assert.ok(registered.some((item: any) => item.provider === "alibaba" && item.kind === "api_key"));
  });

  it("alibaba_implicit_default_carries_no_foreign_cache_fields", () => {
    assertNoForeignCacheFields(alibabaBody({ ...request, options: { cacheKey: "session-1", cacheRetention: "long" } }));
  });

  it("alibaba_opt_in_markers_are_the_only_cache_fields", () => {
    const optIn = { ...request, model: { ...request.model, cache: { kind: "cache_control" as const } } };
    const body = alibabaBody({
      ...optIn,
      options: { cacheRetention: "long" as const, cache: { breakpoints: [{ location: "system_prompt" as const }] } },
    });
    assertNoForeignCacheFields(body, ["cache_control"]);
    assert.ok(JSON.stringify(body).includes("cache_control"));
  });

  it("alibaba_provider_owned_authorization_wins_over_caller_header", async () => {
    let captured: Headers | undefined;
    const provider = createAlibabaProvider({
      apiKey: "sk-real-key",
      fetch: (async (_input: any, init: any) => {
        captured = new Headers(init?.headers);
        return ok(chatSse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: { ...request, options: { headers: { authorization: "Bearer caller-forged", "x-custom": "keep-me" } } },
    });
    assertProviderOwnedHeadersWin(captured!, {
      owned: { authorization: "Bearer sk-real-key" },
      caller: { "x-custom": "keep-me" },
    });
  });
});

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () => ok(body)) as typeof fetch;
}
function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}
function chatSse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
