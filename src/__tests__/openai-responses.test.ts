import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { createOpenAIResponsesProvider } from "../provider-kit/openai-responses.js";

const sse = (events: readonly unknown[]): Response =>
  new Response([...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), "data: [DONE]\n\n"].join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const request: ProviderRequest = {
  model: { provider: "openai", model: "gpt-5.1" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

describe("@arnilo/prism/provider-kit (openai-responses)", () => {
  it("provider_kit_openai_responses_wire_round_trips", async () => {
    let captured: RequestInit | undefined;
    const provider = createOpenAIResponsesProvider({
      apiKey: "sk-test",
      baseUrl: "https://fake.test/v1",
      fetch: (async (_url: string, init: RequestInit) => {
        captured = init;
        return sse([
          { type: "response.output_text.delta", delta: "hello" },
          { type: "response.completed", response: { status: "completed", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
        ]);
      }) as typeof fetch,
    });

    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(request)) events.push(event);

    const body = JSON.parse(captured?.body as string) as { model?: string; stream?: boolean; input?: unknown };
    assert.equal(body.model, "gpt-5.1");
    assert.equal(body.stream, true);
    assert.deepEqual(body.input, [{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
    assert.deepEqual(events, [
      { type: "content_delta", content: { type: "text", text: "hello" } },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, cacheReadTokens: undefined, cacheWriteTokens: undefined } },
      {
        type: "done",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        stopReason: "end_turn",
      },
    ]);
  });
});
