import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertNoFetches, assertNoSecretLeak, ProviderRequirementError } from "@arnilo/prism/provider-kit";
import { loadProviderPackage } from "@arnilo/prism/testing";
import {
  createHyperProvider,
  getHyperCredits,
  HYPER_DEFAULT_BASE_URL,
  hyper,
  hyperModels,
  listHyperModels,
  parseHyperUsageCost,
  routeForHyperModel,
  withHyperCost,
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

const baseRequest: ProviderRequest = {
  model: openaiModel,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

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

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("@arnilo/prism-ai/hyper", () => {
  it("hyper_registers_featured_models_and_setup_does_not_fetch", async () => {
    const fetchCalls: unknown[] = [];
    const fetchImpl = (async () => {
      fetchCalls.push(1);
      return ok(sse([]));
    }) as typeof fetch;
    await loadProviderPackage(hyper({ apiKey: "env:PRISM_TEST_HYPER_KEY", fetch: fetchImpl }));
    assertNoFetches(fetchCalls);
    const models = hyperModels;
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
  });

  it("hyper_defaults_to_official_hyper_base_url", async () => {
    let url = "";
    const provider = createHyperProvider({
      apiKey: async () => "fake-hyper-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]));
      }) as typeof fetch,
    });
    for await (const _ of provider.generate(baseRequest)) {
      /* drain */
    }
    assert.equal(url, "https://hyper.charm.land/v1/chat/completions");
  });

  it("hyper_routes_qwen36_to_messages_and_others_to_chat", async () => {
    assert.equal(routeForHyperModel("qwen3.6-flash"), "anthropic");
    assert.equal(routeForHyperModel("qwen3.6-plus"), "anthropic");
    assert.equal(routeForHyperModel("qwen3.6-max"), "anthropic");
    assert.equal(routeForHyperModel("deepseek-v4-pro"), "openai");
    assert.equal(routeForHyperModel("kimi-k3"), "openai");
    assert.equal(routeForHyperModel("glm-5.3"), "openai");

    const urls: string[] = [];
    const provider = createHyperProvider({
      apiKey: async () => "fake-hyper-key",
      fetch: (async (input) => {
        urls.push(String(input));
        return ok(sse([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]));
      }) as typeof fetch,
    });

    // Chat route for deepseek
    for await (const _ of provider.generate(baseRequest)) {
      /* drain */
    }
    assert.equal(urls[0], "https://hyper.charm.land/v1/chat/completions");

    // Anthropic messages route for qwen3.6
    for await (const _ of provider.generate({ ...baseRequest, model: qwenAnthropicModel })) {
      /* drain */
    }
    assert.equal(urls[1], "https://hyper.charm.land/v1/messages");
  });

  it("hyper_usage_carries_cost_and_remaining_credits", async () => {
    const rawWire = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 40 },
      cost: { usd: 0.00025, hypercredits: 0.25 },
      remaining: { hypercredits: 88.5 },
    };

    const usage = withHyperCost(rawWire);
    assert.ok(usage);
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.outputTokens, 50);
    assert.equal(usage.totalTokens, 150);
    assert.equal(usage.cacheReadTokens, 40);
    assert.equal(usage.cost, 0.00025);
    assert.equal(usage.currency, "USD");
    assert.deepEqual(usage.metadata?.hyper, {
      usd: 0.00025,
      hypercredits: 0.25,
      remainingHypercredits: 88.5,
    });

    // Verify stream emits usage with hyper metadata
    const provider = createHyperProvider({
      apiKey: async () => "fake-hyper-key",
      fetch: (async () =>
        ok(
          sse([
            { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { choices: [], usage: rawWire },
          ]),
        )) as typeof fetch,
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(baseRequest)) {
      events.push(event);
    }
    const usageEvent = events.find((e): e is Extract<ProviderEvent, { type: "usage" }> => e.type === "usage");
    assert.ok(usageEvent);
    assert.equal(usageEvent.usage.cost, 0.00025);
    assert.equal(usageEvent.usage.currency, "USD");
    assert.deepEqual(usageEvent.usage.metadata?.hyper, {
      usd: 0.00025,
      hypercredits: 0.25,
      remainingHypercredits: 88.5,
    });
  });

  it("hyper_402_is_not_retryable", async () => {
    const provider = createHyperProvider({
      apiKey: async () => "sk-hyper-secret-key",
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
    const err = (errorEvent as any)?.error as Error & { code?: number; failureClass?: string };
    assert.equal(err.code, 402);
    assert.equal(err.failureClass, "permanent");
    assert.match(String(err.message), /billing_error/);
    assertNoSecretLeak(events, ["sk-hyper-secret-key"]);
  });

  it("hyper_unknown_route_fails_closed", async () => {
    let fetches = 0;
    const provider = createHyperProvider({
      apiKey: async () => "fake-hyper-key",
      fetch: (async () => {
        fetches += 1;
        return new Response("ok");
      }) as typeof fetch,
    });

    await assert.rejects(
      async () => {
        for await (const _ of provider.generate({
          model: {
            provider: "hyper",
            model: "deepseek-v4-pro",
            compat: { route: "unknown-route" as any },
          },
          messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        })) {
          /* drain */
        }
      },
      (error: unknown) =>
        error instanceof ProviderRequirementError &&
        error.code === "ERR_PRISM_PROVIDER_REQUIREMENT" &&
        error.requirement === "route" &&
        error.providerId === "hyper",
    );
    assert.equal(fetches, 0, "fail closed before network");

    // Also verify responses route is rejected
    await assert.rejects(
      async () => {
        for await (const _ of provider.generate({
          model: {
            provider: "hyper",
            model: "deepseek-v4-pro",
            compat: { route: "responses" as any },
          },
          messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        })) {
          /* drain */
        }
      },
      (error: unknown) =>
        error instanceof ProviderRequirementError &&
        error.code === "ERR_PRISM_PROVIDER_REQUIREMENT" &&
        error.requirement === "route" &&
        error.providerId === "hyper",
    );
    assert.equal(fetches, 0, "fail closed before network");
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
    assert.deepEqual(deepseek.capabilities?.thinkingLevels, ["high", "xhigh"]);
    assert.deepEqual(deepseek.compat?.effortLevels, ["high", "xhigh"]);
    assert.equal(deepseek.compat?.thinkingFamily, "reasoning_effort");
    assert.equal(qwen.compat?.route, "anthropic");
    assert.equal(qwen.cache?.kind, "cache_control");
    assert.deepEqual(qwen.capabilities?.input, ["text", "image"]);
  });

  it("hyper_catalog_caps_an_output_limit_that_equals_the_context_window", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "minimax-m3",
              display_name: "MiniMax M3",
              context_window: 512_000,
              max_output_tokens: 512_000,
              capabilities: { vision: false },
            },
            {
              id: "qwen3.8-27b",
              display_name: "Qwen 3.8 27B",
              context_window: 1_000_000,
              max_output_tokens: 128_000,
              capabilities: { vision: false },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const [minimax, qwen] = await listHyperModels({ fetch: fetchImpl });
    assert.equal(minimax.limits?.contextWindow, 512_000);
    assert.equal(minimax.limits?.maxOutputTokens, 128_000, "the output limit cannot consume the whole window");
    assert.equal(qwen.limits?.maxOutputTokens, 128_000, "a sane output limit is untouched");
  });

  it("hyper_credits_reports_balance", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer fake-hyper-key");
      return new Response(JSON.stringify({ balance: 42 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const credits = await getHyperCredits({ apiKey: async () => "fake-hyper-key", fetch: fetchImpl });
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

  it("featured_models_declare_levels_and_family_stamp", () => {
    const flash = hyperModels.find((model) => model.model === "deepseek-v4-flash")!;
    assert.deepEqual(flash.capabilities?.thinkingLevels, ["high", "xhigh"]);
    assert.equal(flash.compat?.thinkingFamily, "reasoning_effort");
    assert.deepEqual(flash.compat?.effortLevels, ["high", "xhigh"]);
  });
});
