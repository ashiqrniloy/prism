import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "@arnilo/prism";
import {
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
} from "@arnilo/prism/testing/provider-conformance";
import {
  createXaiProvider,
  createXaiProviderPackage,
  listXaiModels,
  mapXaiModel,
  XAI_CONV_ID_MAX_LENGTH,
  XAI_DEFAULT_BASE_URL,
  xaiBody,
  xaiModels,
  xGrokConvId,
} from "../index.js";

const request: ProviderRequest = {
  model: xaiModels[0]!,
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

describe("@arnilo/prism-provider-xai", () => {
  it("xai_registers_featured_catalog_api_key_and_oauth", async () => {
    const registered: unknown[] = [];
    await createXaiProviderPackage({ apiKey: "fake-xai-key" }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as never);
    assert(registered.some((item: any) => item.id === "xai"));
    assert.deepEqual(
      xaiModels.map((model) => model.model),
      ["grok-4.6", "grok-4.3", "grok-build-0.1"],
    );
    assert(registered.some((item: any) => item.kind === "api_key"));
    assert(registered.some((item: any) => item.kind === "oauth" && item.oauth?.id === "xai"));
  });

  it("xai_provider_setup_does_not_call_model_discovery_or_login", async () => {
    let fetches = 0;
    await createXaiProviderPackage({
      apiKey: "fake-xai-key",
      fetch: (async () => {
        fetches += 1;
        return ok(sse([]));
      }) as typeof fetch,
    }).setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as never);
    assert.equal(fetches, 0);
  });

  it("xai_featured_catalog_limits_cost_image_and_implicit_cache", () => {
    assert.equal(xaiModels[0]?.limits?.contextWindow, 500_000);
    assert.equal(xaiModels[1]?.limits?.contextWindow, 1_000_000);
    assert.equal(xaiModels[2]?.limits?.contextWindow, 256_000);
    assert.equal(xaiModels[0]?.cost?.cacheRead, 0.5);
    assert.equal(xaiModels[0]?.cache?.kind, "implicit");
    assert.ok(xaiModels[0]?.capabilities?.input?.includes("image"));
    assert.equal(xaiModels[0]?.capabilities?.reasoning, true);
    assert.equal(XAI_DEFAULT_BASE_URL, "https://api.x.ai/v1");
  });

  it("xai_conv_id_present_absent_clamped_never_a_secret", () => {
    assert.equal(xGrokConvId({ ...request, options: { sessionId: "sess-1" } }), "sess-1");
    assert.equal(xGrokConvId({ ...request, options: { cacheKey: "tenant:a", sessionId: "ignored" } }), "tenant:a");
    assert.equal(xGrokConvId({ ...request, options: { cache: { key: "hint-key" }, cacheKey: "ignored" } }), "hint-key");
    assert.equal(xGrokConvId({ ...request, options: { cacheRetention: "none", sessionId: "sess-1" } }), undefined);
    assert.equal(xGrokConvId({ ...request, options: { cache: { mode: "off" }, sessionId: "sess-1" } }), undefined);
    assert.equal(xGrokConvId({ ...request, options: { cacheKey: "sess#1!" } }), "sess-1");
    assert.equal(
      xGrokConvId({ ...request, options: { cacheKey: "x".repeat(XAI_CONV_ID_MAX_LENGTH + 20) } })?.length,
      XAI_CONV_ID_MAX_LENGTH,
    );
    assert.equal(xGrokConvId({ ...request, options: { cacheKey: "sk-secret-key!!!" } }), "sk-secret-key");
  });

  it("xai_sends_sanitized_conv_id_header", async () => {
    let headers = new Headers();
    const provider = createXaiProvider({
      apiKey: "fake-xai-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: { ...request, options: { sessionId: "conv#42!" } },
    });
    assert.equal(headers.get("x-grok-conv-id"), "conv-42");
  });

  it("xai_replays_reasoning_content_on_reasoning_models", () => {
    const body = xaiBody({
      ...request,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "step 1" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    });
    const assistant = (body.messages as readonly { reasoning_content?: string; content?: unknown }[])[1];
    assert.equal(assistant?.reasoning_content, "step 1");
    assert.ok(!JSON.stringify(assistant?.content).includes("step 1"));
  });

  it("xai_rejects_image_when_model_lacks_image_capability", () => {
    assert.throws(
      () =>
        xaiBody({
          ...request,
          model: { ...request.model, capabilities: { input: ["text"], reasoning: true } },
          messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "abc" }] }],
        }),
      /does not declare image input capability/,
    );
  });

  it("xai_maps_inclusive_and_exclusive_cached_tokens_without_negative_unused", async () => {
    const run = async (usage: object) => {
      const provider = createXaiProvider({
        apiKey: "fake-xai-key",
        fetch: (async () => ok(sse([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }], usage }]))) as typeof fetch,
      });
      return assertProviderStreamConforms({ provider, request, expect: { text: "hi" } });
    };
    const inclusive = await run({
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 7 },
    });
    const inclusiveUsage = inclusive.find((event) => event.type === "usage")?.usage;
    assert.equal(inclusiveUsage?.inputTokens, 10);
    assert.equal(inclusiveUsage?.cacheReadTokens, 7);
    const exclusive = await run({
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 15 },
    });
    const usage = exclusive.find((event) => event.type === "usage")?.usage;
    assert.equal(usage?.cacheReadTokens, 15);
    assert.equal(usage?.inputTokens, 10);
    assert.ok((usage?.inputTokens ?? 0) >= 0);
  });

  it("xai_redacts_api_key_and_keeps_provider_owned_headers", async () => {
    let headers = new Headers();
    const provider = createXaiProvider({
      apiKey: "fake-xai-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response("bad fake-xai-key", { status: 500 });
      }) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: { headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } },
      },
    });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-xai-key"));
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-xai-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("xai_oauth_access_uses_bearer_on_api_x_ai", async () => {
    let url = "";
    let headers = new Headers();
    let body: unknown;
    const provider = createXaiProvider({
      apiKey: "supergrok-access",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(url, `${XAI_DEFAULT_BASE_URL}/chat/completions`);
    assert.ok(!url.includes("cli-chat-proxy"));
    assert.equal(headers.get("authorization"), "Bearer supergrok-access");
    assertSerializedRequestCoversContent(request, body);
  });

  it("list_xai_models_maps_fixture_and_redacts_token", async () => {
    const models = await listXaiModels({
      apiKey: "sk-xai-secret",
      baseUrl: "https://example.test/v1/",
      fetch: (async (input, init) => {
        assert.equal(String(input), "https://example.test/v1/models");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-xai-secret");
        return Response.json({
          object: "list",
          data: [{ id: "grok-4.6" }, { id: "custom-grok" }],
        });
      }) as typeof fetch,
    });
    assert.equal(models[0]?.limits?.contextWindow, 500_000);
    assert.equal(models[1]?.model, "custom-grok");
    await assert.rejects(
      () =>
        listXaiModels({
          apiKey: "sk-leaked-xai",
          fetch: (async () => new Response("unauthorized sk-leaked-xai", { status: 401 })) as typeof fetch,
        }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, /xAI model discovery failed: 401/);
        assert.equal(message.includes("sk-leaked-xai"), false);
        return true;
      },
    );
    assert.throws(() => mapXaiModel({ id: "" } as never), /missing id/);
  });
});

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
