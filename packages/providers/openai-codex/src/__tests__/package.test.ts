import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type AgentConfig,
  type CredentialResolver,
  createAgent,
  createDefaultRetryPolicy,
  type ModelConfig,
  type ProviderEvent,
  type ProviderRequest,
  type Secret,
} from "@arnilo/prism";
import { providerConformance } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";

import openaiCodexDefinition, {
  createOpenAICodexProvider,
  credentialRecordToSecret,
  listOpenAICodexModels,
  OPENAI_CODEX_DEFAULT_BASE_URL,
  OPENAI_CODEX_DEFAULT_CREDENTIAL_REF,
  OPENAI_CODEX_MODELS_MAX_BODY_BYTES,
  OPENAI_CODEX_SCOPE,
  openAICodexAffinity,
  openAICodexErrorCode,
  openAICodexModels,
  openaiCodex,
  USAGE_LIMIT_NOTE,
} from "../index.js";

const KEY = "siwc-conformance-token-should-not-surface";
const CREDENTIAL = "keyring:openai-codex";
const REASONING_PLACEHOLDER = "gAAAAABprism-fixture-encrypted-reasoning-item";
const recording = (name: string) => new URL(`./wire/responses/${name}.json`, import.meta.url);

const model = openAICodexModels[0] as ModelConfig;

/** An in-memory credentials slot, the shape a keyring resolver has. */
function memorySlot(initial?: readonly [string, Secret][]) {
  const values = new Map<string, Secret>(initial ?? []);
  const stored: Array<[string, Secret]> = [];
  const resolver: CredentialResolver = {
    resolve: (ref: string) => values.get(ref),
    store: (ref: string, secret: Secret) => {
      values.set(ref, secret);
      stored.push([ref, secret]);
    },
    delete: (ref: string) => void values.delete(ref),
  };
  return { resolver, values, stored };
}

function sse(events: readonly object[]): Response {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function failure(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const completed = (text: string) =>
  sse([
    { type: "response.created", response: { id: "resp_t", status: "in_progress" }, sequence_number: 0 },
    { type: "response.output_text.delta", delta: text, sequence_number: 1 },
    {
      type: "response.completed",
      response: { id: "resp_t", status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } },
      sequence_number: 2,
    },
  ]);

async function collect(provider: ReturnType<typeof createOpenAICodexProvider>, request: ProviderRequest): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate(request)) events.push(event);
  return events;
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model,
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    options: { sessionId: "sess-123" },
    ...overrides,
  };
}

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: `openai-codex/${model.model}`,
    packages: [openaiCodex({ credential: CREDENTIAL, appName: "Prism Tests", models: openAICodexModels })],
    ...overrides,
  };
}

describe("@arnilo/prism-ai/openai-codex package", () => {
  it("openai_codex_package_conformance", async () => {
    const result = await packageConformance(openaiCodexDefinition, { config: { credential: CREDENTIAL, appName: "Prism Tests" } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("openai_codex_passes_recorded_conformance", async () => {
    const result = await providerConformance((fetchImpl) => createOpenAICodexProvider({ apiKey: async () => KEY, fetch: fetchImpl }), {
      recordings: new URL("./wire/", import.meta.url),
      models: openAICodexModels,
      secrets: [KEY],
    });
    assert.equal(result.ok, true);
    const names = result.scenarios.map((scenario) => scenario.name).sort();
    assert.deepEqual(names, [
      "cache",
      "error-invalid-user",
      "error-unsupported-capability",
      "error-usage-limit",
      "image",
      "structured-output",
      "text",
      "tool-loop",
    ]);
    const toolLoop = result.scenarios.find((scenario) => scenario.name === "tool-loop");
    assert.ok(
      toolLoop?.events.some((event) => event.type === "tool_call"),
      "the tool loop emits the captured call",
    );
  });

  it("openai_codex_omits_siwc_unsupported_fields", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async (_input: unknown, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return completed("ok");
      }) as typeof fetch,
    });
    // The model carries the two most tempting parameters; the route refuses both.
    const withParameters: ModelConfig = { ...model, parameters: { temperature: 0.7, top_p: 0.9, max_output_tokens: 256 } };
    await collect(
      provider,
      request({ model: withParameters, options: { sessionId: "s", extra: { temperature: 0.2, metadata: { a: 1 } } } }),
    );
    assert.ok(body, "a request reached the transport");
    for (const field of ["temperature", "top_p", "metadata", "background", "prompt", "truncation", "user", "conversation"]) {
      assert.equal(field in body!, false, `${field} must not be sent`);
    }
    assert.equal(body!.max_output_tokens, 256, "the route accepts max_output_tokens and it passes through");
  });

  it("openai_codex_rejects_max_output_tokens_below_the_route_minimum", async () => {
    const provider = createOpenAICodexProvider({ apiKey: async () => KEY, fetch: (async () => completed("ok")) as typeof fetch });
    const events = await collect(provider, request({ model: { ...model, parameters: { max_output_tokens: 8 } } }));
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "error");
    assert.equal(terminal?.type === "error" ? (terminal.error.code as string | undefined) : undefined, "max_output_tokens_below_minimum");
  });

  it("openai_codex_affinity_headers_and_cache_key", async () => {
    let headers: Headers | undefined;
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async (_input: unknown, init: RequestInit) => {
        headers = new Headers(init.headers);
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return completed("ok");
      }) as typeof fetch,
    });
    await collect(provider, request({ options: { cacheKey: "cache-key-with spaces/and/slashes" } }));
    assert.equal(headers?.get("session_id"), "cache-key-with-spaces-and-slashes");
    assert.equal(headers?.get("x-client-request-id"), "cache-key-with-spaces-and-slashes");
    assert.equal(body?.prompt_cache_key, "cache-key-with spaces/and/slashes", "the body keeps the caller's key");
    assert.equal(body?.store, false);
    assert.deepEqual(body?.include, ["reasoning.encrypted_content"]);
    assert.equal("previous_response_id" in body!, false, "the stateless route never continues a stored response");

    const long = "k".repeat(200);
    const clamped = await collect(provider, request({ options: { sessionId: long } }));
    assert.ok(clamped.length > 0);
    assert.equal(String(body?.prompt_cache_key).length, 64, "the cache key is clamped to 64 characters");
    assert.equal(openAICodexAffinity(request({ options: {} })).session_id, undefined, "an absent key sends no affinity");
  });

  it("openai_codex_error_mapping_table", async () => {
    const cases: Array<{ status: number; body: unknown; failureClass: string; message?: string }> = [
      {
        status: 429,
        body: { detail: "You've reached your ChatGPT plan usage limit.", code: "subscription_sharing_usage_limit_exceeded" },
        failureClass: "quota",
        message: USAGE_LIMIT_NOTE,
      },
      { status: 503, body: { code: "subscription_sharing_usage_unavailable" }, failureClass: "transient" },
      { status: 503, body: { code: "subscription_sharing_user_unavailable" }, failureClass: "transient" },
      { status: 403, body: { code: "subscription_sharing_user_not_eligible" }, failureClass: "auth" },
      { status: 403, body: { code: "subscription_sharing_route_not_supported" }, failureClass: "auth" },
      { status: 403, body: { code: "chatpass_v2_not_allowed" }, failureClass: "auth" },
      {
        status: 400,
        body: { detail: "Unsupported parameter: temperature", param: "temperature", code: "subscription_sharing_unsupported_capability" },
        failureClass: "permanent",
      },
      { status: 400, body: { detail: "Unsupported parameter: temperature" }, failureClass: "permanent" },
    ];
    for (const testCase of cases) {
      const provider = createOpenAICodexProvider({
        apiKey: async () => KEY,
        fetch: (async () => failure(testCase.status, testCase.body)) as typeof fetch,
      });
      const events = await collect(provider, request());
      const terminal = events.at(-1);
      assert.equal(terminal?.type, "error", `${JSON.stringify(testCase.body)} must fail`);
      const error = terminal?.type === "error" ? terminal.error : undefined;
      assert.equal(error?.failureClass, testCase.failureClass, `${JSON.stringify(testCase.body)} class`);
      if (testCase.message) assert.ok(error?.message.includes(testCase.message), "the usage limit names where to look");
    }

    const reauth = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async () => failure(401, { code: "subscription_sharing_invalid_user" })) as typeof fetch,
    });
    const terminal = (await collect(reauth, request())).at(-1);
    assert.equal(terminal?.type === "error" ? (terminal.error.code as string) : undefined, "openai_codex_reauthorize");
    assert.equal(openAICodexErrorCode('{"detail":"x","code":"chatpass_v2_blocked"}'), "chatpass_v2_blocked");
    assert.equal(openAICodexErrorCode('{"detail":"blocked by chatpass_v2_blocked"}'), "chatpass_v2_blocked");
  });

  it("openai_codex_usage_limit_not_retried", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async (_input: unknown, init: RequestInit) => {
        calls.push(init);
        return failure(429, { detail: "usage limit", code: "subscription_sharing_usage_limit_exceeded" });
      }) as typeof fetch,
    });
    const events = await collect(provider, request());
    const error = events.at(-1)?.type === "error" ? events.at(-1) : undefined;
    assert.ok(error, "the run failed");
    const policy = createDefaultRetryPolicy({ maxAttempts: 3 });
    const decision = await policy.decide({
      sessionId: "s",
      runId: "r",
      attempt: 1,
      error: (error as Extract<ProviderEvent, { type: "error" }>).error,
    });
    assert.deepEqual(decision, { retry: false }, "a quota failure is declined by the default policy");
  });

  it("openai_codex_overflow_body_classifies_context_overflow", async () => {
    const provider = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async () =>
        failure(400, { error: { code: "context_length_exceeded", message: "Your input exceeds the context window." } })) as typeof fetch,
    });
    const terminal = (await collect(provider, request())).at(-1);
    assert.equal(terminal?.type === "error" ? terminal.error.failureClass : undefined, "context_overflow");
  });

  it("openai_codex_catalog_declares_context_windows", () => {
    const windows = new Map(openAICodexModels.map((entry) => [entry.model, entry.limits?.contextWindow]));
    assert.equal(windows.get("gpt-6.1-sol"), 500_000);
    assert.equal(windows.get("gpt-6-luna"), 272_000);
    for (const entry of openAICodexModels) {
      assert.ok((entry.limits?.contextWindow ?? 0) > 0, `${entry.model} declares its context window`);
      assert.equal(entry.compat?.route, "responses");
      assert.deepEqual(entry.capabilities?.thinkingLevels?.includes("ultra"), false, "a level the kernel cannot name is not offered");
    }
  });

  it("openai_codex_not_signed_in_notes_and_registers", async () => {
    const slot = memorySlot();
    const agent = await createAgent(agentConfig({ slots: { credentials: slot.resolver } }));
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message === "openai-codex: not signed in");
      assert.equal(notes.length, 1, "a missing grant is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      const listed = await agent.models.list();
      assert.ok(
        listed.some((entry) => entry.model === model.model),
        "the catalog still lists",
      );
      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      assert.equal((result as { error?: { code?: string } }).error?.code, "openai_codex_reauthorize");
    } finally {
      await agent.dispose();
    }
  });

  it("openai_codex_env_credential_ref_rejected", async () => {
    await assert.rejects(
      () => createAgent(agentConfig({ packages: [openaiCodex({ credential: "env:OPENAI_CODEX_TOKEN", models: openAICodexModels })] })),
      (error: { code?: string; message?: string }) => error.code === "setup_failed" && (error.message ?? "").includes("refs are read-only"),
    );
    assert.equal(OPENAI_CODEX_DEFAULT_CREDENTIAL_REF, CREDENTIAL);
    assert.equal(openaiCodexDefinition.config?.properties?.credential?.default, CREDENTIAL);
    assert.equal(openaiCodexDefinition.config?.properties?.credential?.["x-prism-secret"], true);
  });

  it("openai_codex_setup_does_not_fetch", async () => {
    let fetches = 0;
    const agent = await createAgent(
      agentConfig({
        packages: [
          openaiCodex({
            credential: CREDENTIAL,
            appName: "Prism Tests",
            fetch: (async () => {
              fetches += 1;
              return completed("ok");
            }) as typeof fetch,
          }),
        ],
        slots: { credentials: memorySlot().resolver },
      }),
    );
    try {
      assert.equal(fetches, 0, "setup resolves the ref but never talks to the wire");
    } finally {
      await agent.dispose();
    }
  });

  it("list_openai_codex_models_filters_visibility", async () => {
    let url = "";
    const listed = await listOpenAICodexModels({
      apiKey: async () => KEY,
      fetch: (async (input: unknown) => {
        url = String(input);
        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "gpt-6.1-sol",
                display_name: "GPT-6.1-Sol",
                visibility: "list",
                context_window: 500_000,
                input_modalities: ["text", "image"],
                supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "ultra" }],
                supports_parallel_tool_calls: true,
              },
              { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", context_window: 272_000 },
              {
                slug: "gpt-6-luna",
                display_name: "GPT-6-Luna",
                visibility: "list",
                context_window: 272_000,
                auto_compact_token_limit: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    assert.equal(url, `${OPENAI_CODEX_DEFAULT_BASE_URL}/models`, "discovery makes one request to the documented endpoint");
    assert.deepEqual(
      listed.map((entry) => entry.model),
      ["gpt-6.1-sol", "gpt-6-luna"],
      "a hidden entry is not offered",
    );
    const first = listed[0]!;
    assert.equal(first.displayName, "GPT-6.1-Sol");
    assert.equal(first.limits?.contextWindow, 500_000);
    assert.deepEqual(first.capabilities?.input, ["text", "image"]);
    assert.deepEqual(first.capabilities?.thinkingLevels, ["low", "high"], "ultra is dropped");
    assert.equal(first.limits?.maxOutputTokens, undefined, "a null ceiling stays unknown rather than guessed");
    assert.equal(listed[1]?.limits?.maxOutputTokens, undefined);
  });

  it("direct_credential_slots_authorize_provider_and_discovery_without_refresh", async () => {
    const secret = credentialRecordToSecret({
      v: 1,
      clientId: "oaiapp_direct_fixture",
      hostId: "urn:uuid:11111111-2222-3333-4444-555555555555",
      access: KEY,
      refresh: "fixture-refresh-never-sent",
      expires: Date.now() + 3_600_000,
      scope: OPENAI_CODEX_SCOPE,
    });
    const stored: Secret[] = [];
    const slot = {
      resolve: async (ref: string) => {
        assert.equal(ref, CREDENTIAL);
        return secret;
      },
      store: async (_ref: string, value: Secret) => {
        stored.push(value);
      },
    };
    const calls: string[] = [];
    const provider = createOpenAICodexProvider({
      id: "codex-direct",
      credential: CREDENTIAL,
      credentialSource: slot,
      baseUrl: "https://codex.fixture.test/v1/",
      fetch: async (input, init) => {
        calls.push(String(input));
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${KEY}`);
        return completed("direct");
      },
    });
    const events = await collect(provider, request({ model: { ...model, provider: "codex-direct" } }));
    assert.ok(events.some((event) => event.type === "content_delta" && event.content.type === "text" && event.content.text === "direct"));
    const listed = await listOpenAICodexModels({
      provider: "codex-direct",
      credential: CREDENTIAL,
      credentialSource: slot,
      baseUrl: "https://codex.fixture.test/v1/",
      fetch: async (input, init) => {
        calls.push(String(input));
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${KEY}`);
        return Response.json({ data: [{ slug: "discovered", visibility: "list", auto_compact_token_limit: 123 }] });
      },
    });
    assert.deepEqual(calls, ["https://codex.fixture.test/v1/responses", "https://codex.fixture.test/v1/models"]);
    assert.equal(listed[0]?.provider, "codex-direct");
    assert.equal(listed[0]?.limits?.maxOutputTokens, 123);
    assert.deepEqual(stored, [], "an unexpired grant must neither refresh nor write to the slot");
  });

  it("model_discovery_http_failures_redact_the_grant", async () => {
    await assert.rejects(
      () => listOpenAICodexModels({ apiKey: async () => KEY, fetch: async () => failure(403, { error: `refused ${KEY}` }) }),
      (error: unknown) => error instanceof Error && /model discovery failed: 403/.test(error.message) && !error.message.includes(KEY),
    );
  });

  it("list_openai_codex_models_accepts_the_measured_catalog_size", async () => {
    // The live catalog carried 567 675 bytes on 2026-10-25 (per-model instruction text), well over the
    // transport's 64 KiB default, so discovery declares its own cap and still fails a runaway body.
    const entry = (slug: string) => ({
      slug,
      visibility: "list",
      context_window: 272_000,
      instructions: "x".repeat(500_000),
    });
    const catalog = JSON.stringify({ models: [entry("gpt-6-luna"), entry("gpt-6.1-sol")] });
    assert.equal(catalog.length > 64 * 1024, true);
    const listed = await listOpenAICodexModels({
      apiKey: async () => KEY,
      fetch: (async () => new Response(catalog, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    assert.deepEqual(
      listed.map((model) => model.model),
      ["gpt-6-luna", "gpt-6.1-sol"],
    );
    await assert.rejects(
      () =>
        listOpenAICodexModels({
          apiKey: async () => KEY,
          fetch: (async () =>
            new Response("x".repeat(OPENAI_CODEX_MODELS_MAX_BODY_BYTES + 1), {
              status: 200,
              headers: { "content-type": "application/json" },
            })) as typeof fetch,
        }),
      /exceeded/,
    );
  });

  it("openai_codex_replays_encrypted_reasoning_byte_equal", async () => {
    const recorded = JSON.parse(readFileSync(recording("structured-output"), "utf8")) as Array<{ responseBody: string }>;
    const reasoningItem = recorded[0]!.responseBody
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(
        (line) =>
          JSON.parse(line.slice(6)) as {
            type?: string;
            item?: { type?: string; id?: string; encrypted_content?: string; summary?: unknown[] };
          },
      )
      .find((event) => event.type === "response.output_item.done" && event.item?.type === "reasoning")?.item;
    assert.equal(reasoningItem?.encrypted_content, REASONING_PLACEHOLDER);

    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async (_input: unknown, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return completed("ok");
      }) as typeof fetch,
    });
    await collect(
      provider,
      request({
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", text: "", redacted: true, data: JSON.stringify({ provider: "openai-codex", item: reasoningItem }) },
              { type: "text", text: "ok" },
            ],
          },
          { role: "user", content: [{ type: "text", text: "again" }] },
        ],
      }),
    );
    const replayed = (body?.input as Array<Record<string, unknown>> | undefined)?.find((item) => item.type === "reasoning");
    // The payload round trips; only the empty `content` array the wire sends is not re-emitted.
    assert.equal(replayed?.id, reasoningItem?.id);
    assert.equal(replayed?.encrypted_content, reasoningItem?.encrypted_content, "the encrypted payload is byte-equal");
    assert.deepEqual(replayed?.summary, reasoningItem?.summary);

    // The same block sent to another provider is dropped: the payload is provider-bound.
    let foreignBody: Record<string, unknown> | undefined;
    const foreign = createOpenAICodexProvider({
      apiKey: async () => KEY,
      fetch: (async (_input: unknown, init: RequestInit) => {
        foreignBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return completed("ok");
      }) as typeof fetch,
    });
    await collect(
      foreign,
      request({
        model: { ...model, provider: "someone-else" },
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", text: "", redacted: true, data: JSON.stringify({ provider: "openai-codex", item: reasoningItem }) },
            ],
          },
          { role: "user", content: [{ type: "text", text: "again" }] },
        ],
      }),
    );
    const foreignReplay = (foreignBody?.input as Array<Record<string, unknown>> | undefined)?.find((item) => item.type === "reasoning");
    assert.equal(foreignReplay, undefined, "a foreign provider's reasoning is never replayed");
  });
});
