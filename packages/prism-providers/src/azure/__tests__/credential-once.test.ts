import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAzureOpenAIProvider } from "../index.js";

describe("@arnilo/prism-providers/azure credential resolution", () => {
  it("resolves a rotating CredentialValueSource exactly once per request (resolveCredentialValue)", async () => {
    // T10: the wrapper and the inner OpenAI-compatible provider must not each
    // resolve the credential — a rotating source would be consumed twice and
    // the two reads could yield different tokens.
    let calls = 0;
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => {
        calls += 1;
        return `token-${calls}`;
      },
      fetch: async (_input, _init) => {
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "azure", model: "gpt-4o" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);

    assert.equal(calls, 1, "credential must be resolved once per request");
    assert.ok(
      events.some((event) => event.type === "done"),
      "stream completes with the single resolved token",
    );
  });

  it("re-resolves the credential for each request", async () => {
    let calls = 0;
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => {
        calls += 1;
        return "token";
      },
      fetch: async () =>
        new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const request = {
      model: { provider: "azure", model: "gpt-4o" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    } as const;
    for await (const _event of provider.generate(request)) {
      // drain
    }
    for await (const _event of provider.generate(request)) {
      // drain
    }
    assert.equal(calls, 2, "each request gets its own resolution");
  });
});
