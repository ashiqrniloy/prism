import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoFetches,
  assertNoForeignCacheFields,
  assertNoSecretLeak,
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  assertToolCallDeltasReconstruct,
  assertUsageAccounting,
} from "@arnilo/prism/testing/provider-conformance";
import {
  COMMAND_CODE_DEFAULT_BASE_URL,
  classifyCommandCodeError,
  createCommandCodeProvider,
  createCommandCodeProviderPackage,
  listCommandCodeModels,
  routeForCommandCodeModel,
} from "../index.js";

const claudeModel: ModelConfig = {
  provider: "commandcode",
  model: "claude-sonnet-5",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "anthropic", preserveThinking: true },
  cache: { kind: "cache_control", maxBreakpoints: 4 },
  limits: { contextWindow: 1_000_000 },
  cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" },
};

const chatModel: ModelConfig = {
  provider: "commandcode",
  model: "deepseek/deepseek-v4-pro",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true, pricing_source: "docs:pricing-limits (off-peak 17h/day; peak 2×)" },
  cache: { kind: "implicit" },
  limits: { contextWindow: 1_000_000 },
  cost: { input: 0.66, output: 1.98, cacheRead: 0.022, currency: "USD", unit: "per_million_tokens" },
};

const visionModel: ModelConfig = {
  provider: "commandcode",
  model: "deepseek/deepseek-v4-flash-vision-exp",
  capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true },
  cache: { kind: "implicit" },
  limits: { contextWindow: 1_000_000 },
};

const gpt56Model: ModelConfig = {
  provider: "commandcode",
  model: "gpt-5.6-luna",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true },
  cache: { kind: "implicit" },
  limits: { contextWindow: 1_050_000 },
  cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, currency: "USD", unit: "per_million_tokens" },
};

const baseRequest: ProviderRequest = {
  model: chatModel,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session with spaces" },
};

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () => ok(body)) as typeof fetch;
}

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

describe("@arnilo/prism-providers/commandcode", () => {
  it("commandcode_registers_featured_models_and_setup_does_not_fetch", async () => {
    const fetchCalls: unknown[] = [];
    const fetchImpl = (async () => {
      fetchCalls.push(1);
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createCommandCodeProviderPackage({ apiKey: "fake-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assertNoFetches(fetchCalls);
    assert(registered.some((item: any) => item.id === "commandcode"));
    assert(registered.some((item: any) => item.provider === "commandcode" && item.kind === "api_key"));
    const models = registered.filter(
      (item: any): item is ModelConfig => typeof item?.model === "string" && item.provider === "commandcode",
    );
    assert.ok(models.length >= 38, `expected curated catalog, got ${models.length}`);
    const byId = new Map(models.map((m) => [m.model, m]));
    const sonnet = byId.get("claude-sonnet-5");
    assert.equal(sonnet?.compat?.route, "anthropic");
    assert.equal(sonnet?.cache?.kind, "cache_control");
    assert.equal(sonnet?.cost?.cacheWrite, 2.5);
    const luna = byId.get("gpt-5.6-luna");
    assert.equal(luna?.compat?.route, "openai");
    assert.equal(luna?.cache?.kind, "implicit", "GPT-5.6 stays implicit until the live probe (Task 5)");
    assert.equal(luna?.cost?.cacheWrite, 0.25, "docs cache-write price recorded even while implicit");
    const deepseek = byId.get("deepseek/deepseek-v4-pro");
    assert.match(String(deepseek?.compat?.pricing_source), /off-peak/);
    assert.ok([...byId.values()].every((m) => m.compat?.route === "openai" || m.compat?.route === "anthropic"));
    assert.equal(COMMAND_CODE_DEFAULT_BASE_URL, "https://api.commandcode.ai/provider/v1");
    assert.equal(routeForCommandCodeModel("claude-haiku-4-5-20251001"), "anthropic");
    assert.equal(routeForCommandCodeModel("gpt-5.6-sol"), "openai");
  });

  it("commandcode_defaults_to_official_base_url_chat_endpoint", async () => {
    let url = "";
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(url, "https://api.commandcode.ai/provider/v1/chat/completions");
  });

  it("commandcode_chat_route_streams_text_thinking_tool_calls_and_usage", async () => {
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: mockFetch(
        sse([
          {
            choices: [
              {
                delta: {
                  content: "hi",
                  reasoning_content: "think",
                  tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } }],
                },
              },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 2,
              total_tokens: 7,
              prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
            },
          },
        ]),
      ),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request: baseRequest,
      expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("commandcode_chat_body_replays_reasoning_content_and_strips_pricing_source", async () => {
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        messages: [
          { role: "user", content: [{ type: "text", text: "q" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", text: "plan" },
              { type: "text", text: "ok" },
            ],
          },
        ],
      },
    });
    const assistant = body.messages[1];
    assert.equal(assistant.reasoning_content, "plan");
    assert.ok(!JSON.stringify(body).includes("pricing_source"), "cost metadata never reaches the wire");
    assert.ok(!JSON.stringify(body).includes("preserveThinking"));
  });

  it("commandcode_messages_route_uses_anthropic_auth_and_thinking_replay", async () => {
    let url = "";
    let headers = new Headers();
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        model: claudeModel,
        messages: [
          { role: "system", content: [{ type: "text", text: "rules" }] },
          { role: "user", content: [{ type: "text", text: "q" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", text: "plan" },
              { type: "text", text: "ok" },
            ],
          },
        ],
      },
    });
    assert.equal(url, "https://api.commandcode.ai/provider/v1/messages");
    assert.equal(headers.get("x-api-key"), "fake-key");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.equal(headers.get("authorization"), null, "messages route never needs a Bearer header");
    assert.equal(body.model, "claude-sonnet-5");
    assert.equal(body.system, "rules");
    assert.equal(body.stream, true);
    assert.ok(JSON.stringify(body).includes('"type":"thinking"'), "assistant thinking blocks replayed");
    assertNoForeignCacheFields(body, ["cache_control"]);
  });

  it("commandcode_messages_route_emits_cache_control_only_at_selected_breakpoints_and_never_ttl", async () => {
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        model: claudeModel,
        messages: [
          { role: "system", content: [{ type: "text", text: "rules" }] },
          { role: "user", content: [{ type: "text", text: "long prefix" }] },
          { role: "user", content: [{ type: "text", text: "tail" }] },
        ],
        options: { cache: { breakpoints: [{ location: "system_prompt" }, { location: "last_stable_message" }] } },
      },
    });
    const serialized = JSON.stringify(body);
    const markers = serialized.match(/"cache_control"/g)?.length ?? 0;
    assert.equal(markers, 2, `expected markers only at the two selected breakpoints, got ${markers}`);
    assert.ok(!serialized.includes('"ttl"'), "no ttl ever: upstream TTL window is undocumented");
    const system = Array.isArray(body.system) ? body.system : [{ type: "text", text: body.system }];
    assert.ok(JSON.stringify(system).includes("cache_control"));
    assert.ok(!JSON.stringify(body.messages[1]).includes("cache_control"), "non-selected messages carry no marker");
  });

  it("commandcode_zdr_header_is_provider_owned_and_opt_in", async () => {
    const capture = (withZdr: boolean) => {
      let headers = new Headers();
      const provider = createCommandCodeProvider({
        apiKey: "fake-key",
        zdr: withZdr,
        fetch: (async (_url, init) => {
          headers = new Headers(init?.headers);
          return ok(sse([]));
        }) as typeof fetch,
      });
      return { provider, headers: () => headers };
    };
    const zdr = capture(true);
    await assertProviderStreamConforms({
      provider: zdr.provider,
      request: { ...baseRequest, options: { ...baseRequest.options, headers: { "x-cmd-zdr": "0" } } },
    });
    assertProviderOwnedHeadersWin(zdr.headers(), { owned: { "x-cmd-zdr": "1" }, caller: {} });
    const plain = capture(false);
    await assertProviderStreamConforms({ provider: plain.provider, request: baseRequest });
    assert.equal(plain.headers().get("x-cmd-zdr"), null, "zdr header only when opted in");
  });

  it("commandcode_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        options: {
          ...baseRequest.options,
          headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
        },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-key", "content-type": "application/json" },
      caller: { "x-caller": "kept" },
    });
  });

  it("commandcode_403_and_422_are_non_retryable_and_redacted", async () => {
    const provider = createCommandCodeProvider({
      apiKey: "sk-cmd-secret",
      fetch: (async (input) => {
        const status = String(input).includes("/messages") ? 422 : 403;
        const error =
          status === 403
            ? { error: { message: "upgrade required to GOAT sk-cmd-secret", code: "upgrade_required" } }
            : { error: { message: "no ZDR upstream", code: "cmd_zdr_no_providers" } };
        return new Response(JSON.stringify(error), { status, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({ ...baseRequest, model: claudeModel })) events.push(event);
    const errorEvent = events.at(-1);
    assert.equal(errorEvent?.type, "error");
    const err = (errorEvent as any)?.error as Error & { code?: number };
    assert.equal(err.code, 422);
    assert.match(String(err.message), /cmd_zdr_no_providers/);
    assertNoSecretLeak(events, ["sk-cmd-secret"]);
    const decisions = [
      classifyCommandCodeError({ status: 403, body: { error: { code: "upgrade_required" } } }),
      classifyCommandCodeError({ status: 422, body: { error: { code: "cmd_zdr_no_providers" } } }),
    ];
    for (const decision of decisions) assert.equal(decision.retryable, false, `${decision.status} must be non-retryable`);
  });

  it("commandcode_429_is_retryable_with_backoff_and_anthropic_envelope_types_parse", async () => {
    const decision = classifyCommandCodeError({ status: 429, headers: new Headers({ "retry-after": "3" }) });
    assert.equal(decision.retryable, true);
    assert.equal(decision.retryAfterMs, 3000);
    const anthropic = classifyCommandCodeError({ status: 400, body: { error: { type: "invalid_request_error" } } });
    assert.equal(anthropic.errorCode, "invalid_request_error", "Anthropic envelope type maps as error code");
    const server = classifyCommandCodeError({ status: 502 });
    assert.equal(server.retryable, true);
  });

  it("commandcode_wrong_route_400_maps_to_typed_error", async () => {
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async () =>
        new Response(
          JSON.stringify({ error: { message: "claude-sonnet-5 is only available on /messages", code: "invalid_request_error" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({ ...baseRequest, model: claudeModel })) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal((events.at(-1) as { error?: Error & { code?: number } } | undefined)?.error?.code, 400);
  });

  it("commandcode_chat_route_rejects_document_blocks", async () => {
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const provider = createCommandCodeProvider({ apiKey: "fake-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      ...baseRequest,
      messages: [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: tinyPdf }] }],
    }))
      events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } })?.error?.message ?? events.at(-1)), /document/);
  });

  it("commandcode_vision_model_serialized_request_covers_image_content", async () => {
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    const request: ProviderRequest = {
      ...baseRequest,
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") },
          ],
        },
      ],
    };
    await assertProviderStreamConforms({ provider, request });
    assertSerializedRequestCoversContent(request, body);
    assert.match(JSON.stringify(body), /data:image\/png;base64/);
  });

  it("commandcode_list_models_maps_ids_routes_and_context_lengths", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      assert.deepEqual(init?.headers ?? {}, {}, "public endpoint must not emit headers without a key");
      return new Response(
        JSON.stringify({
          data: [
            { id: "claude-sonnet-5", owned_by: "command-code", name: "Claude Sonnet 5", context_length: 1_000_000 },
            { id: "deepseek/deepseek-v4-pro", owned_by: "command-code", name: "DeepSeek V4 Pro (latest)", context_length: 1_000_000 },
            { id: "brand-new-model", owned_by: "command-code", name: "Brand New Model", context_length: 300_000 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const models = await listCommandCodeModels({ fetch: fetchImpl });
    assert.equal(models.length, 3);
    const [claude, deepseek, unknown] = models;
    assert.equal(claude.model, "claude-sonnet-5");
    assert.equal(claude.compat?.route, "anthropic");
    assert.equal(claude.cache?.kind, "cache_control");
    assert.equal(claude.limits?.contextWindow, 1_000_000);
    assert.equal(deepseek.compat?.route, "openai");
    assert.equal(deepseek.cache?.kind, "implicit");
    assert.equal(deepseek.cost?.input, 0.66, "featured metadata applied on id match");
    assert.equal(unknown.compat?.route, "openai");
    assert.equal(unknown.cost, undefined, "unknown ids carry no pricing");
    assert.equal(unknown.cache?.kind, "implicit");
  });

  it("commandcode_messages_route_reports_cache_usage_from_message_delta", async () => {
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: mockFetch(
        sse([
          { type: "content_block_start", index: 0, content_block: { type: "text" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
          },
          { type: "message_stop" },
        ]),
      ),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request: { ...baseRequest, model: claudeModel },
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assertUsageAccounting(events, { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 });
  });

  it("commandcode_abort_is_observed_before_first_request", async () => {
    const provider = createCommandCodeProvider({ apiKey: "fake-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    await assertAbortIsObserved({ provider, request: baseRequest });
  });

  it("commandcode_keeps_gpt56_cache_metadata_implicit_until_probe", async () => {
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: gpt56Model } });
    assertNoForeignCacheFields(body, []);
    assert.ok(!JSON.stringify(body).includes("prompt_cache_key"), "no explicit cache key before the wire probe (Task 5/9)");
  });

  it("commandcode_chat_route_usage_requires_no_opt_in", async () => {
    let body: any;
    const provider = createCommandCodeProvider({
      apiKey: "fake-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(
          sse([
            { choices: [{ delta: { content: "hi" } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
          ]),
        );
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: baseRequest,
      expect: { text: "hi", usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } },
    });
    assert.equal(
      body.stream_options?.include_usage,
      true,
      "shared builder asks for usage; docs guarantee the final usage chunk without it",
    );
  });
});
