import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgent, type JsonObject, type ModelConfig, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import {
  assertNoSecretLeak,
  assertRecordedStreamConforms,
  collectProviderEvents,
  providerPackage,
  type RecordedExchange,
  replayFetch,
} from "@arnilo/prism/provider-kit";
import {
  createOllamaCloudProvider,
  listOllamaCloudModels,
  mapOllamaCloudModel,
  ollamaCloudBalance,
  ollamaCloudModels,
  stripJsonFence,
} from "../index.js";

const secret = "sk-ollama-cloud-canary-should-not-surface";
const gemma = ollamaCloudModels.find((model) => model.model === "gemma4:31b")!;
const gptOss = ollamaCloudModels.find((model) => model.model === "gpt-oss:20b")!;
const kimi = ollamaCloudModels.find((model) => model.model === "kimi-k3")!;

function fixture(path: string): RecordedExchange | RecordedExchange[] {
  return JSON.parse(readFileSync(new URL(`./wire/${path}`, import.meta.url), "utf8")) as RecordedExchange | RecordedExchange[];
}

function request(model: ModelConfig = gemma, extra: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model,
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    options: { sessionId: "session-1" },
    ...extra,
  };
}

function ndjson(frames: readonly object[], close = true): ReadableStream<Uint8Array> {
  const body = frames.map((frame) => `${JSON.stringify(frame)}\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      if (close) controller.close();
    },
  });
}

function ok(body: ReadableStream<Uint8Array>, contentType = "application/x-ndjson"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

async function capture(model: ModelConfig, extra: Partial<ProviderRequest> = {}, config = {}) {
  let body: JsonObject = {};
  let captured: Headers | undefined;
  let url = "";
  const provider = createOllamaCloudProvider({
    apiKey: secret,
    ...config,
    fetch: (async (input, init) => {
      url = String(input);
      captured = new Headers(init?.headers);
      body = JSON.parse(String(init?.body)) as JsonObject;
      return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const events = await collectProviderEvents(provider, request(model, extra));
  return { body, headers: captured, url, events };
}

function terminalError(events: readonly ProviderEvent[]) {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  if (terminal?.type !== "error") throw new Error("missing error event");
  return terminal.error as { message: string; failureClass?: string };
}

describe("@arnilo/prism-provider-ollama-cloud native route", () => {
  it("ollama_cloud_native_conformance", async () => {
    const recording = fixture("native/text.json") as RecordedExchange;
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: replayFetch(recording) });
    const events = await assertRecordedStreamConforms({
      provider,
      request: request(),
      recording,
      expect: { text: "Hello from Ollama Cloud.", usage: { inputTokens: 18, outputTokens: 6, totalTokens: 24, cacheReadTokens: 0 } },
    });
    assertNoSecretLeak(events, [secret]);
    assert.equal(events.find((event) => event.type === "usage")?.type, "usage");
  });

  it("ollama_native_usage_maps_cached_count", async () => {
    const recording = fixture("native/cache.json") as RecordedExchange[];
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: replayFetch(recording) });
    const events = await collectProviderEvents(provider, request());
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    assert.equal(done.usage?.inputTokens, 7_338);
    assert.equal(done.usage?.outputTokens, 2);
    assert.equal(done.usage?.cacheReadTokens, 0);
    assert.equal(done.usage?.totalTokens, 7_340);
    assert.deepEqual(done.usage?.metadata, { ollama: { totalDurationNs: 250_000_000 } });
  });

  it("ollama_native_tool_calls_get_stable_ids_and_replay", async () => {
    const recording = fixture("native/tool-loop.json") as RecordedExchange[];
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: replayFetch(recording[0]!) });
    const events = await collectProviderEvents(provider, request(gemma, { tools: [weatherTool()] }));
    const call = events.find((event) => event.type === "tool_call");
    assert.equal(call?.type, "tool_call");
    if (call?.type !== "tool_call") return;
    assert.equal(call.call.id, "call_tn83v5zc");
    assert.equal(call.call.name, "get_weather");
    assert.deepEqual(call.call.arguments, { city: "Paris" });

    const replay = await capture(gemma, {
      tools: [weatherTool()],
      messages: [
        { role: "user", content: [{ type: "text", text: "Call get_weather for Paris." }] },
        { role: "assistant", content: [call.call] },
        {
          role: "tool",
          content: [{ type: "tool_result", toolCallId: "call_tn83v5zc", name: "get_weather", result: { tempC: 18, sky: "clear" } }],
        },
      ],
    });
    const messages = replay.body.messages as JsonObject[];
    const replayedAssistant = messages[1];
    assert.ok(replayedAssistant);
    const replayedCall = (replayedAssistant.tool_calls as JsonObject[])[0];
    assert.equal(replayedCall?.id, undefined, "native replay omits the server id, as measured");
    assert.deepEqual(replayedCall?.function, {
      name: "get_weather",
      arguments: { city: "Paris" },
    });
    assert.equal(messages[2]?.role, "tool");
    assert.equal(messages[2]?.tool_name, "get_weather");
    assert.equal(messages[2]?.tool_call_id, undefined);
  });

  it("ollama_native_replay_uses_wire_tool_names", async () => {
    const tool = { ...weatherTool(), name: "weather.lookup" };
    const { body } = await capture(gemma, {
      tools: [tool],
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: tool.name, arguments: {} }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: tool.name, result: "sunny" }] },
      ],
    });
    const wireName = ((body.tools as JsonObject[])[0]!.function as JsonObject).name;
    assert.notEqual(wireName, tool.name);
    const messages = body.messages as JsonObject[];
    assert.equal(((messages[0]!.tool_calls as JsonObject[])[0]!.function as JsonObject).name, wireName);
    assert.equal(messages[1]?.tool_name, wireName);
  });

  it("ollama_native_early_done_cancels_stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"done":true}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: (async () => ok(body)) as typeof fetch });
    await collectProviderEvents(provider, request());
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  });

  it("ollama_native_missing_done_is_error", async () => {
    const body = ndjson([{ model: gemma.model, message: { role: "assistant", content: "partial" }, done: false }]);
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: (async () => ok(body)) as typeof fetch });
    const error = terminalError(await collectProviderEvents(provider, request()));
    assert.match(error.message, /without a done frame/);
  });

  it("ollama_native_line_bound_enforced", async () => {
    const huge = JSON.stringify({ model: gemma.model, message: { content: "x".repeat(1_048_600) }, done: false });
    const provider = createOllamaCloudProvider({
      apiKey: secret,
      fetch: (async () => new Response(`${huge}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } })) as typeof fetch,
    });
    const error = terminalError(await collectProviderEvents(provider, request()));
    assert.match(error.message, /NDJSON line exceeded/);
  });

  it("ollama_native_structured_output_buffer_is_bounded", async () => {
    const body = ndjson(Array.from({ length: 3 }, () => ({ message: { content: "x".repeat(262_144) }, done: false })));
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: (async () => ok(body)) as typeof fetch });
    const error = terminalError(
      await collectProviderEvents(
        provider,
        request(gemma, {
          options: { structuredOutput: { name: "bounded", schema: { type: "object" } } },
        }),
      ),
    );
    assert.match(error.message, /structured output exceeded/);
  });

  it("ollama_native_structured_output_strips_measured_fence", async () => {
    const recording = fixture("native/structured-output.json") as RecordedExchange;
    const structured = { ...gemma, capabilities: { ...gemma.capabilities, structuredOutput: "json_schema" as const } };
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: replayFetch(recording) });
    const events = await collectProviderEvents(
      provider,
      request(structured, {
        options: {
          sessionId: "session-1",
          structuredOutput: { name: "city", schema: { type: "object", properties: { city: { type: "string" } } } },
        },
      }),
    );
    const text = events
      .map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : ""))
      .join("");
    assert.deepEqual(JSON.parse(text), { city: "Tokyo", population: 37_435_191 });
    assert.equal(stripJsonFence('```json\n{"ok":true}\n```'), '{"ok":true}');
  });

  it("ollama_native_images_are_base64_only", async () => {
    const recording = fixture("native/image.json") as RecordedExchange;
    const provider = createOllamaCloudProvider({ apiKey: secret, fetch: replayFetch(recording) });
    const events = await collectProviderEvents(
      provider,
      request(gemma, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe the image in one word." },
              { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
            ],
          },
        ],
      }),
    );
    assert.equal(events.at(-1)?.type, "done");
  });
});

describe("@arnilo/prism-provider-ollama-cloud routes and options", () => {
  it("ollama_compat_omits_tool_choice_and_cache_fields", async () => {
    const compat: ModelConfig = { ...gemma, compat: { ...gemma.compat, route: "openai" } };
    const result = await capture(compat, {
      tools: [weatherTool()],
      options: {
        sessionId: "session-1",
        cacheKey: "cache-key-1",
        cache: { breakpoints: [{ location: "system_prompt" }] },
        compat: { reasoning_effort: "high" },
      },
    });
    assert.match(result.url, /\/v1\/chat\/completions$/);
    assert.equal(result.body.tool_choice, undefined);
    assert.equal(result.body.cache_control, undefined);
    assert.equal(result.body.prompt_cache_key, undefined);
    assert.equal(result.body.reasoning_effort, "high");
    assert.equal(result.headers?.get("authorization"), `Bearer ${secret}`);
  });

  it("ollama_openai_route_strips_json_fence_for_structured_output", async () => {
    const compat: ModelConfig = { ...gemma, compat: { ...gemma.compat, route: "openai" } };
    const sse = (chunks: readonly string[]) =>
      new Response(`${chunks.map((chunk) => `data: ${chunk}\n\n`).join("")}data: [DONE]\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    const frame = (content: string) => JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] });
    const provider = createOllamaCloudProvider({
      apiKey: secret,
      fetch: (async () =>
        sse([
          frame("```json\n"),
          frame('{"ok":true}'),
          frame("\n```"),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        ])) as typeof fetch,
    });
    const events = await collectProviderEvents(
      provider,
      request(compat, { options: { sessionId: "s", structuredOutput: { name: "probe", schema: { type: "object" } } } }),
    );
    const text = events
      .map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : ""))
      .join("");
    assert.equal(text, '{"ok":true}', "structured text must arrive without the fence");
    assert.equal(events.at(-1)?.type, "done");
  });

  it("ollama_thinking_map", async () => {
    const gemmaLow = await capture(gemma, { options: { sessionId: "s", compat: { reasoning_effort: "low" } } });
    assert.equal(gemmaLow.body.think, true);
    const gemmaNone = await capture(gemma, { options: { sessionId: "s", compat: { reasoning_effort: "none" } } });
    assert.equal(gemmaNone.body.think, false);
    const gptLow = await capture(gptOss, { options: { sessionId: "s", compat: { reasoning_effort: "low" } } });
    assert.equal(gptLow.body.think, "low");
    const gptMax = await capture(gptOss, { options: { sessionId: "s", compat: { reasoning_effort: "max" } } });
    assert.equal(gptMax.body.think, "high", "undeclared max snaps to the highest named level");
    const kimiMax = await capture(kimi, { options: { sessionId: "s", compat: { reasoning_effort: "max" } } });
    assert.equal(kimiMax.body.think, "max");
    const unset = await capture(gptOss);
    assert.equal(unset.body.think, undefined, "no request leaves the model default alone");
  });

  it("ollama_error_mapping", async () => {
    const cases: readonly [number, string, string][] = [
      [401, '{"error":"Unauthorized"}', "auth"],
      [404, '{"error":"model \'gone\' not found"}', "permanent"],
      [429, '{"error":"slow down"}', "rate_limited"],
      [429, '{"error":"weekly limit reached for this plan"}', "quota"],
    ];
    for (const [status, bodyText, expected] of cases) {
      const provider = createOllamaCloudProvider({
        apiKey: secret,
        fetch: (async () => new Response(bodyText, { status, headers: { "content-type": "application/json" } })) as typeof fetch,
      });
      const error = terminalError(await collectProviderEvents(provider, request()));
      assert.equal(error.failureClass, expected, `${status} ${bodyText}`);
      assert.equal(error.message.includes(secret), false);
    }
    const notFoundProvider = createOllamaCloudProvider({
      apiKey: secret,
      fetch: (async () => new Response('{"error":"model \'gone\' not found"}', { status: 404 })) as typeof fetch,
    });
    assert.match(terminalError(await collectProviderEvents(notFoundProvider, request())).message, /\/api\/tags/);
  });

  it("ollama_cloud_overflow_classified_and_recovered", async () => {
    const overflow: RecordedExchange = {
      path: "/api/chat",
      status: 400,
      contentType: "application/json",
      responseBody: '{"error":"prompt too long; exceeded max context length by 28996 tokens (ref: 2497bd9e-fdfc-4b65-b909-0e9b8d0d5b5c)"}',
    };
    const provider = createOllamaCloudProvider({
      apiKey: secret,
      fetch: (async () =>
        new Response(overflow.responseBody, { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    assert.equal(terminalError(await collectProviderEvents(provider, request())).failureClass, "context_overflow");

    let calls = 0;
    const replay = replayFetch([
      overflow,
      {
        path: "/api/chat",
        status: 200,
        contentType: "application/x-ndjson",
        responseBody: `${JSON.stringify({
          model: gemma.model,
          message: { role: "assistant", content: "ok" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 100,
          eval_count: 2,
        })}\n`,
      },
    ]);
    const recovering = createOllamaCloudProvider({
      apiKey: secret,
      fetch: (async (input, init) => {
        calls++;
        return replay(input, init);
      }) as typeof fetch,
    });
    const agent = await createAgent({
      model: { provider: "ollama-cloud", model: gemma.model, limits: { contextWindow: 2_000, maxOutputTokens: 100 } },
      packages: [providerPackage("test-ollama-cloud", [recovering])],
      compaction: { keepRecentEntries: 1 },
    });
    try {
      const session = await agent.session();
      const result = await session.run("a long request");
      assert.equal(result.status, "completed");
      assert.equal(calls, 2);
      assert.equal((await session.entries()).filter((entry) => entry.kind === "compaction").length, 1);
    } finally {
      await agent.dispose();
    }
  });
});

describe("@arnilo/prism-provider-ollama-cloud discovery and balance", () => {
  it("ollama_cloud_catalog_declares_context_windows", () => {
    assert.ok(ollamaCloudModels.every((model) => typeof model.limits?.contextWindow === "number"));
    assert.equal(gemma.limits?.contextWindow, 262_144);
    assert.equal(mapOllamaCloudModel({ model: "no-window", capabilities: ["completion"] }).limits?.contextWindow, undefined);
    const mapped = mapOllamaCloudModel(
      { model: "mapped", capabilities: ["completion", "vision", "tools", "thinking"] },
      { model_info: { "family.context_length": 123_456 }, thinking: { values: ["low", "high"] } },
    );
    assert.equal(mapped.limits?.contextWindow, 123_456);
    assert.deepEqual(mapped.capabilities?.input, ["text", "image"]);
    assert.deepEqual(mapped.capabilities?.thinkingLevels, ["none", "low", "high"]);
    assert.equal(mapped.capabilities?.structuredOutput, "json_schema");
  });

  it("list_ollama_cloud_models_bounded_concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const urls: string[] = [];
    const entries = Array.from({ length: 10 }, (_, index) => ({ model: `model-${index}`, capabilities: ["completion"] }));
    const models = await listOllamaCloudModels({
      apiKey: "test-key",
      fetch: (async (input) => {
        urls.push(String(input));
        if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: entries }));
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return new Response(JSON.stringify({ model_info: { "x.context_length": 4096 }, capabilities: ["completion"] }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    assert.equal(models.length, 10);
    assert.equal(urls.filter((url) => url.endsWith("/api/tags")).length, 1);
    assert.equal(urls.filter((url) => url.endsWith("/api/show")).length, 10);
    assert.ok(maxActive <= 4, `max concurrent show requests was ${maxActive}`);
  });

  it("ollama_cloud_balance_parses_and_hides_key", async () => {
    const balance = await ollamaCloudBalance({
      apiKey: secret,
      fetch: (async () =>
        new Response(
          JSON.stringify({
            included: {
              session: { remaining_percent: 97.08, resets_at: "2026-11-01T08:00:00Z" },
              weekly: { remaining_percent: 98.92, resets_at: "2026-11-02T00:00:00Z" },
            },
            purchased: { balance_usd: 0 },
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    assert.deepEqual(balance, {
      session: { remainingPercent: 97.08, resetsAt: "2026-11-01T08:00:00Z" },
      weekly: { remainingPercent: 98.92, resetsAt: "2026-11-02T00:00:00Z" },
      purchasedUsd: 0,
    });
    await assert.rejects(
      () =>
        ollamaCloudBalance({
          apiKey: secret,
          fetch: (async () => new Response(`{"error":"bad key ${secret}"}`, { status: 401 })) as typeof fetch,
        }),
      (error: Error) => !error.message.includes(secret),
    );
  });
});

function weatherTool() {
  return {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: { type: "object" as const, properties: { city: { type: "string" } }, required: ["city"] },
    execute: () => ({ toolCallId: "call_1", name: "get_weather", content: [] }),
  };
}
