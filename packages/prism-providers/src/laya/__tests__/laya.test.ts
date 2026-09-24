import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, JsonObject, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertNoSecretLeak, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import {
  createLayaProvider,
  createLayaProviderPackage,
  DEFAULT_LAYA_BASE_URL,
  LAYA_API_KEY_ENV,
  layaBaseUrl,
  layaModels,
} from "../index.js";

const schema: JsonObject = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["run", "reject"], description: "How should this be handled?" },
  },
};

const model = layaModels[0]!;

const request: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
  options: { structuredOutput: { name: "decision", schema } },
};

const OK_RESPONSE = {
  model: "laya-router-picked",
  answers: { verdict: { type: "choice", choice: "reject" } },
  usage: { input_tokens: 12, output_tokens: 4 },
};

interface FakeCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function fakeFetch(handler: () => Response) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler();
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textOf(events: readonly ProviderEvent[]): string {
  const delta = events.find((event) => event.type === "content_delta");
  assert.ok(delta && delta.type === "content_delta" && delta.content.type === "text");
  return delta.content.text;
}

describe("@arnilo/prism-providers/laya", () => {
  it("laya_package_registers_provider_three_models_and_auth", async () => {
    const registered: unknown[] = [];
    await createLayaProviderPackage().setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (entry: ModelConfig) => registered.push(entry),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as never);
    assert.ok(registered.some((item) => (item as AIProvider).id === "laya"));
    const models = registered.filter(
      (item): item is ModelConfig =>
        typeof item === "object" && item !== null && "model" in item && (item as ModelConfig).provider === "laya",
    );
    assert.deepEqual(
      models.map((entry) => entry.model),
      ["laya", "laya-multilingual", "laya-typed-decisions"],
    );
    assert.deepEqual(
      models.map((entry) => entry.limits?.contextWindow),
      [512, 1024, 1024],
    );
    assert.ok(models.every((entry) => entry.limits?.maxOutputTokens === 0));
    assert.ok(models.every((entry) => entry.capabilities?.structuredOutput === "json_schema" && entry.capabilities.tools === false));
    assert.equal(models[1]?.metadata?.extendedContextWindow, 8192);
    assert.ok(models.every((entry) => entry.cost?.input === 0 && entry.cost.output === 0));
    assert.deepEqual(
      registered.find((item) => (item as AuthMethod).kind === "api_key"),
      {
        kind: "api_key",
        provider: "laya",
        credentialName: "apiKey",
      },
    );
    assert.equal(DEFAULT_LAYA_BASE_URL, "http://localhost:8000");
    assert.equal(LAYA_API_KEY_ENV, "LAYA_API_KEY");
    assert.equal(layaBaseUrl(), DEFAULT_LAYA_BASE_URL);
  });

  it("laya_happy_path_posts_advisory_model_and_renders_json", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const events = await collectProviderEvents(createLayaProvider({ fetch: impl }), request);
    assert.deepEqual(
      events.map((event) => event.type),
      ["message_start", "content_delta", "usage", "done"],
    );
    assert.equal(calls[0]!.url, "http://localhost:8000/v1/systemone");
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), null);
    const body = JSON.parse(String(calls[0]!.init?.body)) as JsonObject;
    assert.equal(body.model, "laya", "model id is advisory and passes through verbatim");
    assert.equal(JSON.parse(textOf(events)).verdict, "reject");
    assert.equal(textOf(events).includes("laya-router-picked"), false, "server model is not rewritten into output");
    const done = events.at(-1);
    assert.ok(done && done.type === "done" && done.stopReason === "end_turn");
  });

  it("laya_api_key_sends_bearer", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    await collectProviderEvents(createLayaProvider({ apiKey: "sk-secret", fetch: impl }), request);
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), "Bearer sk-secret");
  });

  it("laya_base_url_override_trims_trailing_slash", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    await collectProviderEvents(createLayaProvider({ baseUrl: "https://laya.example.com/", fetch: impl }), request);
    assert.equal(calls[0]!.url, "https://laya.example.com/v1/systemone");
    assert.equal(layaBaseUrl({ baseUrl: "https://10.0.0.5:8443/" }), "https://10.0.0.5:8443");
  });

  it("laya_plaintext_non_loopback_warns_but_still_posts", async () => {
    const seen: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      seen.push(String(message));
    };
    try {
      const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
      const events = await collectProviderEvents(
        createLayaProvider({ baseUrl: "http://10.0.0.5:8443", apiKey: "sk-secret", fetch: impl }),
        request,
      );
      assert.equal(calls[0]!.url, "http://10.0.0.5:8443/v1/systemone");
      assert.equal(events.at(-1)?.type, "done", "plaintext remote still proceeds");
      assert.equal(seen.length, 1);
      assert.match(seen[0]!, /plaintext/);
      assert.match(seen[0]!, /https:\/\//);
      assert.match(seen[0]!, /10\.0\.0\.5/);
      assert.equal(seen[0]!.includes("sk-secret"), false);

      seen.length = 0;
      layaBaseUrl({ baseUrl: "https://laya.example.com" });
      layaBaseUrl({ baseUrl: "http://localhost:8000" });
      layaBaseUrl({ baseUrl: "http://127.0.0.1:8000/" });
      layaBaseUrl({ baseUrl: "http://[::1]:8000" });
      assert.equal(seen.length, 0, "https and loopback stay silent");

      layaBaseUrl({ baseUrl: "http://user:s3cret@10.1.2.3:8000" });
      const userinfoWarning = seen[0] ?? "";
      assert.match(userinfoWarning, /10\.1\.2\.3/);
      assert.equal(userinfoWarning.includes("s3cret"), false, "warning drops userinfo");
    } finally {
      console.warn = original;
    }
  });

  it("laya_422_surfaces_field_detail_and_401_is_auth", async () => {
    const detail = "questions.verdict.criteria: expected at least 2 options";
    const invalid = fakeFetch(() => jsonResponse({ error: { message: detail, code: "invalid_request" } }, 422));
    const invalidEvents = await collectProviderEvents(createLayaProvider({ fetch: invalid.impl }), request);
    assert.equal(invalid.calls.length, 1);
    const invalidTerminal = invalidEvents.at(-1);
    assert.ok(invalidTerminal && invalidTerminal.type === "error");
    assert.match(invalidTerminal.error.message, /expected at least 2 options/);

    const denied = fakeFetch(() => jsonResponse({ error: { message: "bad key sk-secret" } }, 401));
    const deniedEvents = await collectProviderEvents(createLayaProvider({ apiKey: "sk-secret", fetch: denied.impl }), request);
    assert.equal(denied.calls.length, 1, "401 is not retried");
    const deniedTerminal = deniedEvents.at(-1);
    assert.ok(deniedTerminal && deniedTerminal.type === "error");
    assert.match(deniedTerminal.error.message, /401/);
    assert.equal(deniedTerminal.error.message.includes("sk-secret"), false);
    assertNoSecretLeak(deniedEvents, ["sk-secret"]);
  });

  it("laya_gates_fail_before_fetch", async () => {
    const missing = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const missingEvents = await collectProviderEvents(createLayaProvider({ fetch: missing.impl }), {
      model,
      messages: request.messages,
    });
    assert.equal(missing.calls.length, 0);
    const missingTerminal = missingEvents.at(-1);
    assert.ok(missingTerminal && missingTerminal.type === "error");
    assert.match(missingTerminal.error.message, /structuredOutput/);

    const tooled = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const tooledEvents = await collectProviderEvents(createLayaProvider({ fetch: tooled.impl }), {
      ...request,
      tools: [
        {
          name: "x",
          description: "x",
          parameters: { type: "object", properties: {} },
          execute: () => ({ toolCallId: "x", name: "x", value: null }),
        },
      ],
    });
    assert.equal(tooled.calls.length, 0);
    const tooledTerminal = tooledEvents.at(-1);
    assert.ok(tooledTerminal && tooledTerminal.type === "error");
    assert.match(tooledTerminal.error.message, /tools/);
  });
});
