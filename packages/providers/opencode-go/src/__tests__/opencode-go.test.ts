import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertNoFetches, collectProviderEvents, ProviderRequirementError } from "@arnilo/prism/provider-kit";
import { loadProviderPackage } from "@arnilo/prism/testing";
import {
  createOpenCodeGoProvider,
  listOpenCodeGoModels,
  mapOpenCodeGoModel,
  OPENCODE_GO_DEFAULT_BASE_URL,
  openCodeGoModels,
  opencodeGo,
  routeForOpenCodeGoModel,
} from "../index.js";

const openaiModel: ModelConfig = {
  provider: "opencode-go",
  model: "kimi-k3",
  capabilities: { input: ["text"], output: ["text"], reasoning: true, tools: true, streaming: true },
  compat: { route: "openai", preserveThinking: true, reasoning_effort: "max" },
  cache: { kind: "implicit" },
};

const baseRequest: ProviderRequest = {
  model: openaiModel,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session with spaces" },
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

describe("@arnilo/prism-ai/opencode-go", () => {
  it("opencode_go_registers_official_featured_models_and_setup_does_not_fetch", async () => {
    const fetchCalls: unknown[] = [];
    const fetchImpl = (async () => {
      fetchCalls.push(1);
      return ok(sse([]));
    }) as typeof fetch;
    await loadProviderPackage(opencodeGo({ apiKey: "env:PRISM_TEST_OPENCODE_KEY", fetch: fetchImpl }));
    assertNoFetches(fetchCalls);
    const models = openCodeGoModels;
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
      apiKey: async () => "fake-opencode-key",
      fetch: (async (input) => {
        url = String(input);
        return ok(sse([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]));
      }) as typeof fetch,
    });
    for await (const _ of provider.generate(baseRequest)) {
      /* drain */
    }
    assert.equal(url, "https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("opencode_go_requires_session_before_fetch", async () => {
    let fetches = 0;
    const provider = createOpenCodeGoProvider({
      apiKey: async () => "fake-key",
      fetch: (async () => {
        fetches += 1;
        return ok(sse([]));
      }) as typeof fetch,
    });
    const requestWithoutSession: ProviderRequest = {
      model: openaiModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    await assert.rejects(
      async () => {
        for await (const _ of provider.generate(requestWithoutSession)) {
          /* drain */
        }
      },
      (error: Error) => {
        assert(error instanceof ProviderRequirementError);
        assert.equal((error as ProviderRequirementError).requirement, "sessionId");
        return true;
      },
    );
    assert.equal(fetches, 0, "must fail before any fetch");
  });

  it("opencode_go_session_header_is_sanitized_cache_key", async () => {
    let capturedHeaders: Headers | undefined;
    const provider = createOpenCodeGoProvider({
      apiKey: async () => "fake-key",
      fetch: (async (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        return ok(sse([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]));
      }) as typeof fetch,
    });

    // Case 1: cacheKey preference over sessionId, sanitized, clamped to 128
    const longKey = `key_with spaces & special!chars@${"a".repeat(150)}`;
    const req1: ProviderRequest = {
      model: openaiModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { sessionId: "sess-1", cacheKey: longKey },
    };
    for await (const _ of provider.generate(req1)) {
      /* drain */
    }
    const sessionHeader = capturedHeaders?.get("x-opencode-session");
    assert.ok(sessionHeader);
    assert.ok(sessionHeader.length <= 128);
    assert.match(sessionHeader, /^[A-Za-z0-9_.:-]+$/);
    assert.equal(sessionHeader.includes(" "), false);
    assert.equal(sessionHeader.includes("&"), false);
    assert.equal(sessionHeader.includes("fake-key"), false);
    assert.equal(sessionHeader.includes("hi"), false);

    // Case 2: falls back to sessionId when cacheKey is absent
    const req2: ProviderRequest = {
      model: openaiModel,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { sessionId: "session with spaces & / slashes" },
    };
    for await (const _ of provider.generate(req2)) {
      /* drain */
    }
    assert.equal(capturedHeaders?.get("x-opencode-session"), "session-with-spaces-slashes");
  });

  it("opencode_go_rejects_image_without_capability", async () => {
    let fetches = 0;
    const provider = createOpenCodeGoProvider({
      apiKey: async () => "fake-key",
      fetch: (async () => {
        fetches += 1;
        return ok(sse([]));
      }) as typeof fetch,
    });
    // openaiModel (kimi-k3) only declares input: ["text"]
    const imageRequest: ProviderRequest = {
      model: openaiModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          ],
        },
      ],
      options: { sessionId: "sess-1" },
    };
    const events = await collectProviderEvents(provider, imageRequest);
    assert.equal(events.at(-1)?.type, "error");
    const err = events.find((e) => e.type === "error");
    assert.ok(err?.error?.message.includes("image input capability"));
    assert.equal(fetches, 0, "rejection must occur before fetch");
  });

  it("opencode_go_catalog_routes_match_live_snapshot", () => {
    const models = openCodeGoModels;
    // Exactly 6 featured models in curated catalog route to anthropic (minimax-* and qwen*)
    const anthropicModels = models.filter((m) => m.compat?.route === "anthropic");
    assert.equal(anthropicModels.length, 6);
    for (const m of anthropicModels) {
      assert.ok(m.model.startsWith("minimax-") || m.model.startsWith("qwen"), `Unexpected anthropic model: ${m.model}`);
      assert.equal(routeForOpenCodeGoModel(m.model), "anthropic");
    }
    // All 8 Anthropic-route models from Task 1 (c) live snapshot map to anthropic route
    const liveAnthropicIds = [
      "minimax-m2.5",
      "minimax-m2.7",
      "minimax-m3",
      "qwen3.6-plus",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.8-max",
      "qwen3.8-flash",
    ];
    for (const id of liveAnthropicIds) {
      assert.equal(routeForOpenCodeGoModel(id), "anthropic");
    }
    const openaiModels = models.filter((m) => m.compat?.route === "openai");
    assert.ok(openaiModels.length >= 10);
    for (const m of openaiModels) {
      assert.equal(routeForOpenCodeGoModel(m.model), "openai");
    }
  });

  it("opencode_go_unknown_route_fails_closed", async () => {
    const provider = createOpenCodeGoProvider({ apiKey: async () => "fake-key" });
    const badRouteModel: ModelConfig = {
      ...openaiModel,
      compat: { route: "unknown-route" as any },
    };
    await assert.rejects(
      async () => {
        for await (const _ of provider.generate({ ...baseRequest, model: badRouteModel })) {
          /* drain */
        }
      },
      (error: Error) => error instanceof ProviderRequirementError,
    );
  });

  it("opencode_go_structured_output_capability_requires_per_model_verification", () => {
    const mimo = openCodeGoModels.find((m) => m.model === "mimo-v2.5");
    assert.equal(mimo?.capabilities?.structuredOutput, "json_schema");
    const mimoPro = openCodeGoModels.find((m) => m.model === "mimo-v2.5-pro");
    assert.equal(mimoPro?.capabilities?.structuredOutput, "json_schema");
    const deepseek = openCodeGoModels.find((m) => m.model === "deepseek-v4-pro");
    assert.equal(deepseek?.capabilities?.structuredOutput, undefined);
  });

  it("opencode_go_deepseek_rejects_structured_output_before_dispatch", async () => {
    let fetches = 0;
    const provider = createOpenCodeGoProvider({
      apiKey: async () => "fake-key",
      fetch: (async () => {
        fetches += 1;
        return ok(sse([]));
      }) as typeof fetch,
    });
    const deepseek = openCodeGoModels.find((m) => m.model === "deepseek-v4-pro")!;
    const req: ProviderRequest = {
      model: deepseek,
      messages: [{ role: "user", content: [{ type: "text", text: "give json" }] }],
      options: {
        sessionId: "sess-1",
        structuredOutput: { name: "test", schema: { type: "object" } },
      },
    };
    const events = await collectProviderEvents(provider, req);
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(fetches, 0, "rejection must occur before fetch");
  });

  it("list_opencode_go_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let capturedUrl = "";
    let capturedAuth: string | null = null;
    let signalSawAbort = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get("authorization");
      init?.signal?.addEventListener("abort", () => {
        signalSawAbort = true;
      });
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "kimi-k3", object: "model", created: 1, owned_by: "moonshot" },
            { id: "minimax-m3", object: "model", created: 2, owned_by: "minimax" },
            { id: "unknown-model-xyz", object: "model", created: 3, owned_by: "custom" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const controller = new AbortController();
    const mapped = await listOpenCodeGoModels({
      apiKey: async () => "secret-key",
      fetch: fetchImpl,
      baseUrl: "https://custom.opencode.ai/v1",
      signal: controller.signal,
    });

    assert.equal(capturedUrl, "https://custom.opencode.ai/v1/models");
    assert.equal(capturedAuth, "Bearer secret-key");
    controller.abort();
    assert.equal(signalSawAbort, true);

    const kimi = mapped.find((m) => m.model === "kimi-k3");
    assert.ok(kimi);
    assert.equal(kimi.provider, "opencode-go");
    assert.equal(kimi.compat?.route, "openai");
    assert.equal(kimi.cache?.kind, "implicit");

    const minimax = mapped.find((m) => m.model === "minimax-m3");
    assert.ok(minimax);
    assert.equal(minimax.compat?.route, "anthropic");
    assert.equal(minimax.cache?.kind, "cache_control");

    const unknown = mapped.find((m) => m.model === "unknown-model-xyz");
    assert.ok(unknown);
    assert.equal(unknown.compat?.route, "openai");
  });

  it("list_opencode_go_models_redacts_token_in_errors", async () => {
    const secret = "super-secret-token-12345";
    const fetchImpl = (async () => {
      return new Response(`error details mentioning ${secret}`, {
        status: 401,
        headers: { "content-type": "text/plain" },
      });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await listOpenCodeGoModels({ apiKey: async () => secret, fetch: fetchImpl });
      },
      (error: Error) => {
        assert.equal(error.message.includes(secret), false, "error leaked token");
        assert.ok(error.message.includes("[REDACTED]"), "token was not redacted");
        return true;
      },
    );
  });

  it("map_opencode_go_model_rejects_malformed_entry", () => {
    assert.throws(() => mapOpenCodeGoModel(null as any));
    assert.throws(() => mapOpenCodeGoModel({} as any));
    assert.throws(() => mapOpenCodeGoModel({ id: "" } as any));
  });

  it("catalog_stamps_levels_and_family_per_upstream", () => {
    const kimi3 = openCodeGoModels.find((m) => m.model === "kimi-k3");
    assert.deepEqual(kimi3?.capabilities?.thinkingLevels, ["low", "high", "max"]);
    assert.equal(kimi3?.compat?.thinkingFamily, "reasoning_effort");

    const qwen = openCodeGoModels.find((m) => m.model === "qwen3.6-plus");
    assert.equal(qwen?.compat?.thinkingFamily, "thinking_type");
  });
});
