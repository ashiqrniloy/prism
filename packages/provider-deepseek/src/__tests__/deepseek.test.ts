import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { applyThinkingLevel } from "@arnilo/prism";
import {
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
} from "@arnilo/prism/testing/provider-conformance";
import {
  createDeepSeekProvider,
  createDeepSeekProviderPackage,
  DEEPSEEK_DEFAULT_BASE_URL,
  deepseekBody,
  deepseekModels,
  listDeepSeekModels,
  mapDeepSeekModel,
} from "../index.js";

const request: ProviderRequest = {
  model: deepseekModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

const toolRequest: ProviderRequest = {
  ...request,
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-provider-deepseek", () => {
  it("deepseek_registers_featured_catalog_and_api_key", async () => {
    const registered: unknown[] = [];
    await createDeepSeekProviderPackage({ apiKey: "fake-deepseek-key" }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as never);
    assert(registered.some((item: any) => item.id === "deepseek"));
    assert(registered.some((item: any) => item.model === "deepseek-v4-flash"));
    assert(registered.some((item: any) => item.model === "deepseek-v4-pro"));
    assert(registered.some((item: any) => item.kind === "api_key"));
  });

  it("deepseek_provider_setup_does_not_call_model_discovery", async () => {
    let fetches = 0;
    await createDeepSeekProviderPackage({
      apiKey: "fake-deepseek-key",
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

  it("deepseek_featured_catalog_ids_cost_and_cache_kind", () => {
    assert.deepEqual(
      deepseekModels.map((model) => model.model),
      ["deepseek-v4-flash", "deepseek-v4-pro"],
    );
    assert.equal(deepseekModels[0]?.limits?.contextWindow, 1_000_000);
    assert.equal(deepseekModels[0]?.limits?.maxOutputTokens, 384_000);
    assert.equal(deepseekModels[0]?.cache?.kind, "implicit");
    assert.equal(deepseekModels[0]?.cost?.input, 0.14);
    assert.equal(deepseekModels[0]?.cost?.cacheRead, 0.0028);
    assert.equal(deepseekModels[1]?.cost?.input, 0.435);
    assert.equal(deepseekModels[1]?.cost?.cacheRead, 0.003625);
    assert.equal(deepseekModels[0]?.compat?.reasoning_effort, "high");
    assert.equal(DEEPSEEK_DEFAULT_BASE_URL, "https://api.deepseek.com");
  });

  it("deepseek_maps_thinking_effort_and_max_tokens", () => {
    const enabled = deepseekBody({
      ...request,
      model: { ...request.model, parameters: { maxTokens: 333, temperature: 0.4 } },
      options: { compat: { thinking: { type: "enabled" }, reasoning_effort: "medium" } },
    });
    assert.deepEqual(enabled.thinking, { type: "enabled" });
    assert.equal(enabled.reasoning_effort, "high");
    assert.equal(enabled.max_tokens, 333);
    assert.equal(enabled.maxTokens, undefined);
    assert.equal(enabled.temperature, undefined);

    const disabled = deepseekBody({
      ...request,
      options: applyThinkingLevel({ compat: { thinking: { type: "enabled" } } }, "none", "thinking_type"),
    });
    assert.deepEqual(disabled.thinking, { type: "disabled" });
    assert.equal(disabled.reasoning_effort, undefined);
  });

  it("deepseek_replays_reasoning_content_on_tool_turn_assistants", () => {
    const withTools = deepseekBody({
      ...toolRequest,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "step 1: plan" },
            { type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } },
          ],
        },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    });
    const messages = withTools.messages as readonly { reasoning_content?: string; tool_calls?: unknown }[];
    const toolAssistant = messages[1];
    assert.equal(toolAssistant?.reasoning_content, "step 1: plan");
    assert.ok(toolAssistant?.tool_calls);

    const noTools = deepseekBody({
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
    const serialized = JSON.stringify(noTools.messages);
    assert.ok(!serialized.includes("secret-chain"));
    assert.ok(!serialized.includes("reasoning_content"));
  });

  it("deepseek_canonicalizes_shuffled_tool_schema_keys", () => {
    const body = deepseekBody({
      ...request,
      tools: [
        {
          name: "lookup",
          parameters: {
            type: "object",
            required: ["z", "a"],
            properties: { z: { type: "string" }, a: { type: "number" } },
          },
          execute: () => ({ toolCallId: "c", name: "lookup", content: [] }),
        },
      ],
    });
    const tools = body.tools as unknown as readonly { function: { parameters: { properties: object; required: string[] } } }[];
    const parameters = tools[0]?.function.parameters;
    assert.deepEqual(Object.keys(parameters?.properties ?? {}), ["a", "z"]);
    assert.deepEqual(parameters?.required, ["a", "z"]);
  });

  it("deepseek_maps_prompt_cache_hit_tokens_to_cacheReadTokens", async () => {
    const provider = createDeepSeekProvider({
      apiKey: "fake-deepseek-key",
      fetch: (async () =>
        ok(
          sse([
            {
              choices: [{ delta: { content: "hi" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 7 },
            },
          ]),
        )) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hi", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 7 } },
    });
  });

  it("deepseek_redacts_api_key_from_http_errors_and_abort", async () => {
    const provider = createDeepSeekProvider({
      apiKey: "fake-deepseek-key",
      fetch: (async () => new Response("bad fake-deepseek-key", { status: 500 })) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-deepseek-key"));
  });

  it("deepseek_keeps_provider_owned_headers", async () => {
    let headers = new Headers();
    const provider = createDeepSeekProvider({
      apiKey: "fake-deepseek-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: { headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-deepseek-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("deepseek_defaults_to_official_base_url_and_replays_tool_loop", async () => {
    let url = "";
    const replay: ProviderRequest = {
      ...toolRequest,
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let body: unknown;
    const provider = createDeepSeekProvider({
      apiKey: "fake-deepseek-key",
      fetch: (async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return ok(sse([]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: replay });
    assert.equal(url, `${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
    assertSerializedRequestCoversContent(replay, body);
  });

  it("list_deepseek_models_maps_fixture_and_redacts_token", async () => {
    const controller = new AbortController();
    const models = await listDeepSeekModels({
      apiKey: "sk-deepseek-secret",
      baseUrl: "https://example.test/v1/",
      signal: controller.signal,
      fetch: (async (input, init) => {
        assert.equal(String(input), "https://example.test/v1/models");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-deepseek-secret");
        assert.equal(init?.signal, controller.signal);
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "deepseek-v4-flash", object: "model" },
              { id: "deepseek-v4-pro", object: "model" },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(models.length, 2);
    assert.equal(models[0]?.cache?.kind, "implicit");
    assert.equal(models[1]?.cost?.cacheRead, 0.003625);
    await assert.rejects(
      () =>
        listDeepSeekModels({
          apiKey: "sk-leaked-deepseek",
          fetch: (async () => new Response("unauthorized sk-leaked-deepseek", { status: 401 })) as typeof fetch,
        }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, /DeepSeek model discovery failed: 401/);
        assert.equal(message.includes("sk-leaked-deepseek"), false);
        assert.match(message, /\[REDACTED\]/);
        return true;
      },
    );
    assert.throws(() => mapDeepSeekModel({ id: "" } as never), /missing id/);
  });

  it("deepseek_emits_no_explicit_cache_payload", () => {
    const body = deepseekBody({
      ...request,
      options: { cacheKey: "sess", cacheRetention: "long", cache: { breakpoints: [{ location: "last_stable_message" }] } },
    });
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("cache_control"));
    assert.ok(!serialized.includes("cacheKey"));
    assert.ok(!serialized.includes("prompt_cache"));
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
