import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, Message, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import {
  OPENCODE_GO_DEFAULT_BASE_URL,
  createOpenCodeGoProvider,
  createOpenCodeGoProviderPackage,
  listOpenCodeGoModels,
  defineOpenCodeGoModel,
  mapOpenCodeGoModel,
  openCodeGoModels,
  routeForOpenCodeGoModel,
} from "../index.js";

const openaiModel: ModelConfig = {
  provider: "opencode-go",
  model: "kimi-k3",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true, reasoning_effort: "max" },
  cache: { kind: "implicit" },
};

const anthropicModel: ModelConfig = {
  provider: "opencode-go",
  model: "minimax-m3",
  capabilities: { input: ["text", "document", "file"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "anthropic", preserveThinking: true },
  cache: { kind: "cache_control", longRetention: true },
};

const baseRequest: ProviderRequest = {
  model: openaiModel,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session with spaces" },
};

describe("@arnilo/prism-provider-opencode-go", () => {
  it("opencode_go_registers_official_featured_models_and_setup_does_not_fetch", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert.equal(fetchCalls, 0);
    assert(registered.some((item: any) => item.id === "opencode-go"));
    assert(registered.some((item: any) => item.provider === "opencode-go" && item.kind === "api_key"));
    const models = registered.filter((item: any): item is ModelConfig => typeof item?.model === "string" && item.provider === "opencode-go");
    assert.ok(models.length >= 15, `expected featured Go catalog, got ${models.length}`);
    assert(models.some((m) => m.model === "kimi-k3" && m.compat?.route === "openai"));
    assert(models.some((m) => m.model === "minimax-m3" && m.compat?.route === "anthropic"));
    assert(models.some((m) => m.model === "qwen3.7-max" && m.compat?.route === "anthropic"));
    assert(models.some((m) => m.model === "glm-5.2" && m.compat?.route === "openai"));
    assert(!models.some((m) => m.model === "gpt-5.1-go" || m.model === "claude-sonnet-4.5-go"));
    assert.equal(OPENCODE_GO_DEFAULT_BASE_URL, "https://opencode.ai/zen/go/v1");
    assert.equal(routeForOpenCodeGoModel("minimax-m2.7"), "anthropic");
    assert.equal(routeForOpenCodeGoModel("qwen3.6-plus"), "anthropic");
    assert.equal(routeForOpenCodeGoModel("deepseek-v4-flash"), "openai");
    assert.ok(openCodeGoModels.every((m) => m.compat?.route === "openai" || m.compat?.route === "anthropic"));
  });

  it("opencode_go_defaults_to_official_zen_go_v1_base_url", async () => {
    let url = "";
    const provider = createOpenCodeGoProvider({
      apiKey: "fake-opencode-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(url, "https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("opencode_go_openai_route_streams_text_thinking_tool_calls", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: mockFetch(sse([
      { choices: [{ delta: { content: "hi", reasoning_content: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 } } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("opencode_go_anthropic_route_streams_text_thinking_tool_calls_and_usage", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: mockFetch(sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "plan" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"y\"}" } },
      { type: "message_delta", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
    ])) });
    const request = { ...baseRequest, model: anthropicModel };
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "plan"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "y" } }]);
  });

  it("opencode_go_openai_route_preserves_reasoning_content_and_per_turn_effort", async () => {
    let body: any;
    let url = "";
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const replay: ProviderRequest = {
      model: openaiModel,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "plan the lookup" },
            { type: "text", text: "calling" },
            { type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } },
          ],
        },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
      options: { compat: { reasoning_effort: "high", preserveThinking: true } },
    };
    await assertProviderStreamConforms({ provider, request: replay });
    assert.equal(url.endsWith("/chat/completions"), true);
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.preserveThinking, undefined);
    assert.equal(body.route, undefined);
    const assistant = body.messages.find((m: any) => m.role === "assistant");
    assert.equal(assistant.reasoning_content, "plan the lookup");
    assert.equal(assistant.content, "calling");
    assert.ok(!JSON.stringify(assistant.content).includes("plan the lookup"));
  });

  it("opencode_go_openai_route_drops_thinking_without_flattening_when_preserve_disabled", async () => {
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({
      provider,
      request: {
        model: { ...openaiModel, compat: { route: "openai", preserveThinking: false } },
        messages: [{
          role: "assistant",
          content: [
            { type: "thinking", text: "secret plan" },
            { type: "text", text: "visible" },
            { type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } },
          ],
        }],
        options: { compat: { preserveThinking: false } },
      },
    });
    const assistant = body.messages[0];
    assert.equal(assistant.reasoning_content, undefined);
    assert.equal(assistant.content, "visible");
    assert.ok(!JSON.stringify(assistant).includes("secret plan"));
  });

  it("opencode_go_anthropic_route_preserves_thinking_blocks", async () => {
    let body: any;
    let url = "";
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({
      provider,
      request: {
        model: anthropicModel,
        messages: [{
          role: "assistant",
          content: [
            { type: "thinking", text: "reason", signature: "sig" },
            { type: "text", text: "ok" },
            { type: "tool_call", id: "tool_1", name: "lookup", arguments: { q: "y" } },
          ],
        }],
      },
    });
    assert.equal(url.endsWith("/messages"), true);
    const assistant = body.messages.find((m: any) => m.role === "assistant");
    assert.deepEqual(assistant.content[0], { type: "thinking", thinking: "reason", signature: "sig" });
    assert.equal(body.preserveThinking, undefined);
    assert.equal(body.route, undefined);
  });

  it("opencode_go_session_id_prefers_cacheKey_over_sessionId_and_sanitizes", async () => {
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...baseRequest, options: { ...baseRequest.options, cacheKey: "repo#prefix/run-1", sessionId: "should-not-win" } } });
    assert.equal(headers.get("x-opencode-session"), "repo-prefix-run-1");
    let headers2 = new Headers();
    const provider2 = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_input, init) => {
      headers2 = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider: provider2, request: baseRequest });
    assert.equal(headers2.get("x-opencode-session"), "session-with-spaces");
  });

  it("opencode_go_anthropic_route_applies_cache_control_only_to_selected_breakpoints", async () => {
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "current turn" }] },
    ];
    const request = {
      ...baseRequest,
      model: anthropicModel,
      messages,
      options: { cacheKey: "sess", cache: { breakpoints: [{ location: "last_stable_message" as const }] } },
    };
    await assertProviderStreamConforms({ provider, request });
    assert.deepEqual(body.messages.find((m: any) => m.role === "assistant").content.at(-1).cache_control, { type: "ephemeral" });
    const others = body.messages.filter((m: any) => m.role !== "assistant");
    for (const m of others) for (const block of m.content) assert.equal(block.cache_control, undefined);
  });

  it("opencode_go_anthropic_route_long_retention_emits_1h_ttl", async () => {
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "current turn" }] },
    ];
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      model: anthropicModel,
      messages,
      options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } },
    } });
    assert.deepEqual(body.messages.find((m: any) => m.role === "assistant").content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
  });

  it("opencode_go_anthropic_route_no_breakpoints_emits_no_cache_control", async () => {
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      model: anthropicModel,
      options: { cacheKey: "sess" },
    } });
    for (const m of body.messages) for (const block of m.content) assert.equal(block.cache_control, undefined);
  });

  it("opencode_go_anthropic_route_serializes_pdf_document_blocks", async () => {
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const replay: ProviderRequest = {
      model: anthropicModel,
      messages: [{
        role: "user",
        content: [
          { type: "document", mediaType: "application/pdf", name: "brief.pdf", data: tinyPdf },
          { type: "file", mediaType: "application/pdf", name: "report.pdf", data: tinyPdf },
        ],
      }],
    };
    let body: unknown;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
    const serialized = JSON.stringify(body);
    assert.match(serialized, /"type":"document"/);
    assert.match(serialized, /brief\.pdf/);
  });

  it("opencode_go_openai_route_never_receives_anthropic_cache_control", async () => {
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      model: { ...openaiModel, cache: { kind: "cache_control" as const } },
      options: { cacheKey: "sess", cache: { breakpoints: [{ location: "last_stable_message" }] } },
    } });
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("cache_control"), "OpenAI route body must not contain cache_control");
  });

  it("opencode_go_openai_route_rejects_document_blocks", async () => {
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      ...baseRequest,
      messages: [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: tinyPdf }] }],
    })) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } })?.error?.message ?? events.at(-1)), /document/);
  });

  it("opencode_go_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      options: {
        ...baseRequest.options,
        headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-opencode-session": "attacker-session", "x-caller": "kept" },
      },
    } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-opencode-key", "content-type": "application/json", "x-opencode-session": "session-with-spaces" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-opencode-session": "attacker-session", "x-caller": "kept" },
    });
  });

  it("opencode_go_structured_output_capability_requires_per_model_verification", async () => {
    const featured = (id: string) => openCodeGoModels.find((m) => m.model === id)!;
    // Verified models keep native JSON Schema structured output.
    assert.equal(featured("mimo-v2.5").capabilities?.structuredOutput, "json_schema");
    assert.equal(featured("mimo-v2.5-pro").capabilities?.structuredOutput, "json_schema");
    // Unverified OpenAI-route models do not — route alone never implies support.
    assert.equal(featured("deepseek-v4-pro").capabilities?.structuredOutput, undefined);
    assert.equal(featured("deepseek-v4-flash").capabilities?.structuredOutput, undefined);
    assert.equal(featured("deepseek-v4-pro").compat?.route, "openai");
    // Live-discovered unknown OpenAI-route model defaults to undefined.
    assert.equal(mapOpenCodeGoModel({ id: "future-model-1" }).capabilities?.structuredOutput, undefined);
    // Caller-explicit capability still wins over the verified-set default.
    const explicit = defineOpenCodeGoModel({
      model: "deepseek-v4-pro",
      capabilities: { structuredOutput: "json_schema" },
      limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
    });
    assert.equal(explicit.capabilities?.structuredOutput, "json_schema");
    assert.equal(explicit.compat?.route, "openai");
  });

  it("opencode_go_discovery_capability_fields_override_static_verified_set", () => {
    // Gateway-authoritative positive: payload capability grants json_schema to
    // an unverified featured model (forward-compatible with future payloads).
    assert.equal(
      mapOpenCodeGoModel({ id: "deepseek-v4-pro", capabilities: { structured_output: "json_schema" } })
        .capabilities?.structuredOutput,
      "json_schema",
    );
    assert.equal(
      mapOpenCodeGoModel({ id: "future-model-1", capabilities: { structured_output: true } })
        .capabilities?.structuredOutput,
      "json_schema",
    );
    // Gateway-authoritative negative: explicit false overrides the static set.
    assert.equal(
      mapOpenCodeGoModel({ id: "mimo-v2.5", capabilities: { structured_output: false } })
        .capabilities?.structuredOutput,
      undefined,
    );
    // Sparse payload (today's shape) still falls back to the static verified set.
    assert.equal(mapOpenCodeGoModel({ id: "mimo-v2.5" }).capabilities?.structuredOutput, "json_schema");
    assert.equal(mapOpenCodeGoModel({ id: "deepseek-v4-pro" }).capabilities?.structuredOutput, undefined);
  });

  it("opencode_go_deepseek_rejects_structured_output_before_dispatch_and_omits_response_format", async () => {
    const deepseek = openCodeGoModels.find((m) => m.model === "deepseek-v4-pro")!;
    let fetchCalls = 0;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({
      ...baseRequest,
      model: deepseek,
      options: { ...baseRequest.options, structuredOutput: { name: "artifact", schema: { type: "object" } } },
    })) events.push(event);
    assert.equal(fetchCalls, 0);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } }).error?.message), /structuredOutput/);

    // Plain request serializes without response_format.
    let body: any;
    const plain = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider: plain, request: { ...baseRequest, model: deepseek } });
    assert.equal(body.response_format, undefined);
  });

  it("opencode_go_verified_mimo_serializes_response_format", async () => {
    const mimo = openCodeGoModels.find((m) => m.model === "mimo-v2.5")!;
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      model: mimo,
      options: { ...baseRequest.options, structuredOutput: { name: "artifact", schema: { type: "object" } } },
    } });
    assert.equal(body.response_format?.type, "json_schema");
    assert.equal(body.response_format?.json_schema?.name, "artifact");
  });

  it("opencode_go_openai_route_fails_truncated_stream_without_done_or_finish_reason", async () => {
    // Bug report repro: 36 chunks, no finish_reason, no usage, connection closed.
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sseRaw([
      ...Array.from({ length: 36 }, () => ({ choices: [{ delta: { content: "partial " } }] })),
    ]))) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(events.at(-1)?.type, "error");
    assert(!events.some((e) => e.type === "done"));
    assert.match(String((events.at(-1) as { error?: { message?: string } }).error?.message), /completion evidence/);
  });

  it("opencode_go_openai_route_fails_done_marker_without_finish_reason", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sse([
      { choices: [{ delta: { content: "partial " } }] },
    ]))) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(events.at(-1)?.type, "error");
    assert(!events.some((e) => e.type === "done"));
  });

  it("opencode_go_openai_route_fails_dangling_tool_call_and_succeeds_when_complete", async () => {
    const dangling = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "lookup", arguments: "{" } }] } }] },
      { choices: [{ finish_reason: "tool_calls", delta: {} }] },
    ]))) as typeof fetch });
    const danglingEvents = await assertProviderStreamConforms({ provider: dangling, request: baseRequest });
    assert.equal(danglingEvents.at(-1)?.type, "error");

    const complete = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"x\"}" } }] } }] },
      { choices: [{ finish_reason: "tool_calls", delta: {} }] },
    ]))) as typeof fetch });
    const completeEvents = await assertProviderStreamConforms({ provider: complete, request: baseRequest });
    assert.equal(completeEvents.at(-1)?.type, "done");
    assert(completeEvents.some((e) => e.type === "tool_call"));
  });

  it("opencode_go_anthropic_route_fails_stream_without_message_stop", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sseRaw([
      { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
    ]))) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: anthropicModel } });
    assert.equal(events.at(-1)?.type, "error");
    assert(!events.some((e) => e.type === "done"));
    assert.match(String((events.at(-1) as { error?: { message?: string } }).error?.message), /message_stop/);
  });

  it("opencode_go_anthropic_route_fails_unclosed_tool_block_and_succeeds_when_complete", async () => {
    const unclosed = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sseRaw([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":" } },
      { type: "message_stop" },
    ]))) as typeof fetch });
    const unclosedEvents = await assertProviderStreamConforms({ provider: unclosed, request: { ...baseRequest, model: anthropicModel } });
    assert.equal(unclosedEvents.at(-1)?.type, "error");

    const complete = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => ok(sseRaw([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "lookup" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"x\"}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ]))) as typeof fetch });
    const completeEvents = await assertProviderStreamConforms({ provider: complete, request: { ...baseRequest, model: anthropicModel } });
    assert.equal(completeEvents.at(-1)?.type, "done");
    assert(completeEvents.some((e) => e.type === "tool_call"));
  });

  it("opencode_go_anthropic_route_sends_provider_owned_anthropic_auth_headers", async () => {
    let url = "";
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: anthropicModel } });
    assert.equal(url.endsWith("/messages"), true);
    assert.equal(headers.get("authorization"), "Bearer fake-opencode-key");
    assert.equal(headers.get("x-api-key"), "fake-opencode-key");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
  });

  it("opencode_go_anthropic_route_caller_headers_cannot_override_anthropic_auth", async () => {
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...baseRequest,
      model: anthropicModel,
      options: {
        ...baseRequest.options,
        headers: { authorization: "Bearer attacker", "x-api-key": "attacker-key", "anthropic-version": "1999-01-01", "x-caller": "kept" },
      },
    } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-opencode-key", "x-api-key": "fake-opencode-key", "anthropic-version": "2023-06-01" },
      caller: { authorization: "Bearer attacker", "x-api-key": "attacker-key", "anthropic-version": "1999-01-01", "x-caller": "kept" },
    });
  });

  it("opencode_go_openai_route_sends_no_anthropic_only_headers", async () => {
    let headers = new Headers();
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(headers.get("anthropic-version"), null);
  });

  it("opencode_go_anthropic_route_error_redacts_key_from_both_auth_headers", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "canary-opencode-key", fetch: (async () => new Response("unauthorized canary-opencode-key", { status: 401 })) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate({ ...baseRequest, model: anthropicModel })) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("canary-opencode-key"));
  });

  it("opencode_go_openai_route_serializes_max_tokens_and_temperature", async () => {
    let url = "";
    let headers = new Headers();
    let body: any;
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...baseRequest, model: { ...baseRequest.model, parameters: { maxTokens: 111, temperature: 0.1 } } } });
    assert.equal(url.endsWith("/chat/completions"), true);
    assert.equal(body.max_tokens, 111);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.1);
    assert.equal(headers.get("x-opencode-session"), "session-with-spaces");
    assert.equal(headers.get("authorization"), "Bearer fake-opencode-key");
  });

  it("opencode_go_openai_and_anthropic_routes_cover_tool_result_replay", async () => {
    const replayOpenAI: ProviderRequest = {
      model: openaiModel,
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
      model: anthropicModel,
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
    await assertProviderStreamConforms({ provider: anthropic, request: { ...replayAnthropic, model: { ...replayAnthropic.model, parameters: { maxTokens: 222 } } } });
    assertSerializedRequestCoversContent(replayAnthropic, bodyAnthropic);
    assert.equal((bodyAnthropic as any).max_tokens, 222);
    assert.equal((bodyAnthropic as any).maxTokens, undefined);
  });

  it("opencode_go_redacts_api_key_from_errors", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: "fake-opencode-key", fetch: (async () => new Response("bad fake-opencode-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request: baseRequest });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-opencode-key"));
  });

  it("list_opencode_go_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let headers = new Headers();
    let method = "";
    const signal = AbortSignal.timeout(5_000);
    const models = await listOpenCodeGoModels({
      apiKey: "fake-opencode-key",
      baseUrl: "https://opencode.example/zen/go/v1/",
      signal,
      fetch: (async (input, init) => {
        url = String(input);
        method = String(init?.method ?? "GET");
        headers = new Headers(init?.headers);
        assert.equal(init?.signal, signal);
        return Response.json({
          object: "list",
          data: [
            { id: "kimi-k3", object: "model", owned_by: "opencode" },
            { id: "minimax-m3", object: "model", owned_by: "opencode" },
            { id: "hy3-preview", object: "model", owned_by: "opencode" },
          ],
        });
      }) as typeof fetch,
    });

    assert.equal(method, "GET");
    assert.equal(url, "https://opencode.example/zen/go/v1/models");
    assert.equal(headers.get("authorization"), "Bearer fake-opencode-key");
    assert.equal(models.length, 3);

    const kimi = models[0]!;
    assert.equal(kimi.provider, "opencode-go");
    assert.equal(kimi.model, "kimi-k3");
    assert.equal(kimi.compat?.route, "openai");
    assert.equal(kimi.cache?.kind, "implicit");
    assert.equal(kimi.compat?.preserveThinking, true);
    assert.equal(kimi.compat?.reasoning_effort, "max");
    assert.equal(kimi.cost?.input, 3);

    const minimax = models[1]!;
    assert.equal(minimax.compat?.route, "anthropic");
    assert.equal(minimax.cache?.kind, "cache_control");
    assert.equal(minimax.cache?.longRetention, true);

    const preview = models[2]!;
    assert.equal(preview.model, "hy3-preview");
    assert.equal(preview.compat?.route, "openai");
    assert.equal(preview.cache?.kind, "implicit");
  });

  it("list_opencode_go_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listOpenCodeGoModels({
        apiKey: "fake-opencode-key",
        fetch: (async () => new Response("unauthorized fake-opencode-key", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.ok(!message.includes("fake-opencode-key"));
        assert.match(message, /OpenCode Go model discovery failed: 401/);
        return true;
      },
    );
  });

  it("map_opencode_go_model_rejects_malformed_entry", () => {
    assert.throws(() => mapOpenCodeGoModel({ id: "" } as any), /missing id/);
    assert.throws(() => mapOpenCodeGoModel(undefined as any), /missing id/);
  });

  it("opencode_go_provider_package_accepts_models_override", async () => {
    const custom: ModelConfig = { provider: "opencode-go", model: "custom-go", compat: { route: "openai" } };
    const registered: ModelConfig[] = [];
    await createOpenCodeGoProviderPackage({ apiKey: "fake", models: [custom] }).setup({
      registerProvider() {},
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod() {},
    } as any);
    assert.deepEqual(registered.map((m) => m.model), ["custom-go"]);
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

function sseRaw(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
