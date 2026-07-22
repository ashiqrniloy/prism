import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, Message, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import {
  GOOGLE_DEFAULT_BASE_URL,
  createGoogleGenerateContentProvider,
  createGoogleProviderPackage,
  googleModels,
  listGoogleModels,
  mapGoogleModel,
} from "../index.js";

const model: ModelConfig = googleModels[0]!;

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "assistant", content: [{ type: "thinking", text: "prior reasoning", signature: "sig" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "sess-1" },
};

describe("@arnilo/prism-provider-google", () => {
  it("registers_featured_models_and_setup_does_not_fetch", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return ok(sse([]));
    }) as typeof fetch;
    const registered: unknown[] = [];
    await createGoogleProviderPackage({ apiKey: "fake-google-key", fetch: fetchImpl }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (item: ModelConfig) => registered.push(item),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert.equal(fetchCalls, 0);
    assert(registered.some((item: any) => item.id === "google"));
    assert.deepEqual(registered.filter((item: any) => item?.kind), [{ kind: "api_key", provider: "google", credentialName: "apiKey" }]);
    assert(registered.some((item: any) => item.model === "gemini-2.5-pro"));
    assert(registered.some((item: any) => item.model === "gemini-2.5-flash"));
    assert(registered.some((item: any) => item.model === "gemini-3.5-flash"));
    assert.equal(GOOGLE_DEFAULT_BASE_URL, "https://generativelanguage.googleapis.com/v1beta");
  });

  it("streams_text_thinking_tool_calls_usage", async () => {
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: mockFetch(sse([
        {
          candidates: [{
            content: {
              parts: [
                { text: "plan", thought: true },
                { text: "hello" },
                { functionCall: { id: "tool_1", name: "lookup", args: { q: "y" } } },
              ],
            },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 3,
            cachedContentTokenCount: 1,
            thoughtsTokenCount: 2,
            totalTokenCount: 9,
          },
        },
      ])),
    });
    const events = await assertProviderStreamConforms({
      provider,
      request,
      expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, totalTokens: 9 } },
    });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "plan"));
    assert(events.some((event: ProviderEvent) => event.type === "tool_call" && event.call.id === "tool_1" && event.call.name === "lookup"));
    assert.equal(events.at(-1)?.type, "done");
  });

  it("preserves_thinking_blocks_and_maps_max_tokens_thinking_config", async () => {
    let body: any;
    let url = "";
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: (async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return ok(sse([{ candidates: [{ finishReason: "STOP" }] }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        model: { ...model, parameters: { maxTokens: 444, temperature: 0.2 } },
        options: {
          ...request.options,
          compat: { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } },
        },
      },
    });
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse");
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "instructions" }] });
    assert.deepEqual(body.contents[0].parts[0], { text: "prior reasoning", thought: true, thoughtSignature: "sig" });
    assert.equal(body.generationConfig.maxOutputTokens, 444);
    assert.equal(body.generationConfig.maxTokens, undefined);
    assert.equal(body.generationConfig.temperature, 0.2);
    assert.deepEqual(body.generationConfig.thinkingConfig, { includeThoughts: true, thinkingBudget: 1024 });
    assert.equal(body.tools[0].functionDeclarations[0].name, "lookup");
  });

  it("serializes_image_and_pdf_inline_data", async () => {
    const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const tinyPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64");
    const replay: ProviderRequest = {
      model,
      messages: [{
        role: "user",
        content: [
          // Gemini inlineData has no filename field — omit name so coverage canaries match wire.
          { type: "image", mimeType: "image/png", data: tinyPng },
          { type: "document", mediaType: "application/pdf", data: tinyPdf },
        ],
      }],
    };
    let body: unknown;
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([{ candidates: [{ finishReason: "STOP" }] }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
    const serialized = JSON.stringify(body);
    assert.match(serialized, /"inlineData"/);
    assert.match(serialized, /image\/png/);
    assert.match(serialized, /application\/pdf/);
  });

  it("keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: (async (_url, init) => {
        headers = new Headers(init?.headers);
        return ok(sse([{ candidates: [{ finishReason: "STOP" }] }]));
      }) as typeof fetch,
    });
    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: {
          ...request.options,
          headers: {
            authorization: "Bearer attacker",
            "content-type": "text/plain",
            "x-goog-api-key": "attacker-key",
            "x-caller": "kept",
          },
        },
      },
    });
    assertProviderOwnedHeadersWin(headers, {
      owned: {
        "content-type": "application/json",
        "x-goog-api-key": "fake-google-key",
        "x-client-request-id": "sess-1",
      },
      caller: {
        authorization: "Bearer attacker",
        "content-type": "text/plain",
        "x-goog-api-key": "attacker-key",
        "x-caller": "kept",
      },
    });
    assert.equal(headers.get("x-caller"), "kept");
  });

  it("observes_abort_and_redacts_secrets_in_errors", async () => {
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: (async () => new Response("boom fake-google-key", { status: 401 })) as typeof fetch,
    });
    await assertAbortIsObserved({ provider, request });
    const events = await collectProviderEvents(provider, request);
    assert.equal(events.at(-1)?.type, "error");
    assertNoSecretLeak(events, ["fake-google-key"]);
  });

  it("list_google_models_maps_fixture_and_forwards_auth_abort_baseurl", async () => {
    let url = "";
    let method = "";
    let headers: Headers | undefined;
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const models = await listGoogleModels({
      apiKey: "fake-google-key",
      baseUrl: "https://google.example/v1beta",
      signal: controller.signal,
      fetch: (async (input, init) => {
        url = String(input);
        method = init?.method ?? "GET";
        headers = new Headers(init?.headers);
        signal = init?.signal ?? null;
        return Response.json({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              inputTokenLimit: 1_048_576,
              outputTokenLimit: 65_536,
              supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            },
            {
              name: "models/embedding-001",
              displayName: "Embedding 001",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        });
      }) as typeof fetch,
    });
    assert.equal(method, "GET");
    assert.equal(url, "https://google.example/v1beta/models");
    assert.equal(headers?.get("x-goog-api-key"), "fake-google-key");
    assert.equal(signal, controller.signal);
    assert.equal(models.length, 1);
    assert.equal(models[0]!.model, "gemini-2.5-flash");
    assert.equal(models[0]!.displayName, "Gemini 2.5 Flash");
    assert.equal(models[0]!.limits?.contextWindow, 1_048_576);
  });

  it("list_google_models_redacts_token_in_errors", async () => {
    await assert.rejects(
      () => listGoogleModels({
        apiKey: "fake-google-key",
        fetch: (async () => new Response("unauthorized fake-google-key", { status: 401 })) as typeof fetch,
      }),
      (error: unknown) => {
        const message = String(error);
        assert.ok(!message.includes("fake-google-key"));
        assert.match(message, /Google model discovery failed: 401/);
        return true;
      },
    );
  });

  it("map_google_model_rejects_malformed_entry", () => {
    assert.throws(() => mapGoogleModel({ name: "" } as any), /missing name/);
    assert.throws(() => mapGoogleModel(undefined as any), /missing name/);
  });

  it("truncated_stream_fails_closed", async () => {
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: mockFetch(sse([
        { candidates: [{ content: { parts: [{ text: "partial" }] } }] },
      ])),
    });
    const events = await collectProviderEvents(provider, request);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(String((events.at(-1) as { error?: { message?: string } }).error?.message), /completion evidence/);
  });

  it("serializes_tool_result_as_function_response", async () => {
    let body: any;
    const provider = createGoogleGenerateContentProvider({
      apiKey: "fake-google-key",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return ok(sse([{ candidates: [{ finishReason: "STOP" }] }]));
      }) as typeof fetch,
    });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "weather?" }] },
      { role: "assistant", content: [{ type: "tool_call", id: "c1", name: "lookup", arguments: { q: "paris" } }] },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "lookup", result: { temp: 72 } }] },
    ];
    await assertProviderStreamConforms({ provider, request: { ...request, messages, tools: undefined } });
    assert.equal(body.contents[1].role, "model");
    assert.deepEqual(body.contents[1].parts[0].functionCall, { id: "c1", name: "lookup", args: { q: "paris" } });
    assert.equal(body.contents[2].role, "user");
    assert.deepEqual(body.contents[2].parts[0].functionResponse, { name: "lookup", response: { result: { temp: 72 } } });
  });
});

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () => ok(body)) as typeof fetch;
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
