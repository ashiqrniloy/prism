import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message, ProviderEvent, ProviderRequest } from "../index.js";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { assertSerializedRequestCoversContent } from "../testing/provider-conformance.js";

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
      generate: (request) =>
        provider.generate({
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
        JSON.stringify({
          choices: [],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
            prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 5 },
          },
        }),
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
      fetch: okFetch([JSON.stringify({ choices: [{ delta: { reasoning_content: "think" } }] }), "[DONE]"]),
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
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"id"' } }] } }],
        }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"1"}' } }] } }] }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "tool_call_delta", index: 0, id: "call_1", name: "lookup", argumentsText: '{"id"' },
      { type: "tool_call_delta", index: 0, id: undefined, name: undefined, argumentsText: ':"1"}' },
      { type: "tool_call", call: { type: "tool_call", id: "call_1", name: "lookup", arguments: { id: "1" } } },
      { type: "done", usage: undefined },
    ]);
  });

  it("fails truncated incomplete tool calls with incomplete_delta instead of done", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { arguments: '{"a":' } }] } }] }),
        "[DONE]",
      ]),
    });

    const events = await collect(provider);
    assert.equal(
      events.some((event) => event.type === "done"),
      false,
    );
    const error = events.find((event) => event.type === "error");
    assert.equal(error?.type, "error");
    if (error?.type === "error") {
      assert.equal(error.error.code, "incomplete_delta");
      assert.match(error.error.message, /Incomplete tool call delta at index 0/);
    }
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
        {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "image", url: "https://example.invalid/img.png" },
          ],
        },
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
      messages: [{ role: "user", content: [{ type: "text", text: "ok" }] }, "[Circular]" as unknown as Message],
    } satisfies ProviderRequest;

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request)) events.push(event);
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, "expected provider error event");
    assert.match(String(errorEvent.error?.message ?? errorEvent.error), /Invalid provider message at messages\[1\]: expected object/);
  });

  it("applies buildBodyExtra over the base body", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      buildBodyExtra: (request) => ({ thinking: { type: "enabled" }, model_seen: request.model.model }),
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect(provider);

    assert.equal(body?.model_seen, "demo");
    assert.deepEqual(body?.thinking, { type: "enabled" });
    assert.equal(body?.stream, true);
  });

  it("applies mapMessages before serialization", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      mapMessages: (request) => [{ role: "system", content: [{ type: "text", text: "marker" }] }, ...request.messages],
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect(provider);

    const messages = body?.messages as { role: string }[];
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, "system");
  });

  it("uses mapUsage override when provided", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      mapUsage: (usage) => ({ inputTokens: 99, outputTokens: 0, totalTokens: 99, raw: usage }) as never,
      fetch: okFetch([JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }), "[DONE]"]),
    });

    const events = await collect(provider);
    assert.deepEqual(events[0], {
      type: "usage",
      usage: { inputTokens: 99, outputTokens: 0, totalTokens: 99, raw: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
    });
  });

  it("merges extraHeaders while provider auth still wins", async () => {
    let headers = new Headers();
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "real-key",
      extraHeaders: () => ({ "http-referer": "https://app.example", "x-title": "app", authorization: "Bearer attacker" }),
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect(provider);

    assert.equal(headers.get("http-referer"), "https://app.example");
    assert.equal(headers.get("x-title"), "app");
    assert.equal(headers.get("authorization"), "Bearer real-key");
  });

  it("transformBody runs last and wins over base fields", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      buildBodyExtra: () => ({ vendor: 1 }),
      transformBody: (body) => ({ ...body, max_tokens: 42, vendor: 2 }),
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(sse(["[DONE]"]), { status: 200 });
      }) as typeof fetch,
    });

    await collect(provider);

    assert.equal(body?.max_tokens, 42);
    assert.equal(body?.vendor, 2);
    assert.equal(body?.stream, true);
  });

  it("strictCompletion fails truncated streams and carries usage in done", async () => {
    const truncated = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      strictCompletion: true,
      fetch: okFetch([JSON.stringify({ choices: [{ delta: { content: "partial" } }] })]),
    });
    const truncatedEvents = await collect(truncated);
    assert.equal(truncatedEvents.at(-1)?.type, "error");
    assert.match(String((truncatedEvents.at(-1) as { error?: { message?: string } }).error?.message), /without completion evidence/);

    const complete = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      strictCompletion: true,
      fetch: okFetch([
        JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
        "[DONE]",
      ]),
    });
    const events = await collect(complete);
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type === "done") {
      assert.equal(done.usage?.inputTokens, 1);
      assert.equal(done.usage?.outputTokens, 2);
      assert.equal(done.usage?.totalTokens, 3);
    }
  });

  it("uses requestFailedPrefix for HTTP errors", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      requestFailedPrefix: "Vendor request failed",
      fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
    });

    const [event] = await collect(provider);
    assert.equal(event?.type, "error");
    if (event?.type === "error") assert.match(event.error.message, /^Vendor request failed: 500/);
  });

  it("throws when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createOpenAICompatibleProvider({ baseUrl: "https://example.test/v1", fetch: okFetch(["[DONE]"]) });

    await assert.rejects(async () => {
      for await (const _ of provider.generate({
        model: { provider: provider.id, model: "demo" },
        messages: [],
        signal: controller.signal,
      })) {
        void _;
      }
    });
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
    })) {
      void _;
    }
    assert.deepEqual(body?.response_format, {
      type: "json_schema",
      json_schema: { name: "answer", schema, strict: true },
    });
  });
});
