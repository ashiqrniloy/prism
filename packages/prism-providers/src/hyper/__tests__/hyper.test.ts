import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import {
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
  classifyHyperError,
  createHyperProvider,
  createHyperProviderPackage,
  defineHyperModel,
  getHyperCredits,
  HYPER_DEFAULT_BASE_URL,
  hyperChatBody,
  hyperModels,
  listHyperModels,
  parseHyperUsageCost,
  routeForHyperModel,
} from "../index.js";

const openaiModel: ModelConfig = {
  provider: "hyper",
  model: "deepseek-v4-pro",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true, reasoning_effort: "high", effortLevels: ["high", "xhigh"] },
  cache: { kind: "implicit" },
  limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
  cost: { input: 2.4, output: 4.8, cacheRead: 0.2, currency: "USD", unit: "per_million_tokens" },
};

const qwenAnthropicModel: ModelConfig = {
  provider: "hyper",
  model: "qwen3.6-plus",
  capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "anthropic", preserveThinking: true },
  cache: { kind: "cache_control", maxBreakpoints: 4 },
};

const visionModel: ModelConfig = {
  provider: "hyper",
  model: "qwen3.7-flash",
  capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true },
  cache: { kind: "implicit" },
};

const responsesModel: ModelConfig = {
  provider: "hyper",
  model: "deepseek-v4-pro",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "responses", preserveThinking: true, reasoning: { effort: "high" } },
  cache: { kind: "implicit" },
};

const baseRequest: ProviderRequest = {
  model: openaiModel,
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

describe("@arnilo/prism-providers/hyper", () => {
  it("hyper_registers_featured_models_and_setup_does_not_fetch", async () => {
    const fetchCalls: unknown[] = [];
    const fetchImpl = (async () => {
      fetchCalls.push(1);
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createHyperProviderPackage({ apiKey: "fake-hyper-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assertNoFetches(fetchCalls);
    assert(registered.some((item: any) => item.id === "hyper"));
    assert(registered.some((item: any) => item.provider === "hyper" && item.kind === "api_key"));
    const models = registered.filter((item: any): item is ModelConfig => typeof item?.model === "string" && item.provider === "hyper");
    assert.ok(models.length >= 31, `expected full live-stable catalog, got ${models.length}`);
    const byId = new Map(models.map((m) => [m.model, m]));
    const deepseek = byId.get("deepseek-v4-pro");
    assert.equal(deepseek?.compat?.route, "openai");
    assert.equal(deepseek?.cache?.kind, "implicit");
    assert.equal(deepseek?.cost?.cacheRead, 0.2);
    assert.equal(deepseek?.compat?.reasoning_effort, "high");
    const qwen36 = byId.get("qwen3.6-plus");
    assert.equal(qwen36?.compat?.route, "anthropic");
    assert.equal(qwen36?.cache?.kind, "cache_control");
    assert.equal(qwen36?.cost?.cacheWrite, 2.5);
    const kimi3 = byId.get("kimi-k3");
    assert.deepEqual(kimi3?.capabilities?.input, ["text", "image"]);
    assert.equal(kimi3?.compat?.reasoning_effort, "max");
    assert.ok([...byId.values()].every((m) => m.compat?.route === "openai" || m.compat?.route === "anthropic"));
    assert.equal(HYPER_DEFAULT_BASE_URL, "https://hyper.charm.land/v1");
    assert.equal(routeForHyperModel("qwen3.6-flash"), "anthropic");
    assert.equal(routeForHyperModel("deepseek-v4-pro"), "openai");
  });

  it("hyper_defaults_to_official_hyper_base_url", async () => {
    let url = "";
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(url, "https://hyper.charm.land/v1/chat/completions");
  });

  it("hyper_chat_route_streams_text_thinking_tool_calls_and_usage", async () => {
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
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

  it("hyper_chat_body_replays_reasoning_content_and_defaults_effort", async () => {
    let body: any;
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
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
    assert.equal(body.reasoning_effort, "high", "model default effort emitted");
    const assistant = body.messages[1];
    assert.equal(assistant.reasoning_content, "plan");
    assert.ok(!JSON.stringify(body).includes("effortLevels"), "metadata never reaches the wire");
  });

  it("hyper_chat_body_request_effort_wins_and_invalid_effort_is_dropped", async () => {
    const bodies: any[] = [];
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
      fetch: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: { ...baseRequest, options: { compat: { reasoning_effort: "xhigh" } } },
    });
    await assertProviderStreamConforms({
      provider,
      request: { ...baseRequest, options: { compat: { reasoning_effort: "ultra" } } },
    });
    assert.equal(bodies[0].reasoning_effort, "xhigh", "request effort within documented set wins");
    // Snap replaces drop: max floors into the declared set's ceiling, opaque values pass through.
    assert.equal(bodies[1].reasoning_effort, "ultra", "opaque non-ladder effort passes through");
  });

  it("hyper_anthropic_route_uses_messages_endpoint_with_claude_code_auth", async () => {
    let url = "";
    let headers = new Headers();
    let body: any;
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: qwenAnthropicModel } });
    assert.equal(url, "https://hyper.charm.land/v1/messages");
    assert.equal(headers.get("x-api-key"), "fake-hyper-key");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.equal(body.model, "qwen3.6-plus");
    assert.equal(body.stream, true);
    assertNoForeignCacheFields(body, ["cache_control"]);
  });

  it("hyper_anthropic_route_emits_cache_control_only_at_selected_breakpoints", async () => {
    let body: any;
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        model: qwenAnthropicModel,
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
    const system = Array.isArray(body.system) ? body.system : [{ type: "text", text: body.system }];
    assert.equal(system[0].text, "rules");
    assert.ok(JSON.stringify(system).includes("cache_control"), "system_prompt breakpoint marker present");
    const noMarker = body.messages[1];
    assert.ok(!JSON.stringify(noMarker).includes("cache_control"), "non-selected messages carry no marker");
  });

  it("hyper_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
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
          headers: {
            authorization: "Bearer attacker",
            "content-type": "text/plain",
            "x-caller": "kept",
          },
        },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-hyper-key", "content-type": "application/json" },
      caller: { "x-caller": "kept" },
    });
    assert.equal(headers.get("x-caller"), "kept");
  });

  it("hyper_402_billing_error_is_non_retryable_and_redacted", async () => {
    const provider = createHyperProvider({
      apiKey: "sk-hyper-secret-key",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "not enough Hypercredits sk-hyper-secret-key", code: "billing_error" } }), {
          status: 402,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(baseRequest)) events.push(event);
    const errorEvent = events.at(-1);
    assert.equal(errorEvent?.type, "error");
    const err = (errorEvent as any)?.error as Error & { code?: number };
    assert.equal(err.code, 402);
    assert.match(String(err.message), /billing_error/);
    assertNoSecretLeak(events, ["sk-hyper-secret-key"]);
  });

  it("hyper_429_is_retryable_with_retry_after", async () => {
    const decision = classifyHyperError({ status: 429, headers: new Headers({ "retry-after": "2" }) });
    assert.equal(decision.retryable, true);
    assert.equal(decision.retryAfterMs, 2000);
    const billing = classifyHyperError({ status: 402, body: { error: { code: "billing_error" } } });
    assert.equal(billing.retryable, false);
    assert.equal(billing.errorCode, "billing_error");
    const server = classifyHyperError({ status: 503 });
    assert.equal(server.retryable, true);
  });

  it("hyper_chat_route_rejects_document_blocks", async () => {
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const provider = createHyperProvider({ apiKey: "fake-hyper-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      ...baseRequest,
      messages: [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: tinyPdf }] }],
    }))
      events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } })?.error?.message ?? events.at(-1)), /document/);
  });

  it("hyper_vision_model_serialized_request_covers_image_content", async () => {
    let body: any;
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
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

  it("hyper_list_models_maps_live_entries_without_auth", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      assert.deepEqual(init?.headers ?? {}, {}, "public endpoint must not emit headers without a key");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "deepseek-v4-pro",
              display_name: "DeepSeek V4 Pro",
              context_window: 1_000_000,
              max_output_tokens: 384_000,
              capabilities: { vision: false },
              reasoning: { effort_levels: [{ value: "high" }, { value: "xhigh" }], default_effort_level: "high" },
              pricing: { input: 2.4, output: 4.8, cache_create: 0, cache_hit: 0.2 },
            },
            {
              id: "qwen3.6-plus",
              display_name: "Qwen 3.6 Plus",
              context_window: 1_000_000,
              max_output_tokens: 64_000,
              capabilities: { vision: true },
              pricing: { input: 2, output: 6, cache_create: 2.5, cache_hit: 0.2 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const models = await listHyperModels({ fetch: fetchImpl });
    assert.equal(models.length, 2);
    const [deepseek, qwen] = models;
    assert.equal(deepseek.model, "deepseek-v4-pro");
    assert.equal(deepseek.compat?.route, "openai");
    assert.equal(deepseek.cache?.kind, "implicit");
    assert.equal(deepseek.cost?.cacheRead, 0.2);
    assert.equal(deepseek.compat?.reasoning_effort, "high");
    // API-derived: effort_levels → declared levels + family stamp (back-compat effortLevels kept).
    assert.deepEqual(deepseek.capabilities?.thinkingLevels, ["high", "xhigh"]);
    assert.deepEqual(deepseek.compat?.effortLevels, ["high", "xhigh"]);
    assert.equal(deepseek.compat?.thinkingFamily, "reasoning_effort");
    assert.equal(qwen.compat?.route, "anthropic");
    assert.equal(qwen.cache?.kind, "cache_control");
    assert.deepEqual(qwen.capabilities?.input, ["text", "image"]);
  });

  it("hyper_credits_reports_balance", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer fake-hyper-key");
      return new Response(JSON.stringify({ balance: 42 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const credits = await getHyperCredits({ apiKey: "fake-hyper-key", fetch: fetchImpl });
    assert.equal(credits.balance, 42);
  });

  it("hyper_usage_cost_fields_extract_from_wire_usage", () => {
    const cost = parseHyperUsageCost({
      prompt_tokens: 5,
      completion_tokens: 2,
      cost: { usd: 0.0001, hypercredits: 0.002 },
      remaining: { hypercredits: 99.5 },
    });
    assert.equal(cost?.usd, 0.0001);
    assert.equal(cost?.hypercredits, 0.002);
    assert.equal(cost?.remainingHypercredits, 99.5);
    assert.equal(parseHyperUsageCost("nope"), undefined);
  });

  it("hyper_anthropic_route_reports_cache_usage_from_message_delta", async () => {
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
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
      request: { ...baseRequest, model: qwenAnthropicModel },
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } },
    });
    assertUsageAccounting(events, { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 });
  });

  describe("hyper responses route", () => {
    it("routes_to_v1_responses_and_streams_text_thinking_tool_calls_usage", async () => {
      let url = "";
      let body: any;
      const provider = createHyperProvider({
        apiKey: "fake-hyper-key",
        fetch: (async (input, init) => {
          url = String(input);
          body = JSON.parse(String(init?.body));
          return ok(
            sse([
              { type: "response.output_text.delta", delta: "hello" },
              { type: "response.reasoning_text.delta", delta: "think" },
              {
                type: "response.output_item.added",
                output_index: 0,
                item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "" },
              },
              { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"q":' },
              { type: "response.function_call_arguments.delta", output_index: 0, delta: '"x"}' },
              { type: "response.function_call_arguments.done", output_index: 0, arguments: '{"q":"x"}' },
              {
                type: "response.completed",
                response: {
                  usage: {
                    input_tokens: 10,
                    output_tokens: 3,
                    total_tokens: 13,
                    input_tokens_details: { cached_tokens: 4, cache_write_tokens: 12 },
                  },
                },
              },
            ]),
          );
        }) as typeof fetch,
      });
      const events = await assertProviderStreamConforms({
        provider,
        request: { ...baseRequest, model: responsesModel },
        expect: {
          text: "hello",
          usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4, cacheWriteTokens: 12 },
        },
      });
      assert.equal(url, "https://hyper.charm.land/v1/responses");
      assert.equal(body.model, "deepseek-v4-pro");
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
      assert.ok(Array.isArray(body.input), "Responses input array expected");
      assert.equal(body.input[0].role, "user");
      assert.equal(body.input[0].content[0].type, "input_text");
      assert.equal(body.tools[0].type, "function");
      assert(
        events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"),
        "reasoning delta mapped to thinking",
      );
      assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
    });

    it("carries_openai_standard_reasoning_and_sanitized_cache_key_from_hints", async () => {
      let body: any;
      const provider = createHyperProvider({
        apiKey: "fake-hyper-key",
        fetch: (async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return ok(sse([]));
        }) as typeof fetch,
      });
      await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: responsesModel } });
      // Shared Responses machinery: `reasoning` summary from compat, and the
      // OpenAI-standard `prompt_cache_key` derived from the caller's session id
      // (sanitized/clamped by the shared helper, never a credential).
      assert.deepEqual(body.reasoning, { effort: "high" });
      assert.equal(body.prompt_cache_key, "session-with-spaces");
      assert.equal(body.prompt_cache_options, undefined);
      assert.equal(body.prompt_cache_retention, undefined);
    });

    it("implicit_responses_models_without_hints_send_no_foreign_cache_fields", async () => {
      let body: any;
      const provider = createHyperProvider({
        apiKey: "fake-hyper-key",
        fetch: (async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return ok(sse([]));
        }) as typeof fetch,
      });
      await assertProviderStreamConforms({
        provider,
        request: { model: responsesModel, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      });
      assertNoForeignCacheFields(body, ["prompt_cache_key", "prompt_cache_options", "prompt_cache_retention"]);
      assert.equal(responsesModel.cache?.kind, "implicit");
    });

    it("keeps_provider_owned_headers_labeled_errors_and_redacts_secrets", async () => {
      let headers = new Headers();
      let first = true;
      const provider = createHyperProvider({
        apiKey: "sk-hyper-secret-key",
        fetch: (async (_url, init) => {
          headers = new Headers(init?.headers);
          if (first) {
            first = false;
            return ok(sse([]));
          }
          return new Response(JSON.stringify({ error: { message: "bad key sk-hyper-secret-key", code: "authentication_error" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch,
      });
      await assertProviderStreamConforms({
        provider,
        request: {
          ...baseRequest,
          model: responsesModel,
          options: { headers: { authorization: "Bearer attacker", "x-caller": "kept" } },
        },
      });
      assertProviderOwnedHeadersWin(headers, {
        owned: { authorization: "Bearer sk-hyper-secret-key", "content-type": "application/json" },
        caller: { "x-caller": "kept" },
      });
      const events: ProviderEvent[] = [];
      for await (const event of provider.generate({ ...baseRequest, model: responsesModel })) events.push(event);
      const errorEvent = events.at(-1);
      assert.equal(errorEvent?.type, "error");
      const err = (errorEvent as { error?: Error })?.error;
      assert.match(String(err?.message), /Hyper request failed/, "provider label appears in errors");
      assertNoSecretLeak(events, ["sk-hyper-secret-key"]);
    });

    it("observes_abort_before_first_request", async () => {
      let fetched = false;
      const provider = createHyperProvider({
        apiKey: "fake-hyper-key",
        fetch: (async () => {
          fetched = true;
          return ok(sse([]));
        }) as typeof fetch,
      });
      const controller = new AbortController();
      controller.abort(new Error("stop"));
      await assert.rejects(async () => {
        for await (const _ of provider.generate({ ...baseRequest, model: responsesModel, signal: controller.signal })) {
          /* drain */
        }
      }, /stop/);
      assert.equal(fetched, false);
    });

    it("define_hyper_model_preserves_explicit_responses_route_as_implicit_cache", () => {
      const defined = defineHyperModel({ model: "deepseek-v4-pro", compat: { route: "responses" } });
      assert.equal(defined.compat?.route, "responses");
      assert.equal(defined.cache?.kind, "implicit");
    });
  });
});

describe("hyper_api_derived_levels_and_anthropic_effort", () => {
  const base = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as const;

  it("featured_models_declare_levels_and_family_stamp", () => {
    const flash = hyperModels.find((model) => model.model === "deepseek-v4-flash")!;
    assert.deepEqual(flash.capabilities?.thinkingLevels, ["high", "xhigh"]);
    assert.equal(flash.compat?.thinkingFamily, "reasoning_effort");
    assert.deepEqual(flash.compat?.effortLevels, ["high", "xhigh"]);
  });

  it("chat_route_snaps_max_to_xhigh_and_xhigh_forwarded", () => {
    const body = hyperChatBody({
      ...base,
      model: hyperModels.find((model) => model.model === "deepseek-v4-flash")!,
      options: { compat: { reasoning_effort: "max" } },
    } as never);
    assert.equal(body.reasoning_effort, "xhigh");
    const within = hyperChatBody({
      ...base,
      model: hyperModels.find((model) => model.model === "deepseek-v4-flash")!,
      options: { compat: { reasoning_effort: "xhigh" } },
    } as never);
    assert.equal(within.reasoning_effort, "xhigh");
  });

  it("anthropic_route_emits_resolved_thinking_and_output_config_effort", async () => {
    let body: any;
    const provider = createHyperProvider({
      apiKey: "fake-hyper-key",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...baseRequest,
        model: qwenAnthropicModel,
        options: { compat: { reasoning_effort: "max", thinking: true } },
      },
    });
    assert.deepEqual(body.output_config, { effort: "max" });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, undefined, "raw compat never leaks");
  });
});
