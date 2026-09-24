import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, JsonObject, ModelConfig, ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertNoSecretLeak, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import {
  createTypeSafeProvider,
  createTypeSafeProviderPackage,
  defineTypeSafeModel,
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_DEFAULT_BASE_URL,
  typeSafeModels,
} from "../index.js";

const schema: JsonObject = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["run", "reject", "ask"], description: "How should this be handled?" },
    irreversible: { type: "boolean", description: "Would running this destroy data?" },
  },
};

const model = typeSafeModels[0]!;

const request: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
  options: { structuredOutput: { name: "decision", schema } },
};

const OK_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    verdict: { type: "choice", choice: "ask", probabilities: { ask: 0.84 }, confidence: 0.68 },
    irreversible: { type: "noul", noul: 0.91 },
  },
  usage: { input_tokens: 96, output_tokens: 0 },
};

interface FakeCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function fakeFetch(handler: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function bodyOf(call: FakeCall): JsonObject {
  return JSON.parse(String(call.init?.body)) as JsonObject;
}

function textOf(events: readonly ProviderEvent[]): string {
  const delta = events.find((event) => event.type === "content_delta");
  assert.ok(delta && delta.type === "content_delta" && delta.content.type === "text", "one text delta");
  return delta.content.text;
}

describe("@arnilo/prism-providers/typesafe (provider shell)", () => {
  it("typesafe_package_registers_provider_models_and_auth", async () => {
    const registered: unknown[] = [];
    await createTypeSafeProviderPackage({ apiKey: "fake-key" }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (m: ModelConfig) => registered.push(m),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as never);
    assert.ok(
      registered.some((item) => (item as AIProvider).id === "typesafe"),
      "provider registered",
    );
    const models = registered.filter(
      (item): item is ModelConfig =>
        typeof item === "object" && item !== null && "model" in item && (item as ModelConfig).provider === "typesafe",
    );
    assert.deepEqual(
      models.map((entry) => entry.model),
      ["jev-latest", "jev-preview"],
    );
    assert.ok(models.every((entry) => entry.capabilities?.structuredOutput === "json_schema"));
    assert.deepEqual(
      registered.find((item) => (item as AuthMethod).kind === "api_key"),
      {
        kind: "api_key",
        provider: "typesafe",
        credentialName: "apiKey",
      },
    );
  });

  it("typesafe_models_declare_decision_capabilities_limits_and_cost", () => {
    assert.equal(TYPESAFE_DEFAULT_BASE_URL, "https://api.typesafe.ai");
    assert.equal(TYPESAFE_API_KEY_ENV, "TYPESAFE_API_KEY");
    for (const entry of typeSafeModels) {
      assert.deepEqual(entry.capabilities, {
        input: ["text"],
        output: ["text"],
        tools: false,
        streaming: false,
        structuredOutput: "json_schema",
      });
      assert.deepEqual(entry.limits, { contextWindow: 32_000, maxOutputTokens: 0 });
      assert.deepEqual(entry.cost, { input: 0.04, output: 0, currency: "USD", unit: "per_million_tokens" });
    }
    const pinned = defineTypeSafeModel({ model: "jev-1.13.0", displayName: "Jev 1.13.0" });
    assert.equal(pinned.provider, "typesafe");
    assert.equal(pinned.limits?.contextWindow, 32_000, "defaults apply to versioned pins");
  });

  it("typesafe_happy_path_compiles_questions_and_renders_schema_valid_json", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), request);
    assert.deepEqual(
      events.map((event) => event.type),
      ["message_start", "content_delta", "usage", "done"],
    );
    assert.equal(calls.length, 1, "one round trip per request");
    assert.equal(calls[0]!.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), "Bearer sk-secret");
    const body = bodyOf(calls[0]!);
    assert.equal(body.model, "jev-latest", "model id passes through verbatim");
    assert.equal(body.state, "rm -rf ./build");
    assert.deepEqual(body.questions, {
      verdict: {
        type: "choice",
        instructions: "How should this be handled?",
        criteria: { run: "run", reject: "reject", ask: "ask" },
      },
      irreversible: { type: "noul", instructions: "Would running this destroy data?" },
    });

    const rendered = JSON.parse(textOf(events));
    assert.deepEqual(rendered, { verdict: "ask", irreversible: true });
    assert.ok(["run", "reject", "ask"].includes(rendered.verdict), "enum membership");
    assert.equal(typeof rendered.irreversible, "boolean");

    const usageEvent = events.find((event) => event.type === "usage");
    assert.ok(usageEvent && usageEvent.type === "usage");
    assert.deepEqual(usageEvent.usage, { inputTokens: 96, outputTokens: 0, totalTokens: 96 });
    const done = events.at(-1);
    assert.ok(done && done.type === "done");
    assert.equal(done.stopReason, "end_turn");
    assert.deepEqual(done.usage, { inputTokens: 96, outputTokens: 0, totalTokens: 96 });
    assertNoSecretLeak(events, ["sk-secret"]);
  });

  it("typesafe_request_without_structured_output_fails_before_fetch", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), {
      model,
      messages: request.messages,
    });
    assert.equal(calls.length, 0, "no network call");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /structuredOutput/);
  });

  it("typesafe_tools_are_rejected_before_fetch", async () => {
    const tool: ToolDefinition = {
      name: "get_weather",
      description: "Get the weather.",
      parameters: { type: "object", properties: {} },
      execute: () => ({ toolCallId: "x", name: "get_weather", value: null }),
    };
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), {
      ...request,
      tools: [tool],
    });
    assert.equal(calls.length, 0, "no network call");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /tools/);
  });

  it("typesafe_auth_error_is_a_redacted_error_event_without_retry", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: { message: "bad key sk-secret", code: "invalid_api_key" } }, 401));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), request);
    assert.equal(calls.length, 1, "401 is never retried");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /401/);
    assert.ok(!terminal.error.message.includes("sk-secret"), "key redacted");
    assertNoSecretLeak(events, ["sk-secret"]);
  });

  it("typesafe_422_surfaces_the_api_field_detail_without_retry", async () => {
    const detail = "questions.verdict.criteria: expected at least 2 options";
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: { message: detail, code: "invalid_request" } }, 422));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), request);
    assert.equal(calls.length, 1, "422 is never retried");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /expected at least 2 options/);
  });

  it("typesafe_429_with_retry_after_retries_once_then_succeeds", async () => {
    let seen = 0;
    const { impl, calls } = fakeFetch(() => {
      seen += 1;
      if (seen === 1) return jsonResponse({ error: { message: "slow down" } }, 429, { "retry-after": "0" });
      return jsonResponse(OK_RESPONSE);
    });
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), request);
    assert.equal(calls.length, 2, "one retry");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "done");
    assert.deepEqual(JSON.parse(textOf(events)), { verdict: "ask", irreversible: true });
  });

  it("typesafe_boolean_threshold_knob_is_honored", async () => {
    const withNoul = (noul: number) => ({
      model: "jev-1.13.0",
      answers: { verdict: { type: "choice", choice: "run" }, irreversible: { type: "noul", noul } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const requestWithThreshold = {
      ...request,
      options: { structuredOutput: request.options!.structuredOutput, compat: { boolean_threshold: 0.9 } },
    };
    const high = fakeFetch(() => jsonResponse(withNoul(0.91)));
    const low = fakeFetch(() => jsonResponse(withNoul(0.6)));
    const highEvents = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: high.impl }), requestWithThreshold);
    const lowEvents = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: low.impl }), requestWithThreshold);
    assert.equal(JSON.parse(textOf(highEvents)).irreversible, true);
    assert.equal(JSON.parse(textOf(lowEvents)).irreversible, false, "0.6 stays below a 0.9 threshold");
  });

  it("typesafe_out_of_range_threshold_fails_before_fetch", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), {
      ...request,
      options: { structuredOutput: request.options!.structuredOutput, compat: { boolean_threshold: 1.5 } },
    });
    assert.equal(calls.length, 0, "no network call");
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /boolean_threshold/);
  });

  it("typesafe_base_url_override_trims_trailing_slashes", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    await collectProviderEvents(
      createTypeSafeProvider({ apiKey: "sk-secret", baseUrl: "https://proxy.example.test/jev/", fetch: impl }),
      request,
    );
    assert.equal(calls[0]!.url, "https://proxy.example.test/jev/v1/systemone");
  });

  it("typesafe_missing_api_key_omits_authorization", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    await collectProviderEvents(createTypeSafeProvider({ fetch: impl }), request);
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), null);
  });

  it("typesafe_abort_before_fetch_throws", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const provider = createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl });
    const controller = new AbortController();
    controller.abort(new Error("aborted by caller"));
    await assert.rejects(async () => {
      for await (const _event of provider.generate({ ...request, signal: controller.signal })) {
        void _event;
      }
    }, /aborted/);
    assert.equal(calls.length, 0, "fetch must not be called when signal is already aborted");
  });

  it("typesafe_unanswered_question_is_an_error_event", async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse({ model: "jev-1.13.0", answers: { verdict: { type: "choice", choice: "ask" } }, usage: { input_tokens: 5 } }),
    );
    const events = await collectProviderEvents(createTypeSafeProvider({ apiKey: "sk-secret", fetch: impl }), request);
    const terminal = events.at(-1);
    assert.ok(terminal && terminal.type === "error");
    assert.match(terminal.error.message, /irreversible/);
  });
});
