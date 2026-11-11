import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type JsonObject, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import {
  applyThinkingLevelForModel,
  collectProviderEvents,
  providerConformance,
  replayFetch,
  THINKING_LEVELS,
} from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import definition, { openrouter, createOpenRouterProvider, listOpenRouterModels, mapOpenRouterModel, openRouterModels } from "../index.js";

const model = openRouterModels[0]!;
const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};
const secret = "sk-or-test-canary-never-expose";
function completion(extra: JsonObject = {}): Response {
  return new Response(
    `data: ${JSON.stringify({ model: "vendor/served", provider: "Upstream", id: "gen-test", choices: [{ delta: { content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.001, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 5 } }, ...extra })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function capture(req: ProviderRequest = request, config: Parameters<typeof createOpenRouterProvider>[0] = {}) {
  let headers = new Headers();
  let body: JsonObject = {};
  const provider = createOpenRouterProvider({
    ...config,
    apiKey: async () => secret,
    fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      return completion();
    }) as typeof fetch,
  });
  const events = await collectProviderEvents(provider, req);
  return { body, headers, events };
}
function errorEvent(events: readonly ProviderEvent[]) {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  if (terminal?.type !== "error") throw new Error("missing error");
  return terminal.error;
}

describe("OpenRouter", () => {
  it("openrouter_package_conformance", async () => {
    assert.equal((await packageConformance(definition)).ok, true);
    const result = await providerConformance((fetch) => createOpenRouterProvider({ apiKey: async () => secret, fetch }), {
      recordings: new URL("./wire/openai/", import.meta.url),
      models: [model, mapOpenRouterModel({ id: "anthropic/claude-haiku-4.5", context_length: 200000 })],
      secrets: [secret],
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.length >= 9);
  });
  it("openrouter_usage_carries_cost_and_served_model", async () => {
    const { events } = await capture();
    const usage = events.find((event) => event.type === "usage")?.usage;
    assert.equal(usage?.currency, "USD");
    assert.equal(usage?.cost, 0.001);
    assert.equal(usage?.cacheReadTokens, 40);
    assert.equal(usage?.cacheWriteTokens, 20);
    assert.deepEqual(usage?.metadata?.openrouter, {
      model: "vendor/served",
      provider: "Upstream",
      generationId: "gen-test",
      reasoningTokens: 5,
    });
  });
  it("openrouter_session_affinity_header", async () => {
    assert.equal((await capture()).headers.has("x-session-id"), false);
    assert.equal(
      (await capture({ ...request, options: { sessionId: "session", cacheKey: " key / one " } })).headers.get("x-session-id"),
      "key-one",
    );
    assert.equal((await capture({ ...request, options: { sessionId: "x".repeat(300) } })).headers.get("x-session-id")?.length, 256);
  });
  it("openrouter_anthropic_models_get_cache_blocks", async () => {
    const discovered = mapOpenRouterModel({ id: "anthropic/claude-haiku-4.5", context_length: 200000 });
    assert.equal(discovered.compat?.cacheControl, "anthropic-blocks");
    const tools: ProviderRequest["tools"] = [
      { name: "weather", parameters: { type: "object" }, execute: () => ({ name: "weather", toolCallId: "call" }) },
    ];
    const { body } = await capture({ ...request, model: discovered, tools });
    const messages = body.messages as JsonObject[];
    assert.deepEqual((messages[0]!.content as JsonObject[])[0]?.cache_control, { type: "ephemeral" });
    assert.deepEqual((messages[1]!.content as JsonObject[])[0]?.cache_control, { type: "ephemeral" });
    assert.deepEqual((body.tools as JsonObject[])[0]?.cache_control, { type: "ephemeral" });
    assert.equal(JSON.stringify((await capture({ ...request, tools })).body).includes("cache_control"), false);
  });
  it("openrouter_never_sends_prompt_cache_key", async () => {
    const { body } = await capture({
      ...request,
      options: { cacheKey: "cache", compat: { prompt_cache_key: "foreign" }, extra: { prompt_cache_key: "foreign" } },
    });
    assert.equal("prompt_cache_key" in body, false);
  });
  it("openrouter_attribution_headers_only_when_configured", async () => {
    const spoofed = await capture({
      ...request,
      options: { headers: { "HTTP-Referer": "https://attacker.example", "X-OpenRouter-Title": "attacker" } },
    });
    assert.equal(spoofed.headers.has("HTTP-Referer"), false);
    assert.equal(spoofed.headers.has("X-OpenRouter-Title"), false);
    const { headers } = await capture(
      {
        ...request,
        options: { headers: { Authorization: "attacker", "Content-Type": "bad", "HTTP-Referer": "https://attacker.example" } },
      },
      { appUrl: "https://prism.example", appTitle: "Prism" },
    );
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("HTTP-Referer"), "https://prism.example");
    assert.equal(headers.get("X-OpenRouter-Title"), "Prism");
  });
  it("openrouter_routing_passthrough", async () => {
    const routing = { only: ["anthropic"], data_collection: "deny" as const, zdr: true, max_price: { prompt: 1 } };
    assert.deepEqual((await capture(request, { routing })).body.provider, routing);
  });
  it("openrouter_thinking_level_maps_to_reasoning_effort", async () => {
    for (const level of THINKING_LEVELS) {
      const { body } = await capture({ ...request, options: applyThinkingLevelForModel(undefined, level, model) });
      assert.deepEqual(body.reasoning, { effort: level });
      assert.equal("reasoning_effort" in body, false);
    }
  });
  it("openrouter_error_mapping", async () => {
    for (const [status, message, failureClass, hint] of [
      [401, "unauthorized", "auth", "API key"],
      [402, "payment required", "permanent", "credits"],
      [429, "rate limit exceeded", "rate_limited", "429"],
      [429, "Free daily limit exceeded", "quota", "daily"],
      [404, "No endpoints found matching your data policy", "permanent", "routing.data_collection"],
    ] as const) {
      const provider = createOpenRouterProvider({
        apiKey: async () => secret,
        fetch: (async () =>
          new Response(JSON.stringify({ error: { code: status, message: `${message} ${secret}` } }), { status })) as typeof fetch,
      });
      const error = errorEvent(await collectProviderEvents(provider, request));
      assert.equal(error.failureClass, failureClass);
      assert.ok(error.message.includes(hint));
      assert.equal(error.message.includes(secret), false);
    }
  });
  it("openrouter_mid_stream_error_is_error_event", async () => {
    const events = await collectProviderEvents(
      createOpenRouterProvider({
        apiKey: async () => secret,
        fetch: (async () => completion({ error: { code: 429, message: "Rate limit exceeded" } })) as typeof fetch,
      }),
      request,
    );
    assert.equal(errorEvent(events).failureClass, "rate_limited");
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
    );
  });
  it("openrouter_documented_shape_overflow_classified_and_recovered", async () => {
    // Documented shape only: owner-authorized free-router probes never reached an overflow.
    const recording = {
      path: "/api/v1/chat/completions",
      status: 400,
      responseBody: JSON.stringify({ error: { code: 400, message: "context_length_exceeded" } }),
    };
    const events = await collectProviderEvents(
      createOpenRouterProvider({ apiKey: async () => secret, fetch: replayFetch([recording]) }),
      request,
    );
    assert.equal(errorEvent(events).failureClass, "context_overflow");
    const { openAIOverflowSession } = await import("./overflow-session.js");
    await openAIOverflowSession(recording);
  });
  it("openrouter_catalog_declares_context_windows", () => {
    assert.equal(model.limits?.contextWindow, 65536);
    assert.equal(model.cost?.input, 0);
    assert.equal(mapOpenRouterModel({ id: "unknown/model" }).limits?.contextWindow, undefined);
  });
  it("list_openrouter_models_maps_capabilities_cost_and_cache_kind", async () => {
    let calls = 0;
    const models = await listOpenRouterModels({
      fetch: (async (url) => {
        calls++;
        assert.equal(String(url), "https://openrouter.ai/api/v1/models");
        return Response.json({
          data: [
            {
              id: "anthropic/test",
              context_length: 200000,
              top_provider: { max_completion_tokens: 64000 },
              architecture: { input_modalities: ["text", "image"] },
              supported_parameters: ["tools", "reasoning", "structured_outputs"],
              pricing: { prompt: "0.000001", completion: "0.000005", input_cache_read: "0.0000001", input_cache_write: "0.00000125" },
            },
            { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
          ],
        });
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    const first = models[0]!;
    assert.deepEqual(first.limits, { contextWindow: 200000, maxOutputTokens: 64000 });
    assert.deepEqual(first.capabilities?.input, ["text", "image"]);
    assert.equal(first.capabilities?.tools, true);
    assert.equal(first.capabilities?.structuredOutput, "json_schema");
    assert.equal(first.cost?.currency, "USD");
    assert.equal(first.cost?.input, 1);
    assert.equal(first.cost?.output, 5);
    assert.ok(Math.abs((first.cost?.cacheRead ?? 0) - 0.1) < 1e-12);
    assert.equal(first.cost?.cacheWrite, 1.25);
    assert.equal(first.cache?.kind, "cache_control");
    assert.equal(models[1]?.cost, undefined);
    assert.equal(models[1]?.cache?.kind, "implicit");
  });
  it("openrouter_missing_key_notes_and_registers", async () => {
    const agent = await createAgent({ model, packages: [openrouter({ apiKey: "env:PRISM_TEST_OPENROUTER_UNSET", models: [model] })] });
    try {
      assert.ok(agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.includes("no API key")));
      const result = await (await agent.session()).run("hi");
      assert.equal(result.status, "failed");
      if (result.status === "failed") assert.equal(result.error?.code, "credential_unavailable");
    } finally {
      await agent.dispose();
    }
  });
  it("openrouter_routing_config_rejects_unknown_keys", async () => {
    for (const config of [
      { routing: { surprise: true } },
      { routing: { max_price: { surprise: 1 } } },
      { appUrl: "http://insecure.example" },
      { appUrl: "https://user:password@example.com" },
      { appUrl: "https://[invalid" },
      { appTitle: "x".repeat(101) },
      { apiKey: "sk-literal" },
    ]) {
      await assert.rejects(() => createAgent({ model, packages: [openrouter(config as Parameters<typeof openrouter>[0])] }));
    }
  });
  it("provider_factories_reject_literal_keys", async () => {
    // Type level: the low-level factory and discovery take a `SecretSource`, never a literal.
    // @ts-expect-error -- a literal key does not type-check on the factory.
    const factoryLiteral: Parameters<typeof createOpenRouterProvider>[0] = { apiKey: "sk-literal" };
    // @ts-expect-error -- nor on discovery.
    const discoveryLiteral: Parameters<typeof listOpenRouterModels>[0] = { apiKey: "sk-literal" };
    assert.ok(factoryLiteral && discoveryLiteral);
    // Runtime: a manifest-built instance rejects a literal `apiKey` and accepts a ref.
    await assert.rejects(() => createAgent({ model, packages: [openrouter({ apiKey: "sk-literal", models: [model] })] }));
    const env = "PRISM_TEST_OPENROUTER_LITERAL_GUARD";
    process.env[env] = secret;
    let authorization: string | null = null;
    const agent = await createAgent({
      model,
      packages: [
        openrouter({
          apiKey: `env:${env}`,
          fetch: (async (url, init) => {
            authorization = new Headers(init?.headers).get("authorization");
            return String(url).endsWith("/models") ? Response.json({ data: [] }) : completion();
          }) as typeof fetch,
        }),
      ],
    });
    try {
      await agent.models.list();
      assert.equal(authorization, `Bearer ${secret}`, "discovery resolves the ref through refSource");
    } finally {
      await agent.dispose();
      delete process.env[env];
    }
  });
  it("openrouter_discovery_errors_are_bounded_redacted_and_fail_closed", async () => {
    await assert.rejects(
      () =>
        listOpenRouterModels({ apiKey: async () => secret, fetch: (async () => new Response(secret, { status: 401 })) as typeof fetch }),
      (error: Error) => !error.message.includes(secret) && error.message.includes("401"),
    );
    await assert.rejects(
      () => listOpenRouterModels({ fetch: (async () => Response.json({ data: null })) as typeof fetch }),
      /missing data array/,
    );
    assert.throws(() => mapOpenRouterModel({ id: "" }), /missing id/);
  });
  it("openrouter_catalog_over_request_body_cap_still_parses", async () => {
    const data = Array.from({ length: 470 }, (_, index) => ({
      id: `vendor/model-${index}`,
      name: `Model ${index} with a long descriptive name for catalog padding`,
      context_length: 65536,
      supported_parameters: ["tools", "reasoning", "structured_outputs"],
      pricing: { prompt: "0.000001", completion: "0.000002" },
    }));
    const body = JSON.stringify({ data });
    assert.ok(body.length > 65536);
    const models = await listOpenRouterModels({ fetch: (async () => new Response(body)) as typeof fetch });
    assert.equal(models.length, 470);
  });
  it("openrouter_discovery_is_lazy_and_one_get_per_models_call", async () => {
    const env = "PRISM_TEST_OPENROUTER_DISCOVER";
    const previous = process.env[env];
    process.env[env] = secret;
    const urls: string[] = [];
    const agent = await createAgent({
      model,
      packages: [
        openrouter({
          apiKey: `env:${env}`,
          fetch: (async (url) => {
            urls.push(String(url));
            return Response.json({ data: [{ id: "vendor/discovered", context_length: 8192 }] });
          }) as typeof fetch,
        }),
      ],
    });
    try {
      assert.equal(urls.length, 0);
      await agent.models.list();
      await agent.models.list();
      assert.deepEqual(urls, ["https://openrouter.ai/api/v1/models", "https://openrouter.ai/api/v1/models"]);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env[env];
      else process.env[env] = previous;
    }
  });
  it("openrouter_static_models_skip_discovery_and_ref_resolves_per_request", async () => {
    const env = "PRISM_TEST_OPENROUTER_ROTATE";
    const previous = process.env[env];
    process.env[env] = secret;
    const keys: (string | null)[] = [];
    const agent = await createAgent({
      model,
      packages: [
        openrouter({
          models: [model],
          apiKey: `env:${env}`,
          fetch: (async (_url, init) => {
            keys.push(new Headers(init?.headers).get("authorization"));
            return completion();
          }) as typeof fetch,
        }),
      ],
    });
    try {
      await agent.models.list();
      assert.deepEqual(keys, []);
      await (await agent.session()).run("one");
      process.env[env] = "rotated-key";
      await (await agent.session()).run("two");
      assert.deepEqual(keys, [`Bearer ${secret}`, "Bearer rotated-key"]);
      assert.equal(JSON.stringify(agent.inspect()).includes(secret), false);
    } finally {
      await agent.dispose();
      if (previous === undefined) delete process.env[env];
      else process.env[env] = previous;
    }
  });
});
