import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertProviderStreamConforms, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import {
  createOllamaProvider,
  createOllamaProviderPackage,
  defineOllamaModel,
  listOllamaModels,
  mapOllamaModel,
  ollamaBaseUrl,
  ollamaBody,
} from "../index.js";

const model = defineOllamaModel({
  model: "gpt-oss:20b",
  displayName: "GPT-OSS 20B",
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

describe("@arnilo/prism-provider-ollama", () => {
  it("base_url_resolver_covers_cloud_local_and_explicit_override", () => {
    assert.equal(ollamaBaseUrl(), "https://ollama.com/v1");
    assert.equal(ollamaBaseUrl({ preset: "cloud" }), "https://ollama.com/v1");
    assert.equal(ollamaBaseUrl({ preset: "local" }), "http://localhost:11434/v1");
    assert.equal(ollamaBaseUrl({ baseUrl: "http://192.168.1.10:11434/v1/" }), "http://192.168.1.10:11434/v1");
    assert.equal(ollamaBaseUrl({ preset: "local", baseUrl: "https://override.test/v1" }), "https://override.test/v1");
  });

  it("request_shape_is_openai_chat_completions_with_bearer_usage_tools_and_reasoning_effort", async () => {
    let url = "";
    let headers: Headers | undefined;
    let body: any;
    const provider = createOllamaProvider({
      apiKey: "ollama-cloud-secret",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return ok(chatSse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(url, "https://ollama.com/v1/chat/completions");
    assert.equal(headers?.get("authorization"), "Bearer ollama-cloud-secret");
    assert.equal(headers?.get("content-type"), "application/json");
    assert.equal(body.model, "gpt-oss:20b");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.max_tokens, 8_192);
    assert.deepEqual(body.tools[0], { type: "function", function: { name: "lookup", parameters: { type: "object" } } });
    // reasoning_effort omitted unless explicitly a string.
    assert.equal(body.reasoning_effort, undefined);
  });

  it("local_preset_omits_authorization_when_no_api_key", async () => {
    let headers: Headers | undefined;
    const provider = createOllamaProvider({
      preset: "local",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return ok(chatSse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(headers?.get("authorization"), null);
  });

  it("reasoning_effort_passthrough_request_overrides_model_default", () => {
    const reasoningModel = defineOllamaModel({ model: "gpt-oss:20b", compat: { reasoning_effort: "low" } });
    const base = ollamaBody({ model: reasoningModel, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    assert.equal(base.reasoning_effort, "low");
    const override = ollamaBody({
      model: reasoningModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { compat: { reasoning_effort: "high" } },
    });
    assert.equal(override.reasoning_effort, "high");
    // Provider-owned compat keys are stripped from the opaque spread.
    assert.equal((override as any).route, undefined);
    assert.equal((override as any).ollama, undefined);
  });

  it("stream_maps_text_reasoning_tool_calls_and_usage", async () => {
    const provider = createOllamaProvider({
      apiKey: "ollama-cloud-secret",
      fetch: mockFetch(
        chatSse([
          { choices: [{ delta: { reasoning_content: "think" } }] },
          { choices: [{ delta: { content: "hello" } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "tool_1", function: { name: "lookup", arguments: '{"q":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: "tool_calls" }] },
          { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } },
        ]),
      ),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3 } },
    });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("usage_maps_prompt_and_completion_tokens_and_leaves_cache_read_undefined", async () => {
    const provider = createOllamaProvider({
      apiKey: "ollama-cloud-secret",
      fetch: mockFetch(
        chatSse([
          { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
          { usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } },
        ]),
      ),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "ok", usage: { inputTokens: 100, outputTokens: 5 } },
    });
    const usage = events.find((event) => event.type === "usage") as { usage?: { cacheReadTokens?: number } } | undefined;
    // Ollama exposes no cached-token count — cacheReadTokens stays undefined (documented ceiling).
    assert.equal(usage?.usage?.cacheReadTokens, undefined);
  });

  it("truncated_stream_without_done_fails_loudly", async () => {
    const text = [`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`].join("");
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
    const provider = createOllamaProvider({ apiKey: "x", fetch: (async () => new Response(stream, { status: 200 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
  });

  it("http_error_maps_to_provider_error_and_redacts_api_key", async () => {
    const provider = createOllamaProvider({
      apiKey: "ollama-cloud-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key ollama-cloud-secret", type: "invalid_request_error" } }), {
          status: 401,
        })) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "error");
    const message = (terminal as any).error?.message ?? String((terminal as any).message ?? "");
    assert.ok(!message.includes("ollama-cloud-secret"), `error must redact api key: ${message}`);
    assert.ok(message.includes("401"), "error must surface status");
  });

  it("map_ollama_model_infers_capabilities_from_id", () => {
    const reasoning = mapOllamaModel({ id: "deepseek-r1:latest", owned_by: "library", created: 1 });
    assert.equal(reasoning.capabilities?.reasoning, true);
    const vision = mapOllamaModel({ id: "llava:13b" });
    assert.deepEqual(vision.capabilities?.input, ["text", "image"]);
    const plain = mapOllamaModel({ id: "llama3.2:3b" });
    assert.equal(plain.provider, "ollama");
    assert.equal(plain.capabilities?.tools, true);
    assert.equal(plain.capabilities?.reasoning, false);
    assert.throws(() => mapOllamaModel({ id: "" }), /missing id/);
  });

  it("list_ollama_models_discovers_dynamically_with_auth_and_baseurl", async () => {
    let url = "";
    let headers: Headers | undefined;
    const models = await listOllamaModels({
      apiKey: "ollama-cloud-secret",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return new Response(
          JSON.stringify({ object: "list", data: [{ id: "gpt-oss:20b", owned_by: "library", created: 1 }, { id: "llama3.2:3b" }] }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(url, "https://ollama.com/v1/models");
    assert.equal(headers?.get("authorization"), "Bearer ollama-cloud-secret");
    assert.deepEqual(
      models.map((m) => m.model),
      ["gpt-oss:20b", "llama3.2:3b"],
    );
    assert.equal(models[0]?.provider, "ollama");
  });

  it("list_ollama_models_redacts_api_key_from_discovery_errors", async () => {
    await assert.rejects(
      () =>
        listOllamaModels({
          apiKey: "ollama-cloud-secret",
          fetch: (async () => new Response("upstream said ollama-cloud-secret is invalid", { status: 401 })) as typeof fetch,
        }),
      (error: Error) => {
        assert.ok(error.message.includes("401"));
        assert.ok(!error.message.includes("ollama-cloud-secret"), `must redact key: ${error.message}`);
        return true;
      },
    );
  });

  it("package_setup_registers_provider_auth_and_host_models_without_discovery", async () => {
    let fetchCalls = 0;
    const registered: unknown[] = [];
    const discovered = [mapOllamaModel({ id: "gpt-oss:20b" })];
    await createOllamaProviderPackage({
      apiKey: "ollama-cloud-secret",
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
    assert.ok(registered.some((item: any) => item.id === "ollama"));
    assert.ok(registered.some((item: any) => item.provider === "ollama" && item.model === "gpt-oss:20b"));
    assert.ok(registered.some((item: any) => item.provider === "ollama" && item.kind === "api_key"));
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
