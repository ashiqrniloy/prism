import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, Message, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  assertToolCallDeltasReconstruct,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_BASE_URL,
  anthropicModels,
  createAnthropicMessagesProvider,
  createAnthropicProviderPackage,
  listAnthropicModels,
  mapAnthropicModel,
} from "../index.js";

const model: ModelConfig = anthropicModels[0]!;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "assistant", content: [{ type: "thinking", text: "prior reasoning", signature: "sig" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "sess-1" },
};

describe("@arnilo/prism-provider-anthropic", () => {
  it("registers_featured_models_and_setup_does_not_fetch", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createAnthropicProviderPackage({ apiKey: "fake-anthropic-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (item: ModelConfig) => registered.push(item),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert.equal(fetchCalls, 0);
    assert(registered.some((item: any) => item.id === "anthropic"));
    assert(registered.some((item: any) => item.provider === "anthropic" && item.kind === "api_key"));
    assert(registered.some((item: any) => item.model === "claude-opus-4-8"));
    assert(registered.some((item: any) => item.model === "claude-sonnet-5"));
    assert(registered.some((item: any) => item.model === "claude-haiku-4-5"));
    assert.equal(ANTHROPIC_DEFAULT_BASE_URL, "https://api.anthropic.com/v1");
    assert.equal(ANTHROPIC_API_VERSION, "2023-06-01");
  });

  it("streams_text_thinking_tool_calls_usage", async () => {
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: mockFetch(sse([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
        { type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "plan" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"y\"}" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
        { type: "message_stop" },
      ])),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "plan"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "y" } }]);
    assert.equal(events.at(-1)?.type, "done");
  });

  it("preserves_thinking_blocks_and_maps_max_tokens_thinking_effort", async () => {
    let body: any;
    let url = "";
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: (async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return ok(sse([{ type: "message_stop" }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        model: { ...model, parameters: { maxTokens: 444, temperature: 0.2 } },
        options: { ...request.options, compat: { thinking: { type: "adaptive" }, effort: "medium" } },
      },
    });
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(body.system, "instructions");
    assert.deepEqual(body.messages[0].content, [{ type: "thinking", thinking: "prior reasoning", signature: "sig" }]);
    assert.equal(body.max_tokens, 444);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.equal(body.effort, "medium");
  });

  it("applies_cache_control_only_to_selected_breakpoints_with_1h_ttl", async () => {
    let body: any;
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([{ type: "message_stop" }]));
      }) as typeof fetch,
    });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "current turn" }] },
    ];
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        messages,
        options: {
          cacheKey: "sess",
          cacheRetention: "long",
          cache: { breakpoints: [{ location: "last_stable_message" as const }] },
        },
      },
    });
    assert.deepEqual(body.messages.find((m: any) => m.role === "assistant").content.at(-1).cache_control, {
      type: "ephemeral",
      ttl: "1h",
    });
    for (const m of body.messages.filter((row: any) => row.role !== "assistant")) {
      for (const block of m.content) assert.equal(block.cache_control, undefined);
    }
  });

  it("serializes_pdf_document_and_file_blocks", async () => {
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const replay: ProviderRequest = {
      model,
      messages: [{
        role: "user",
        content: [
          { type: "document", mediaType: "application/pdf", name: "brief.pdf", data: tinyPdf },
          { type: "file", mediaType: "application/pdf", name: "report.pdf", data: tinyPdf },
        ],
      }],
    };
    let body: unknown;
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([{ type: "message_stop" }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
    const serialized = JSON.stringify(body);
    assert.match(serialized, /"type":"document"/);
    assert.match(serialized, /brief\.pdf/);
  });

  it("keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: (async (_url, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([{ type: "message_stop" }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: {
          ...request.options,
          headers: {
            authorization: "Bearer attacker",
            "content-type": "text/plain",
            "x-api-key": "attacker-key",
            "anthropic-version": "attacker",
            "x-caller": "kept",
          },
        },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: {
        "content-type": "application/json",
        "x-api-key": "fake-anthropic-key",
        "anthropic-version": ANTHROPIC_API_VERSION,
        "x-client-request-id": "sess-1",
      },
      caller: {
        authorization: "Bearer attacker",
        "content-type": "text/plain",
        "x-api-key": "attacker-key",
        "anthropic-version": "attacker",
        "x-caller": "kept",
      },
    });
    assert.equal(headers.get("x-caller"), "kept");
  });

  it("observes_abort_and_redacts_secrets_in_errors", async () => {
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: (async () => new Response("boom fake-anthropic-key", { status: 401 })) as typeof fetch,
    });
    await assertAbortIsObserved({ provider, request });
    const events = await collectProviderEvents(provider, request);
    assert.equal(events.at(-1)?.type, "error");
    assertNoSecretLeak(events, ["fake-anthropic-key"]);
  });

  it("list_anthropic_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let method = "";
    let headers: Headers | undefined;
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const models = await listAnthropicModels({
      apiKey: "fake-anthropic-key",
      baseUrl: "https://anthropic.example/v1",
      signal: controller.signal,
      fetch: (async (input, init) => {
        url = String(input);
        method = init?.method ?? "GET";
        headers = new Headers(init?.headers);
        signal = init?.signal ?? null;
        return Response.json({
          data: [
            { id: "claude-sonnet-5", display_name: "Claude Sonnet 5", max_input_tokens: 1_000_000, max_tokens: 128_000 },
            { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
          ],
        });
      }) as typeof fetch,
    });
    assert.equal(method, "GET");
    assert.equal(url, "https://anthropic.example/v1/models");
    assert.equal(headers?.get("x-api-key"), "fake-anthropic-key");
    assert.equal(headers?.get("anthropic-version"), ANTHROPIC_API_VERSION);
    assert.equal(signal, controller.signal);
    assert.equal(models.length, 2);
    assert.equal(models[0]!.model, "claude-sonnet-5");
    assert.equal(models[0]!.displayName, "Claude Sonnet 5");
    assert.equal(models[0]!.limits?.contextWindow, 1_000_000);
    assert.equal(models[1]!.compat?.thinking && typeof models[1]!.compat?.thinking === "object"
      ? (models[1]!.compat!.thinking as { type?: string }).type
      : undefined, "enabled");
  });

  it("list_anthropic_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listAnthropicModels({
        apiKey: "fake-anthropic-key",
        fetch: (async () => new Response("unauthorized fake-anthropic-key", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.ok(!message.includes("fake-anthropic-key"));
        assert.match(message, /Anthropic model discovery failed: 401/);
        return true;
      },
    );
  });

  it("map_anthropic_model_rejects_malformed_entry", () => {
    assert.throws(() => mapAnthropicModel({ id: "" } as any), /missing id/);
    assert.throws(() => mapAnthropicModel(undefined as any), /missing id/);
  });

  it("truncated_stream_fails_closed", async () => {
    const provider = createAnthropicMessagesProvider({
      apiKey: "fake-anthropic-key",
      fetch: mockFetch(sse([
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      ])),
    });
    const events = await collectProviderEvents(provider, request);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } }).error?.message), /completion evidence/);
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
