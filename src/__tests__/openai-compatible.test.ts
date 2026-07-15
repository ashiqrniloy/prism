import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { assertSerializedRequestCoversContent } from "../testing/provider-conformance.js";
import type { ProviderEvent, ProviderRequest, Message } from "../index.js";

function sse(lines: readonly string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      controller.close();
    },
  });
}

async function collect(provider = createOpenAICompatibleProvider({ baseUrl: "https://example.test", fetch: okFetch([]) })) {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate({
    model: { provider: provider.id, model: "demo" },
    messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })) {
    events.push(event);
  }
  return events;
}

function okFetch(lines: readonly string[]): typeof fetch {
  return async () => new Response(sse(lines), { status: 200 });
}

describe("openai-compatible provider", () => {
  it("keeps provider-owned headers after caller headers", async () => {
    let headers = new Headers();
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "real-key",
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect({
      ...provider,
      generate: (request) => provider.generate({
        ...request,
        options: { headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } },
      }),
    });

    assert.equal(headers.get("authorization"), "Bearer real-key");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("x-caller"), "kept");
  });

  it("maps streaming text to provider events", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1/",
      fetch: okFetch([
        JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "content_delta", content: { type: "text", text: "Hel" } },
      { type: "content_delta", content: { type: "text", text: "lo" } },
      { type: "done", usage: undefined },
    ]);
  });

  it("maps usage and done", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch([
        JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 5 } } }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "usage", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5 } },
      { type: "done", usage: undefined },
    ]);
  });

  it("maps reasoning content to thinking deltas", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch([
        JSON.stringify({ choices: [{ delta: { reasoning_content: "think" } }] }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "content_delta", content: { type: "thinking", text: "think", signature: undefined } },
      { type: "done", usage: undefined },
    ]);
  });

  it("reconstructs tool call fragments", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"id\"" } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":\"1\"}" } }] } }] }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "tool_call_delta", index: 0, id: "call_1", name: "lookup", argumentsText: "{\"id\"" },
      { type: "tool_call_delta", index: 0, id: undefined, name: undefined, argumentsText: ":\"1\"}" },
      { type: "tool_call", call: { type: "tool_call", id: "call_1", name: "lookup", arguments: { id: "1" } } },
      { type: "done", usage: undefined },
    ]);
  });

  it("passes abort signal to fetch", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: (async (_url, init) => {
        seen = init?.signal as AbortSignal | null | undefined;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    for await (const _ of provider.generate({
      model: { provider: provider.id, model: "demo" },
      messages: [],
      signal: controller.signal,
    })) {
      // drain
    }

    assert.equal(seen, controller.signal);
  });

  it("redacts api key from errors", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-123",
      fetch: (async () => new Response("bad sk-test-123", { status: 401 })) as typeof fetch,
    });

    const [event] = await collect(provider);

    assert.equal(event?.type, "error");
    if (event?.type === "error") {
      assert.equal(event.error.message.includes("sk-test-123"), false);
      assert.equal(event.error.message.includes("[REDACTED]"), true);
    }
  });

  it("passes generic request headers", async () => {
    let headers: Headers;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: (async (_url, init) => {
        headers = new Headers(init?.headers);
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    for await (const _ of provider.generate({
      model: { provider: provider.id, model: "demo" },
      messages: [],
      options: { headers: { "x-demo": "1" } },
    })) {
      // drain
    }

    assert.equal(headers!.get("x-demo"), "1");
  });

  it("uses injected fetch only", async () => {
    let called = false;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: (async () => {
        called = true;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect(provider);

    assert.equal(called, true);
  });

  it("serializes_tool_result_replay_and_images_or_fails_explicitly", async () => {
    const request: ProviderRequest = {
      model: { provider: "openai-compatible", model: "demo", capabilities: { input: ["text", "image"] } },
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", url: "https://example.invalid/img.png" }] },
      ],
    };
    let body: unknown;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request)) events.push(event);
    assert.equal(events.at(-1)?.type, "done");
    assertSerializedRequestCoversContent(request, body);
  });

  it("rejects malformed messages with indexed diagnostics and no payload dump", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch(["[DONE]"]),
    });
    const request = {
      model: { provider: provider.id, model: "demo" },
      messages: [
        { role: "user", content: [{ type: "text", text: "ok" }] },
        "[Circular]" as unknown as Message,
      ],
    } satisfies ProviderRequest;

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request)) events.push(event);
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, "expected provider error event");
    assert.match(String(errorEvent.error?.message ?? errorEvent.error), /Invalid provider message at messages\[1\]: expected object/);
  });

  it("maps structuredOutput to OpenAI response_format when supported", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });
    const schema = { type: "object", properties: { title: { type: "string" } } };
    for await (const _ of provider.generate({
      model: { provider: provider.id, model: "demo", capabilities: { structuredOutput: "json_schema" } },
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      options: { structuredOutput: { name: "answer", schema, strict: true } },
    })) { void _; }
    assert.deepEqual(body?.response_format, {
      type: "json_schema",
      json_schema: { name: "answer", schema, strict: true },
    });
  });
});
