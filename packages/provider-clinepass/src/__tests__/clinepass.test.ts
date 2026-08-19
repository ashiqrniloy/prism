import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { applyThinkingLevel } from "@arnilo/prism";
import {
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
} from "@arnilo/prism/testing/provider-conformance";
import {
  CLINEPASS_DEFAULT_BASE_URL,
  CLINEPASS_FEATURED_SLUGS,
  clinePassBody,
  clinePassModels,
  createClinePassProvider,
  createClinePassProviderPackage,
} from "../index.js";

const byId = (id: string): ModelConfig => clinePassModels.find((model) => model.model === id)!;

const requestFor = (id: string, options?: ProviderRequest["options"]): ProviderRequest => ({
  model: byId(id),
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  options,
});

describe("@arnilo/prism-provider-clinepass", () => {
  it("clinepass_registers_each_featured_slug_once_and_api_key_only", async () => {
    const models: string[] = [];
    const methods: string[] = [];
    await createClinePassProviderPackage({ apiKey: "fake-cline-key" }).setup({
      registerProvider: (provider: AIProvider) => assert.equal(provider.id, "clinepass"),
      registerModel: (model: ModelConfig) => models.push(model.model),
      registerAuthMethod: (method: AuthMethod) => methods.push(method.kind),
    } as never);
    assert.deepEqual(models, [...CLINEPASS_FEATURED_SLUGS]);
    assert.equal(new Set(models).size, models.length);
    assert.ok(models.every((id) => id.startsWith("cline-pass/")));
    assert.deepEqual(methods, ["api_key"]);
    assert.equal(CLINEPASS_DEFAULT_BASE_URL, "https://api.cline.bot/api/v1");
    assert.ok(clinePassModels.every((model) => model.cache?.kind === "implicit"));
  });

  it("clinepass_setup_does_not_fetch", async () => {
    let fetches = 0;
    await createClinePassProviderPackage({
      apiKey: "fake-cline-key",
      fetch: (async () => {
        fetches += 1;
        return new Response("nope", { status: 500 });
      }) as typeof fetch,
    }).setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as never);
    assert.equal(fetches, 0);
  });

  it("clinepass_maps_thinking_per_family", () => {
    assert.equal(clinePassBody(requestFor("cline-pass/glm-5.2", { compat: { reasoning_effort: "xhigh" } })).reasoning_effort, "xhigh");
    assert.equal(clinePassBody(requestFor("cline-pass/glm-5.2", applyThinkingLevel(undefined, "max", "reasoning_effort"))).reasoning_effort, "high");
    assert.equal(clinePassBody(requestFor("cline-pass/kimi-k3")).reasoning_effort, "max");
    assert.equal(clinePassBody(requestFor("cline-pass/kimi-k3", { compat: { reasoning_effort: "off" } })).reasoning_effort, undefined);
    assert.equal(clinePassBody(requestFor("cline-pass/kimi-k2.7-code", { compat: { reasoning_effort: "medium" } })).reasoning_effort, "medium");
    assert.equal(clinePassBody(requestFor("cline-pass/deepseek-v4-flash", { compat: { reasoning_effort: "high" } })).reasoning_effort, "high");
    assert.equal(clinePassBody(requestFor("cline-pass/deepseek-v4-pro", { compat: { thinking: { type: "disabled" } } })).reasoning_effort, "none");
    assert.equal(clinePassBody(requestFor("cline-pass/deepseek-v4-flash", { compat: { reasoning_effort: "medium" } })).reasoning_effort, undefined);
    assert.equal(clinePassBody(requestFor("cline-pass/qwen3.8-max", { compat: { reasoning_effort: "low" } })).reasoning_effort, "low");
  });

  it("clinepass_uses_max_completion_tokens_and_always_streams", () => {
    const body = clinePassBody({
      ...requestFor("cline-pass/glm-5.2"),
      model: { ...byId("cline-pass/glm-5.2"), parameters: { maxTokens: 333 } },
    });
    assert.equal(body.stream, true);
    assert.equal(body.max_completion_tokens, 333);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.cache_control, undefined);
  });

  it("clinepass_does_not_parse_non_stream_data_wrapper", async () => {
    const provider = createClinePassProvider({
      apiKey: "fake-cline-key",
      fetch: (async () =>
        Response.json({
          success: true,
          data: { choices: [{ message: { content: "wrapped-secret-text" }, finish_reason: "stop" }] },
        })) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({ provider, request: requestFor("cline-pass/glm-5.2") });
    assert.equal(events.at(-1)?.type, "error");
    assert.ok(!JSON.stringify(events).includes("wrapped-secret-text"));
  });

  it("clinepass_streams_and_maps_cache_tokens", async () => {
    let url = "";
    const provider = createClinePassProvider({
      apiKey: "fake-cline-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(
          sse([
            {
              choices: [{ delta: { content: "hi", reasoning: "plan" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } },
            },
          ]),
        );
      }) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({
      provider,
      request: requestFor("cline-pass/glm-5.2"),
      expect: { text: "hi" },
    });
    assert.equal(url, `${CLINEPASS_DEFAULT_BASE_URL}/chat/completions`);
    assert.equal(events.find((event) => event.type === "usage")?.usage?.cacheReadTokens, 4);
    assert.ok(events.some((event) => event.type === "content_delta" && event.content.type === "thinking"));
  });

  it("clinepass_redacts_api_key_and_keeps_provider_owned_headers", async () => {
    let headers = new Headers();
    const provider = createClinePassProvider({
      apiKey: "fake-cline-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response("bad fake-cline-key", { status: 500 });
      }) as typeof fetch,
    });
    const events = await assertProviderStreamConforms({
      provider,
      request: {
        ...requestFor("cline-pass/glm-5.2"),
        options: { headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } },
      },
    });
    assert.equal(events.at(-1)?.type, "error");
    assert.ok(!JSON.stringify(events).includes("fake-cline-key"));
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-cline-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
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
