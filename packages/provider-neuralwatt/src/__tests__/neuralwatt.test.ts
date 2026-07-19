import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, JsonObject, ModelConfig, ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { applyThinkingLevel, cacheSavings } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import {
  createNeuralWattProvider,
  createNeuralWattProviderPackage,
  defineNeuralWattModel,
  listNeuralWattModels,
  mapNeuralWattTelemetry,
  neuralWattBody,
  neuralWattEvents,
  neuralWattEventsWithTelemetry,
  neuralWattModels,
  parseNeuralWattComment,
  toUsage,
} from "../index.js";

const model: ModelConfig = {
  provider: "neuralwatt",
  model: "glm-4.7",
  capabilities: { input: ["text"], output: ["text"], streaming: true, tools: true, reasoning: true },
  limits: { contextWindow: 128_000, maxOutputTokens: 32_000 },
  cache: { kind: "implicit" },
};

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

describe("@arnilo/prism-provider-neuralwatt (provider shell)", () => {
  it("neuralwatt_post_url_and_auth_header", async () => {
    let capturedUrl = "";
    let headers = new Headers();
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await collect(provider, request);
    assert.equal(capturedUrl, "https://api.neuralwatt.com/v1/chat/completions");
    assert.equal(headers.get("authorization"), "Bearer fake-neuralwatt-key");
    assert.equal(headers.get("content-type"), "application/json");
  });

  it("neuralwatt_caller_header_cannot_override_auth", async () => {
    let headers = new Headers();
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await collect(provider, { ...request, options: { headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-neuralwatt-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("neuralwatt_abort_throws_before_fetch", async () => {
    let called = false;
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => {
        called = true;
        return ok(sse([]));
      }) as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort(new Error("aborted by caller"));
    await assert.rejects(async () => {
      for await (const _event of provider.generate({ ...request, signal: controller.signal })) {
        void _event;
      }
    }, /aborted/);
    assert.equal(called, false, "fetch must not be called when signal is already aborted");
  });

  it("neuralwatt_missing_token_omits_authorization", async () => {
    let headers = new Headers();
    const provider = createNeuralWattProvider({
      apiKey: undefined,
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    const events = await collect(provider, request);
    assert.equal(headers.get("authorization"), null, "no authorization header when token absent");
    const last = events.at(-1);
    assert.ok(last, "stream produced events");
    // Empty SSE stream still terminates cleanly with done.
    assert.equal((last as { type: string }).type, "done");
  });

  it("neuralwatt_custom_base_url_is_used", async () => {
    let capturedUrl = "";
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      baseUrl: "https://proxy.example.test/neuralwatt/v1/",
      fetch: (async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await collect(provider, request);
    assert.equal(capturedUrl, "https://proxy.example.test/neuralwatt/v1/chat/completions");
  });
});

describe("@arnilo/prism-provider-neuralwatt (model registry)", () => {
  it("neuralwatt_registers_models_and_auth", async () => {
    const registered: unknown[] = [];
    await createNeuralWattProviderPackage({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse([]))) as typeof fetch,
    }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (m: ModelConfig) => registered.push(m),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as never);
    assert.ok(registered.some((item) => (item as AIProvider).id === "neuralwatt"), "provider registered");
    assert.ok(registered.some((item) => (item as ModelConfig).provider === "neuralwatt" && (item as ModelConfig).model === "glm-5.2"), "glm-5.2 model registered");
    assert.ok(registered.some((item) => (item as ModelConfig).provider === "neuralwatt" && (item as ModelConfig).model === "kimi-k2.6"), "kimi-k2.6 model registered");
    assert.ok(registered.some((item) => (item as AuthMethod).provider === "neuralwatt" && (item as AuthMethod).kind === "api_key"), "api_key auth method registered");
  });

  it("neuralwatt_models_include_featured_aliases", () => {
    const aliases = new Set(neuralWattModels.map((m) => m.model));
    for (const alias of [
      "glm-5.2",
      "glm-5.2-fast",
      "glm-5.2-short",
      "glm-5.2-short-fast",
      "gemma-4-31b",
      "kimi-k2.6",
      "kimi-k2.6-fast",
      "kimi-k2.7-code",
      "qwen3.5-397b",
      "qwen3.5-397b-fast",
      "qwen3.6-35b",
      "qwen3.6-35b-fast",
    ]) {
      assert.equal(aliases.has(alias), true, `${alias} must be curated`);
      assert.equal(neuralWattModels.filter((m) => m.model === alias).length, 1, `${alias} must be unique`);
    }
  });

  it("neuralwatt_models_marked_implicit_cache_and_capabilities", () => {
    for (const m of neuralWattModels) {
      assert.equal(m.provider, "neuralwatt");
      assert.equal(m.cache?.kind, "implicit", `${m.model} must use implicit cache`);
      const caps = m.capabilities;
      assert.ok(caps, `${m.model} must declare capabilities`);
      assert.ok(caps!.input?.includes("text"), `${m.model} must accept text input`);
      assert.equal(caps!.streaming, true);
      assert.equal(caps!.tools, true);
      const limits = m.limits;
      assert.ok(limits, `${m.model} must declare limits`);
      assert.ok(typeof limits!.contextWindow === "number");
      assert.ok(limits!.contextWindow > 0);
    }
    assert.deepEqual(neuralWattModels.find((m) => m.model === "kimi-k2.6")?.capabilities?.input, ["text", "image"]);
    assert.deepEqual(neuralWattModels.find((m) => m.model === "gemma-4-31b")?.capabilities?.input, ["text", "image"]);
    assert.equal(neuralWattModels.find((m) => m.model === "glm-5.2")?.compat?.reasoning_effort, "max");
    assert.equal(neuralWattModels.find((m) => m.model === "glm-5.2-fast")?.capabilities?.reasoning, false);
  });

  it("neuralwatt_models_do_not_guess_unknown_pricing", () => {
    for (const m of neuralWattModels) {
      assert.equal(m.cost, undefined, `${m.model} should wait for exact /v1/models pricing`);
      assert.equal((m.compat as { pricing_source?: string } | undefined)?.pricing_source, "/v1/models");
    }
  });

  it("defineNeuralWattModel_overrides_model_config", () => {
    const custom = defineNeuralWattModel({
      model: "custom-llm",
      limits: { contextWindow: 8_000, maxOutputTokens: 1_000 },
      cache: { kind: "implicit" },
    });
    assert.equal(custom.provider, "neuralwatt");
    assert.equal(custom.model, "custom-llm");
    assert.equal(custom.capabilities?.streaming, true, "default capabilities applied");
  });
});

describe("@arnilo/prism-provider-neuralwatt (model discovery)", () => {
  it("list_neuralwatt_models_maps_metadata", async () => {
    const models = await listNeuralWattModels({ fetch: mockJsonFetch(200, modelsFixture()) });
    assert.equal(models.length, 1);
    assert.deepEqual(models[0], {
      provider: "neuralwatt",
      model: "alias/glm",
      displayName: "GLM Alias",
      capabilities: {
        input: ["text", "image"],
        output: ["text"],
        tools: true,
        reasoning: true,
        streaming: true,
        structuredOutput: "json_schema",
      },
      limits: { contextWindow: 202_752, maxOutputTokens: 16_384 },
      cost: { input: 0.35, output: 1.38, cacheRead: 0.0875, currency: "USD", unit: "per_million_tokens" },
      cache: { kind: "implicit" },
      compat: {
        reasoning: true,
        reasoning_effort: "max",
        tool_stream: true,
        json_mode: true,
        neuralwatt: {
          owned_by: "neuralwatt",
          provider: "Z.ai",
          huggingface_id: "zai-org/GLM-5.1-FP8",
          description: "demo",
          deprecated: false,
          max_images: 4,
          system_role: true,
          developer_role: false,
          pricing_tbd: false,
        },
      },
    });
  });

  it("list_neuralwatt_models_auth_header_owned", async () => {
    let headers = new Headers();
    await listNeuralWattModels({
      apiKey: "fake-neuralwatt-key",
      headers: { authorization: "Bearer attacker", "x-caller": "kept" },
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return json(200, modelsFixture());
      }) as typeof fetch,
    });
    assert.equal(headers.get("authorization"), "Bearer fake-neuralwatt-key");
    assert.equal(headers.get("x-caller"), "kept");
  });

  it("list_neuralwatt_models_omits_auth_when_no_key", async () => {
    let capturedUrl = "";
    let calls = 0;
    let headers = new Headers();
    const controller = new AbortController();
    await listNeuralWattModels({
      baseUrl: "https://proxy.example.test/neuralwatt/v1/",
      signal: controller.signal,
      fetch: (async (input, init) => {
        calls++;
        capturedUrl = String(input);
        headers = new Headers(init?.headers);
        assert.equal(init?.signal, controller.signal);
        return json(200, modelsFixture());
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    assert.equal(capturedUrl, "https://proxy.example.test/neuralwatt/v1/models");
    assert.equal(headers.get("authorization"), null);
  });

  it("list_neuralwatt_models_preserves_aliases_and_rejects_malformed_payloads", async () => {
    const fixture = modelsFixture() as { data: object[] };
    const models = await listNeuralWattModels({ fetch: mockJsonFetch(200, { data: [...fixture.data, { ...fixture.data[0], id: "alias/glm-fast" }] }) });
    assert.deepEqual(models.map((m) => m.model), ["alias/glm", "alias/glm-fast"]);
    await assert.rejects(() => listNeuralWattModels({ fetch: mockJsonFetch(200, { object: "list" }) }), /missing data array/);
  });

  it("list_neuralwatt_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listNeuralWattModels({ apiKey: "secret-neuralwatt-token", fetch: mockTextFetch(503, "bad secret-neuralwatt-token") }),
      (error: unknown) => error instanceof Error && /\[REDACTED\]/.test(error.message) && !error.message.includes("secret-neuralwatt-token"),
    );
  });

  it("neuralwatt_provider_setup_does_not_call_model_discovery", async () => {
    let calls = 0;
    await createNeuralWattProviderPackage({
      fetch: (async () => {
        calls++;
        return json(200, modelsFixture());
      }) as typeof fetch,
    }).setup({
      registerProvider: () => undefined,
      registerModel: () => undefined,
      registerAuthMethod: () => undefined,
    } as never);
    assert.equal(calls, 0);
  });
});

describe("@arnilo/prism-provider-neuralwatt (serializer)", () => {
  it("neuralwatt_body_covers_content", async () => {
    const imageModel: ModelConfig = {
      ...model,
      capabilities: { input: ["text", "image"], output: ["text"], streaming: true, tools: true, reasoning: true },
    };
    const reql: ProviderRequest = {
      ...request,
      model: imageModel,
      messages: [
        { role: "user", content: [{ type: "text", text: "hello-canary" }] },
        { role: "user", content: [{ type: "image", url: "https://example.invalid/img.png" }] },
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async (_input, init) => {
        void init;
        return ok(sse([]));
      }) as typeof fetch,
    });
    await collect(provider, reql);
    const body = neuralWattBody(reql);
    assertSerializedRequestCoversContent(reql, body);
    assert.ok(JSON.stringify(body).includes("image_url"), "image block must serialize to image_url");
  });

  it("neuralwatt_body_includes_reasoning_and_template_fields", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        compat: {
          reasoning_effort: "high",
          thinking_token_budget: 2048,
          chat_template_kwargs: { enable_thinking: true },
        },
      },
    };
    const body = neuralWattBody(req);
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.thinking_token_budget, 2048);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
    // OpenAI-compatible base fields.
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
  });

  it("neuralwatt_preserve_and_clear_thinking_route_to_chat_template_kwargs", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        compat: {
          preserve_thinking: true,
          clear_thinking: false,
        },
      },
    };
    const body = neuralWattBody(req);
    assert.deepEqual(body.chat_template_kwargs, { preserve_thinking: true, clear_thinking: false });
    assert.equal("preserve_thinking" in body, false, "preserve_thinking must not be top-level");
    assert.equal("clear_thinking" in body, false, "clear_thinking must not be top-level");
  });

  it("neuralwatt_preserve_and_clear_thinking_omitted_when_undefined", () => {
    const body = neuralWattBody(request);
    assert.equal(body.chat_template_kwargs, undefined);
    assert.equal("preserve_thinking" in body, false);
    assert.equal("clear_thinking" in body, false);
  });

  it("neuralwatt_preserve_and_clear_thinking_from_model_compat", () => {
    const req: ProviderRequest = {
      ...request,
      model: { ...request.model, compat: { preserve_thinking: true, clear_thinking: true } },
    };
    const body = neuralWattBody(req);
    assert.deepEqual(body.chat_template_kwargs, { preserve_thinking: true, clear_thinking: true });
  });

  it("neuralwatt_all_reasoning_controls_round_trip", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        compat: {
          reasoning_effort: "high",
          thinking_token_budget: 4096,
          chat_template_kwargs: { enable_thinking: true },
          preserve_thinking: true,
          clear_thinking: false,
        },
      },
    };
    const body = neuralWattBody(req);
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.thinking_token_budget, 4096);
    assert.deepEqual(body.chat_template_kwargs, {
      enable_thinking: true,
      preserve_thinking: true,
      clear_thinking: false,
    });
    assert.equal(body.preserve_thinking, undefined);
    assert.equal(body.clear_thinking, undefined);
  });

  it("neuralwatt_chat_template_kwargs_merge_and_explicit_kwargs_win", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        compat: {
          preserve_thinking: true,
          chat_template_kwargs: { enable_thinking: true, preserve_thinking: false },
        },
      },
    };
    const body = neuralWattBody(req);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true, preserve_thinking: false });
  });

  it("neuralwatt_resolved_reasoning_controls_win_over_opaque_compat_spread", () => {
    const req: ProviderRequest = {
      ...request,
      model: { ...request.model, compat: { reasoning_effort: "max" } },
      options: {
        compat: {
          reasoning_effort: "low",
          thinking_token_budget: 999,
          tool_choice: "none",
        },
      },
    };
    const body = neuralWattBody(req);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.thinking_token_budget, 999);
    assert.equal(body.tool_choice, "none");
  });

  it("neuralwatt_apply_thinking_level_integrates_with_reasoning_effort", () => {
    const req: ProviderRequest = {
      ...request,
      options: applyThinkingLevel({ compat: { reasoning_effort: "max" } }, "high", "reasoning_effort"),
    };
    const body = neuralWattBody(req);
    assert.equal(body.reasoning_effort, "high");
  });

  it("neuralwatt_body_extra_escape_hatch_adds_custom_fields", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        compat: { reasoning_effort: "medium" },
        extra: { reasoning_effort: "high", custom_neuralwatt_field: "override-wins" },
      },
    };
    const body = neuralWattBody(req);
    // Resolved owned fields win over stale extra escape hatches.
    assert.equal(body.reasoning_effort, "medium");
    assert.equal((body as Record<string, unknown>).custom_neuralwatt_field, "override-wins");
  });

  it("neuralwatt_image_without_capability_throws", () => {
    const req: ProviderRequest = {
      ...request,
      messages: [{ role: "user", content: [{ type: "image", url: "https://example.invalid/img.png" }] }],
    };
    assert.throws(() => neuralWattBody(req), /image input capability/);
  });

  it("neuralwatt_tool_choice_passthrough", () => {
    const req: ProviderRequest = {
      ...request,
      options: { compat: { tool_choice: "auto" } },
    };
    let body = neuralWattBody(req);
    assert.equal(body.tool_choice, "auto");

    const req2: ProviderRequest = {
      ...request,
      options: { compat: { tool_choice: { type: "function", function: { name: "lookup" } } } },
    };
    body = neuralWattBody(req2);
    assert.deepEqual(body.tool_choice, { type: "function", function: { name: "lookup" } });
  });

  it("neuralwatt_body_no_explicit_cache_payload_for_implicit_caching", () => {
    const req: ProviderRequest = {
      ...request,
      options: {
        cacheKey: "sess",
        cacheRetention: "long" as const,
        cache: { breakpoints: [{ location: "last_stable_message" as const }] },
      },
    };
    const serialized = JSON.stringify(neuralWattBody(req));
    assert.ok(!serialized.includes("cache_control"), "NeuralWatt body must not contain cache_control");
    assert.ok(!serialized.includes("cacheKey"), "NeuralWatt body must not contain cacheKey");
    assert.ok(!serialized.includes("prompt_cache"), "NeuralWatt body must not contain prompt_cache fields");
    assert.ok(!serialized.includes("cacheRetention"), "NeuralWatt body must not contain cacheRetention");
  });
});

describe("@arnilo/prism-provider-neuralwatt (reasoning preservation)", () => {
  const priorAssistant = {
    role: "assistant" as const,
    content: [
      { type: "thinking" as const, text: "step 1: 2+2=4" },
      { type: "text" as const, text: "The answer is 4." },
    ],
  };
  const reasoningModel: ModelConfig = { ...model, capabilities: { ...model.capabilities!, reasoning: true } };
  const nonReasoningModel: ModelConfig = { ...model, capabilities: { input: ["text"], output: ["text"], streaming: true, tools: true, reasoning: false } };

  it("neuralwatt_preserves_prior_reasoning_for_reasoning_model", () => {
    const req: ProviderRequest = {
      ...request,
      model: reasoningModel,
      messages: [
        { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
        priorAssistant,
        { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
      ],
    };
    const body = neuralWattBody(req);
    const messages = body.messages as readonly { reasoning_content?: string; content?: unknown }[];
    const assistant = messages[1]!;
    assert.equal(assistant.reasoning_content, "step 1: 2+2=4", "reasoning-capable model must preserve prior thinking under reasoning_content");
    // Thinking must NOT be flattened into text content.
    assert.equal(assistant.content, "The answer is 4.");
  });

  it("neuralwatt_omits_reasoning_for_non_reasoning_model", () => {
    const req: ProviderRequest = {
      ...request,
      model: nonReasoningModel,
      messages: [
        { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
        priorAssistant,
        { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
      ],
    };
    const body = neuralWattBody(req);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("step 1: 2+2=4"), "non-reasoning model must not receive prior thinking in any field");
    assert.ok(!serialized.includes("reasoning_content"), "non-reasoning model must not get a reasoning_content field");
    const messages = body.messages as readonly { content?: unknown }[];
    assert.equal(messages[1]!.content, "The answer is 4.");
  });

  it("neuralwatt_clear_thinking_drops_reasoning_even_for_reasoning_model", () => {
    const req: ProviderRequest = {
      ...request,
      model: reasoningModel,
      options: { compat: { clear_thinking: true } },
      messages: [
        { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
        priorAssistant,
        { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
      ],
    };
    const body = neuralWattBody(req);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("step 1: 2+2=4"), "clear_thinking must drop prior reasoning even on reasoning-capable models");
    assert.ok(!serialized.includes("reasoning_content"), "clear_thinking must not emit reasoning_content");
  });

  it("neuralwatt_preserve_thinking_flag_forces_preservation_on_non_reasoning_model", () => {
    const req: ProviderRequest = {
      ...request,
      model: nonReasoningModel,
      options: { compat: { preserve_thinking: true } },
      messages: [
        { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
        priorAssistant,
        { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
      ],
    };
    const body = neuralWattBody(req);
    const messages = body.messages as readonly { reasoning_content?: string; content?: unknown }[];
    assert.equal(messages[1]!.reasoning_content, "step 1: 2+2=4", "preserve_thinking must force preservation even without capability");
    assert.equal(messages[1]!.content, "The answer is 4.");
  });

  it("neuralwatt_reasoning_preserved_alongside_tool_calls", () => {
    const assistantWithTools = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, text: "plan: call lookup" },
        { type: "tool_call" as const, id: "call_1", name: "lookup", arguments: { q: "x" } },
      ],
    };
    const req: ProviderRequest = {
      ...request,
      model: reasoningModel,
      messages: [
        { role: "user", content: [{ type: "text", text: "look it up" }] },
        assistantWithTools,
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    const body = neuralWattBody(req);
    const messages = body.messages as readonly { reasoning_content?: string; tool_calls?: unknown[]; content?: unknown }[];
    const assistant = messages[1]!;
    assert.equal(assistant.reasoning_content, "plan: call lookup");
    assert.ok(Array.isArray(assistant.tool_calls) && assistant.tool_calls!.length === 1);
  });
});

describe("@arnilo/prism-provider-neuralwatt (usage mapping)", () => {
  it("neuralwatt_usage_maps_cached_tokens", () => {
    const usage = toUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 42 },
    });
    assert.deepEqual(usage, {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 42,
    });
  });

  it("neuralwatt_usage_no_fabricated_cache_write", () => {
    const usage = toUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 3 },
    });
    assert.equal(usage?.cacheWriteTokens, undefined, "cacheWriteTokens must never be fabricated");
    // Absent details entirely -> cacheRead undefined too, still no write.
    const minimal = toUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    assert.equal(minimal?.cacheWriteTokens, undefined);
    assert.equal(minimal?.cacheReadTokens, undefined);
    assert.equal(toUsage(undefined), undefined, "undefined input -> undefined output");
  });

  it("neuralwatt_usage_via_stream_carries_cache_read", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse([
        { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } } },
      ]))) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request,
      expect: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 3 } },
    });
  });
});

describe("@arnilo/prism-provider-neuralwatt (implicit vLLM prefix caching)", () => {
  // NeuralWatt runs an implicit vLLM prefix cache: there is no client-side
  // cache-control payload, cache reuse depends on a stable prompt prefix,
  // and full prior history must be resent each turn. These tests pin the
  // provider behavior that makes that cache effective, with mocked fetch.

  it("neuralwatt_emits_no_cache_control_payload", () => {
    const body = neuralWattBody(request);
    assert.equal("cache_control" in body, false, "NeuralWatt must not add an OpenAI/Anthropic-style cache_control payload");
    assert.equal("cache" in body, false, "NeuralWatt must not add a top-level cache payload field");
    for (const message of body.messages as readonly object[]) {
      assert.equal("cache_control" in message, false, "no per-message cache_control");
    }
  });

  it("neuralwatt_multi_turn_stable_prefix", async () => {
    const turn1Messages: ProviderRequest["messages"] = [
      { role: "system", content: [{ type: "text", text: "You are a concise assistant." }] },
      { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
    ];
    const turn2Messages: ProviderRequest["messages"] = [
      ...turn1Messages,
      { role: "assistant", content: [{ type: "text", text: "4" }] },
      { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
    ];

    const captured: string[] = [];
    const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(init?.body as string);
      return ok(sse([{ choices: [{ delta: { content: "ok" } }] }]));
    }) as typeof fetch;
    const provider = createNeuralWattProvider({ apiKey: "fake-key", fetch: fetchMock });

    await collect(provider, { ...request, messages: turn1Messages });
    await collect(provider, { ...request, messages: turn2Messages });

    assert.equal(captured.length, 2);
    const body1 = JSON.parse(captured[0]!) as { messages: unknown[] };
    const body2 = JSON.parse(captured[1]!) as { messages: unknown[] };
    // Turn 2 must keep turn 1's serialized messages as an identical prefix.
    assert.equal(body2.messages.length, body1.messages.length + 2);
    assert.deepEqual(body2.messages.slice(0, body1.messages.length), body1.messages);
    // No cache-control payload appears on either turn.
    for (const message of [...body1.messages, ...body2.messages] as readonly object[]) {
      assert.equal("cache_control" in message, false);
    }
  });

  it("neuralwatt_cached_tokens_map_to_usage_across_turns", async () => {
    // Turn 1 cold (no cached_tokens), turn 2 warm (cached_tokens present).
    const responses = [
      ok(rawSse([{ usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 } }])),
      ok(rawSse([
        { choices: [{ delta: { content: "6" } }] },
        { usage: { prompt_tokens: 1020, completion_tokens: 5, total_tokens: 1025, prompt_tokens_details: { cached_tokens: 950 } } },
      ])),
    ];
    let call = 0;
    const provider = createNeuralWattProvider({
      apiKey: "fake-key",
      fetch: (async () => responses[call++]!) as typeof fetch,
    });

    const events1 = await collect(provider, request);
    const events2 = await collect(provider, request);

    const usage2 = events2.find((e) => e.type === "done")?.usage;
    assert.equal(usage2?.cacheReadTokens, 950, "warm turn must surface cached_tokens as cacheReadTokens");
    assert.equal(usage2?.inputTokens, 1020);
    assert.equal(usage2?.cacheWriteTokens, undefined, "cacheWriteTokens must never be fabricated");
    const usage1 = events1.find((e) => e.type === "done")?.usage;
    assert.equal(usage1?.cacheReadTokens, undefined, "cold turn has no cached_tokens");
  });

  it("neuralwatt_cached_input_pricing_is_25pct_and_applied_to_cached_cost", async () => {
    const models = await listNeuralWattModels({ fetch: mockJsonFetch(200, modelsFixture()) });
    const m = models[0]!;
    assert.equal(m.cost?.input, 0.35);
    assert.equal(m.cost?.cacheRead, 0.0875);
    // 25% cached-input pricing relationship.
    assert.equal(m.cost!.cacheRead, m.cost!.input! * 0.25);

    // Cached-token cost savings are computable via the core cache helper:
    // savings = cached_tokens * (input - cacheRead) / unit_divisor.
    const usage = { inputTokens: 1020, cacheReadTokens: 950 } as const;
    const savings = cacheSavings(usage, m);
    assert.equal(savings, 950 * (0.35 - 0.0875) / 1_000_000);
  });
});

describe("@arnilo/prism-provider-neuralwatt (SSE stream)", () => {
  it("neuralwatt_stream_conforms_text_and_done", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async (_input, init) => {
        void init;
        return ok(rawSse([
          { choices: [{ delta: { content: "hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
        ]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request, expect: { text: "hello" } });
  });

  it("neuralwatt_tool_call_deltas_reconstruct", async () => {
    const chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup" } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "\"x\"}" } }],
            },
          },
        ],
      },
    ];
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse(chunks))) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("neuralwatt_reasoning_delta_emits_thinking", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse([
        { choices: [{ delta: { reasoning_content: "thinking-A" } }] },
        { choices: [{ delta: { reasoning_content: "-B" } }] },
      ]))) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    let thinking = "";
    for (const event of events) {
      if (event.type === "content_delta" && event.content.type === "thinking") thinking += event.content.text;
    }
    assert.equal(thinking, "thinking-A-B");
  });

  it("neuralwatt_done_terminates_stream", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse([
        { choices: [{ delta: { content: "pre" } }] },
      ]))) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(events.filter((event) => event.type === "done").length, 1, "exactly one terminal done event");
  });

  it("neuralwatt_usage_chunk_emitted", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse([
        { choices: [{ delta: { content: "x" } }] },
        { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } } },
      ]))) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 3 } },
    });
    assert.ok(events.some((event) => event.type === "usage"), "usage event emitted");
  });

  it("neuralwatt_ignores_energy_cost_comments", async () => {
    // The standard neuralWattEvents stream tolerates `: energy` / `: cost`
    // comment lines without producing spurious events (telemetry is opt-in via
    // neuralWattEventsWithTelemetry).
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(": energy 1.2\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"));
        controller.enqueue(encoder.encode(": cost 0.0004\n\n"));
        controller.enqueue(encoder.encode("data: {\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events: ProviderEvent[] = [];
    for await (const event of neuralWattEvents(stream)) events.push(event);
    // Only: text_delta, usage, done — no error event from comment lines.
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(!events.some((event) => event.type === "error"), "comments must not produce errors");
    assert.ok(!events.some((event) => (event as { type: string }).type === "neuralwatt:telemetry"), "standard stream does not emit telemetry");
  });

  it("neuralwatt_malformed_data_emits_error_then_done", async () => {
    const events: ProviderEvent[] = [];
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("data: {not valid json\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    for await (const event of neuralWattEvents(stream)) events.push(event);
    assert.ok(events.some((event) => event.type === "error"), "malformed data yields error event");
    assert.equal(events.at(-1)?.type, "error", "error is terminal; stream does not crash the generator");
    assert.ok(!events.some((event) => event.type === "done"), "no trailing done after fatal parse error");
  });
});

describe("@arnilo/prism-provider-neuralwatt (tool-call loop)", () => {
  const lookupTool: ToolDefinition = {
    name: "lookup",
    description: "Look up a value by query.",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: () => ({ toolCallId: "call_1", name: "lookup", value: { ok: true } }),
  };

  it("neuralwatt_serializes_openai_style_tools_and_tool_choice", () => {
    const req: ProviderRequest = {
      ...request,
      tools: [lookupTool],
      options: { compat: { tool_choice: "auto" } },
    };
    const body = neuralWattBody(req);
    assert.deepEqual(body.tools, [
      { type: "function", function: { name: "lookup", description: "Look up a value by query.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } },
    ]);
    assert.equal(body.tool_choice, "auto");
  });

  it("neuralwatt_serializes_tools_without_description_or_parameters", () => {
    const bareTool: ToolDefinition = { name: "ping", execute: () => ({ toolCallId: "c", name: "ping", value: 1 }) };
    const req: ProviderRequest = { ...request, tools: [bareTool] };
    const body = neuralWattBody(req);
    const tools = body.tools as unknown as readonly { type: string; function: { name: string; parameters: JsonObject } }[];
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.type, "function");
    assert.equal(tools[0]!.function.name, "ping");
    // Missing parameters default to { type: "object" }.
    assert.deepEqual(tools[0]!.function.parameters, { type: "object" });
  });

  it("neuralwatt_tool_call_loop_reconstructs_then_carries_results_into_next_turn", async () => {
    // --- Turn 1: model emits a tool call via streaming deltas ---
    const turn1Chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"x\"}" } }] } }] },
    ];
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse(turn1Chunks))) as typeof fetch,
    });
    const turn1Req: ProviderRequest = {
      ...request,
      tools: [lookupTool],
      options: { compat: { tool_choice: "auto" } },
    };
    const events = await collect(provider, turn1Req);
    // (b) deltas reconstruct into a complete tool call and a providerToolCall event fires.
    const calls = assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
    assert.equal(calls.length, 1);
    const toolCallEvents = events.filter((event) => event.type === "tool_call");
    assert.equal(toolCallEvents.length, 1, "exactly one providerToolCall event");
    const emittedCall = (toolCallEvents[0] as { call: { id: string; name: string; arguments: unknown } }).call;
    assert.equal(emittedCall.id, "call_1");
    assert.equal(emittedCall.name, "lookup");
    // (d) tool arguments JSON is parsed into an object.
    assert.deepEqual(emittedCall.arguments, { q: "x" });

    // --- Turn 2: host feeds the assistant tool_call + role=tool result back ---
    const toolResult = { ok: true, value: "x-result" };
    const turn2Req: ProviderRequest = {
      ...request,
      tools: [lookupTool],
      options: { compat: { tool_choice: "auto" } },
      messages: [
        { role: "user", content: [{ type: "text", text: "look up x" }] },
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: toolResult }] },
      ],
    };
    // (c) follow-up turn body carries tools, assistant tool_calls, and role=tool in OpenAI order.
    const body2 = neuralWattBody(turn2Req);
    assert.deepEqual(body2.tools, [
      { type: "function", function: { name: "lookup", description: "Look up a value by query.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } },
    ]);
    const messages2 = body2.messages as unknown as readonly {
      role: string;
      content?: unknown;
      tool_calls?: readonly { id: string; type: string; function: { name: string; arguments: string } }[];
      tool_call_id?: string;
    }[];
    assert.equal(messages2[1]!.role, "assistant");
    assert.ok(Array.isArray(messages2[1]!.tool_calls) && messages2[1]!.tool_calls!.length === 1);
    const tc = messages2[1]!.tool_calls![0]!;
    assert.equal(tc.id, "call_1");
    assert.equal(tc.type, "function");
    assert.equal(tc.function.name, "lookup");
    // (d) tool arguments are stringified back to JSON on the request side.
    assert.deepEqual(JSON.parse(tc.function.arguments), { q: "x" });
    assert.equal(messages2[2]!.role, "tool");
    assert.equal(messages2[2]!.tool_call_id, "call_1");
    // (d) tool result is stringified into the tool message content.
    assert.deepEqual(JSON.parse(messages2[2]!.content as string), toolResult);
    // OpenAI order: user, assistant(tool_calls), tool(result). The tool result must
    // immediately follow the assistant tool_call that produced it.
    assert.ok(messages2[1]!.role === "assistant" && messages2[2]!.role === "tool", "tool result must follow the assistant tool_call");

    // --- Turn 2 stream: model produces a final text answer ---
    const provider2 = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(sse([{ choices: [{ delta: { content: "x-result is ready" } }] }]))) as typeof fetch,
    });
    const events2 = await collect(provider2, turn2Req);
    let text2 = "";
    for (const event of events2) if (event.type === "content_delta" && event.content.type === "text") text2 += event.content.text;
    assert.equal(text2, "x-result is ready");
    assert.equal(events2.at(-1)?.type, "done");
  });

  it("neuralwatt_parallel_tool_calls_reconstruct_by_index", async () => {
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "lookup" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "ping" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":\"a\"}" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "{}" } }] } }] },
    ];
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => ok(rawSse(chunks))) as typeof fetch,
    });
    const events = await collect(provider, { ...request, tools: [lookupTool] });
    const calls = assertToolCallDeltasReconstruct(events, [
      { index: 0, id: "call_a", name: "lookup", arguments: { q: "a" } },
      { index: 1, id: "call_b", name: "ping", arguments: {} },
    ]);
    assert.equal(calls.length, 2);
    const toolCallEvents = events.filter((event) => event.type === "tool_call");
    assert.equal(toolCallEvents.length, 2, "two providerToolCall events for parallel calls");
  });
});

describe("@arnilo/prism-provider-neuralwatt (telemetry)", () => {
  it("neuralwatt_stream_parses_energy_and_cost_comments", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(
          ": energy {\"energy_joules\":1280.5,\"energy_kwh\":0.0003557,\"avg_power_watts\":42.7,\"duration_seconds\":30,\"attribution_method\":\"prefix-cache\",\"attribution_ratio\":0.62,\"ratio_was_capped\":false}\n\n",
        ));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"));
        controller.enqueue(encoder.encode(
          ": cost {\"request_cost_usd\":0.00041,\"cache_savings_usd\":0.0021,\"allowance_remaining_usd\":12.5,\"budget_remaining_usd\":87.4}\n\n",
        ));
        controller.enqueue(encoder.encode("data: {\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = [] as { type: string; energy?: { energy_joules?: number }; cost?: { request_cost_usd?: number }; content?: { text?: string } }[];
    for await (const event of neuralWattEventsWithTelemetry(stream)) events.push(event as never);
    const telemetry = events.filter((event) => event.type === "neuralwatt:telemetry");
    assert.equal(telemetry.length, 2, "both energy and cost comments parsed");
    assert.deepEqual(telemetry[0]?.energy, {
      energy_joules: 1280.5,
      energy_kwh: 0.0003557,
      avg_power_watts: 42.7,
      duration_seconds: 30,
      attribution_method: "prefix-cache",
      attribution_ratio: 0.62,
      ratio_was_capped: false,
    });
    assert.deepEqual(telemetry[1]?.cost, {
      request_cost_usd: 0.00041,
      cache_savings_usd: 0.0021,
      allowance_remaining_usd: 12.5,
      budget_remaining_usd: 87.4,
    });
    // Telemetry is interleaved in stream order without breaking text/usage/done.
    assert.equal(events[0]?.type, "neuralwatt:telemetry");
    assert.equal(events[1]?.content?.text, "hi");
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(!events.some((event) => event.type === "error"), "telemetry comments must not produce errors");
  });

  it("neuralwatt_stream_tolerates_missing_energy", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(": cost {\"request_cost_usd\":0.0009}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = [] as { type: string; cost?: { request_cost_usd?: number }; content?: { text?: string } }[];
    for await (const event of neuralWattEventsWithTelemetry(stream)) events.push(event as never);
    const telemetry = events.filter((event) => event.type === "neuralwatt:telemetry");
    assert.equal(telemetry.length, 1, "cost-only stream yields one telemetry event");
    assert.deepEqual(telemetry[0]?.cost, { request_cost_usd: 0.0009 });
    assert.equal(events.at(-1)?.type, "done");
  });

  it("neuralwatt_non_streaming_telemetry_mapper", () => {
    const mapped = mapNeuralWattTelemetry({
      energy: { energy_joules: 9.5, energy_kwh: 0.0000026, avg_power_watts: 3.2, duration_seconds: 3, attribution_method: "full" },
      cost: { request_cost_usd: 0.00002, cache_savings_usd: 0.0, allowance_remaining_usd: 5, budget_remaining_usd: 95 },
    });
    assert.equal(mapped.energy?.energy_joules, 9.5);
    assert.equal(mapped.energy?.attribution_method, "full");
    assert.equal(mapped.cost?.request_cost_usd, 0.00002);
    assert.equal(mapped.cost?.budget_remaining_usd, 95);
    const empty = mapNeuralWattTelemetry({ choices: [] });
    assert.equal(empty.energy, undefined);
    assert.equal(empty.cost, undefined);
  });

  it("neuralwatt_malformed_telemetry_comment_does_not_crash_generation", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(": energy {not valid json\n\n"));
        controller.enqueue(encoder.encode(": cost\n\n"));
        controller.enqueue(encoder.encode(": unknown {\"x\":1}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = [] as { type: string; content?: { text?: string } }[];
    for await (const event of neuralWattEventsWithTelemetry(stream)) events.push(event as never);
    assert.ok(!events.some((event) => event.type === "error"), "malformed comments must not crash the stream");
    assert.equal(events.some((event) => event.type === "neuralwatt:telemetry"), false, "malformed/unknown comments yield no telemetry");
    assert.equal(events.at(-1)?.type, "done");
    // The standard provider stream also stays defensible through malformed comments.
    assert.equal(parseNeuralWattComment("energy {bad"), undefined);
    assert.equal(parseNeuralWattComment(""), undefined);
  });
});

async function collect(provider: { generate(req: ProviderRequest): AsyncIterable<ProviderEvent> }, req: ProviderRequest): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate(req)) events.push(event);
  return events;
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockJsonFetch(status: number, body: object): typeof fetch {
  return (async () => json(status, body)) as typeof fetch;
}

function mockTextFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

function modelsFixture(): object {
  return {
    object: "list",
    data: [
      {
        id: "alias/glm",
        object: "model",
        owned_by: "neuralwatt",
        max_model_len: 202_752,
        metadata: {
          display_name: "GLM Alias",
          description: "demo",
          provider: "Z.ai",
          huggingface_id: "zai-org/GLM-5.1-FP8",
          pricing: {
            input_per_million: 0.35,
            output_per_million: 1.38,
            cached_input_per_million: 0.0875,
            cached_output_per_million: null,
            currency: "USD",
            pricing_tbd: false,
          },
          capabilities: {
            tools: true,
            json_mode: true,
            vision: true,
            reasoning: true,
            reasoning_effort: true,
            streaming: true,
            system_role: true,
            developer_role: false,
          },
          limits: { max_context_length: 202_752, max_output_tokens: 16_384, max_images: 4 },
          deprecated: false,
          deprecated_message: null,
        },
      },
    ],
  };
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

// Like #sse() but does NOT auto-append [DONE]; lets each test control termination.
function rawSse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
