import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible.js";
import type { ProviderEvent } from "../index.js";

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
        JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
        "[DONE]",
      ]),
    });

    assert.deepEqual(await collect(provider), [
      { type: "usage", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
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
});
