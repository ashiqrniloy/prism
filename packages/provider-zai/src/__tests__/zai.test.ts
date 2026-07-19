import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import {
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  assertToolCallDeltasReconstruct,
} from "@arnilo/prism/testing/provider-conformance";
import {
  createZaiProvider,
  createZaiProviderPackage,
  listZaiModels,
  mapZaiModel,
  zaiBody,
  zaiModels,
  ZAI_DEFAULT_BASE_URL,
} from "../index.js";

const request: ProviderRequest = {
  model: zaiModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-provider-zai", () => {
  it("zai_registers_glm_model_metadata", async () => {
    const registered: unknown[] = [];
    await createZaiProviderPackage({ apiKey: "fake-zai-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "zai"));
    assert(registered.some((item: any) => item.provider === "zai" && item.model === "glm-5.2"));
    assert(registered.some((item: any) => item.provider === "zai" && item.model === "glm-4.7"));
    assert(registered.some((item: any) => item.provider === "zai" && item.kind === "api_key"));
  });

  it("zai_provider_setup_does_not_call_model_discovery", async () => {
    let fetches = 0;
    await createZaiProviderPackage({
      apiKey: "fake-zai-key",
      fetch: (async () => {
        fetches += 1;
        return ok(sse([]));
      }) as typeof fetch,
    }).setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as any);
    assert.equal(fetches, 0);
  });

  it("zai_featured_catalog_matches_official_glm_ids", () => {
    assert.deepEqual(
      zaiModels.map((model) => model.model),
      ["glm-5.2", "glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7", "glm-4.6", "glm-4.5"],
    );
    assert.equal(zaiModels[0]?.limits?.contextWindow, 1_000_000);
    assert.equal(zaiModels[0]?.compat?.reasoning_effort, "max");
    assert.equal(zaiModels[0]?.cache?.kind, "implicit");
    assert.equal(ZAI_DEFAULT_BASE_URL, "https://api.z.ai/api/paas/v4");
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

  it("zai_maps_thinking_reasoning_effort_and_max_tokens", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        model: { ...request.model, parameters: { maxTokens: 333, temperature: 0.4 } },
        options: { compat: { reasoning_effort: "high", thinking: { type: "enabled" } } },
      },
    });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.max_tokens, 333);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.4);
  });

  it("zai_per_turn_thinking_override_wins_over_model_defaults", () => {
    const body = zaiBody({
      ...request,
      model: {
        ...request.model,
        compat: { thinking: true, reasoning_effort: "max", tool_stream: true },
      },
      options: {
        compat: {
          thinking: false,
          reasoning_effort: "minimal",
          tool_stream: false,
        },
      },
    });
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "minimal");
    assert.equal(body.tool_stream, false);
  });

  it("zai_boolean_thinking_compat_does_not_overwrite_resolved_object", () => {
    const body = zaiBody({
      ...request,
      options: { compat: { thinking: true, reasoning_effort: "high" } },
    });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, "high");
  });

  it("zai_clear_thinking_nested_in_thinking_object", () => {
    const body = zaiBody({
      ...request,
      options: { compat: { thinking: { type: "enabled" }, clear_thinking: false } },
    });
    assert.deepEqual(body.thinking, { type: "enabled", clear_thinking: false });
  });

  it("zai_cache_retention_none_disables_thinking", () => {
    const body = zaiBody({
      ...request,
      options: { cacheRetention: "none", compat: { thinking: true } },
    });
    assert.deepEqual(body.thinking, { type: "disabled" });
  });

  it("zai_enables_tool_stream_for_supported_models", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([
        {
          choices: [{
            delta: {
              content: "hi",
              reasoning_content: "think",
              tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }],
            },
          }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
          },
        },
      ]));
    }) as typeof fetch });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assert.equal(body.tool_stream, true);
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("zai_preserves_reasoning_content_when_clear_thinking_false", () => {
    const body = zaiBody({
      ...request,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "step 1: plan" },
            { type: "text", text: "answer" },
          ],
        },
      ],
      options: { compat: { clear_thinking: false } },
    });
    const messages = body.messages as readonly { role?: string; content?: unknown; reasoning_content?: string }[];
    assert.equal(messages[1]?.reasoning_content, "step 1: plan");
    assert.equal(messages[1]?.content, "answer");
    assert.deepEqual(body.thinking, { type: "enabled", clear_thinking: false });
    assert.ok(!JSON.stringify(messages[1]?.content).includes("step 1: plan"));
  });

  it("zai_drops_prior_thinking_by_default_without_flattening_into_text", () => {
    const body = zaiBody({
      ...request,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "secret-chain" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(body.messages);
    assert.ok(!serialized.includes("secret-chain"));
    assert.ok(!serialized.includes("reasoning_content"));
  });

  it("zai_text_only_serializer_rejects_image_blocks", async () => {
    const imageRequest: ProviderRequest = {
      ...request,
      messages: [{ role: "user", content: [{ type: "image", url: "https://example.invalid/img.png" }] }],
    };
    const imageProvider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of imageProvider.generate(imageRequest)) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("zai_replays_tool_call_and_tool_result", async () => {
    const replay: ProviderRequest = {
      ...request,
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let body: unknown;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("zai_emits_no_explicit_cache_payload_for_implicit_caching", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: {
          cacheKey: "sess",
          cacheRetention: "long" as const,
          cache: { breakpoints: [{ location: "last_stable_message" as const }] },
        },
      },
    });
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("cache_control"), "Z.AI body must not contain cache_control");
    assert.ok(!serialized.includes("cacheKey"), "Z.AI body must not contain cacheKey");
    assert.ok(!serialized.includes("prompt_cache"), "Z.AI body must not contain prompt_cache fields");
  });

  it("zai_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: {
          ...request.options,
          headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
        },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-zai-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("zai_redacts_api_key_from_http_errors", async () => {
    const provider = createZaiProvider({
      apiKey: "fake-zai-key",
      fetch: (async () => new Response("bad fake-zai-key", { status: 500 })) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-zai-key"));
  });

  it("zai_defaults_to_official_international_base_url", async () => {
    let url = "";
    const provider = createZaiProvider({
      apiKey: "fake-zai-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(url, `${ZAI_DEFAULT_BASE_URL}/chat/completions`);
  });

  it("list_zai_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let headers: Headers | undefined;
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const models = await listZaiModels({
      apiKey: "sk-zai-secret",
      baseUrl: "https://example.test/paas/v4/",
      signal: controller.signal,
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        signal = init?.signal;
        return new Response(JSON.stringify({
          object: "list",
          data: [
            { id: "glm-5.2", object: "model", created: 1, owned_by: "zai" },
            { id: "glm-4.5", object: "model", created: 2, owned_by: "zai" },
            { id: "glm-5v-turbo", object: "model", created: 3, owned_by: "zai" },
          ],
        }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(url, "https://example.test/paas/v4/models");
    assert.equal(headers?.get("authorization"), "Bearer sk-zai-secret");
    assert.equal(signal ?? undefined, controller.signal);
    assert.equal(models.length, 3);
    assert.equal(models[0]?.model, "glm-5.2");
    assert.equal(models[0]?.limits?.contextWindow, 1_000_000);
    assert.equal(models[0]?.compat?.reasoning_effort, "max");
    assert.equal(models[0]?.compat?.tool_stream, true);
    assert.equal(models[0]?.cache?.kind, "implicit");
    assert.equal(models[1]?.limits?.contextWindow, 128_000);
    assert.equal(models[1]?.compat?.reasoning_effort, undefined);
    assert.deepEqual(models[2]?.capabilities?.input, ["text", "image"]);
  });

  it("list_zai_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listZaiModels({
        apiKey: "sk-leaked-zai",
        fetch: (async () => new Response("unauthorized sk-leaked-zai", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, /Z\.AI model discovery failed: 401/);
        assert.equal(message.includes("sk-leaked-zai"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      },
    );
  });

  it("map_zai_model_rejects_malformed_entry", () => {
    assert.throws(() => mapZaiModel({ id: "" } as any), /missing id/);
  });

  it("zai_public_docs_omit_obsolete_thinkingFormat_fields", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync(new URL("../../../../docs/providers/zai.md", import.meta.url), "utf8");
    assert.equal(docs.includes("thinkingFormat"), false);
    assert.equal(docs.includes("developerRoleFallback"), false);
    assert.ok(docs.includes("thinking"));
    assert.ok(docs.includes("reasoning_effort"));
    assert.ok(docs.includes("tool_stream"));
    assert.ok(docs.includes("listZaiModels"));
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
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
