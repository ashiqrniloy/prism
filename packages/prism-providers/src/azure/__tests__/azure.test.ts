import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assertAbortIsObserved, assertNoFetches, assertNoForeignCacheFields } from "@arnilo/prism/testing/provider-conformance";
import {
  AZURE_OPENAI_DEFAULT_API_VERSION,
  azureChatCompletionsUrl,
  createAzureOpenAIProvider,
  createAzureOpenAIProviderPackage,
} from "../index.js";

async function collect(provider: ReturnType<typeof createAzureOpenAIProvider>, overrides?: Record<string, unknown>) {
  const events = [];
  for await (const event of provider.generate({
    model: { provider: "azure", model: "gpt-4o" },
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    ...overrides,
  }))
    events.push(event);
  return events;
}

describe("@arnilo/prism-providers/azure", () => {
  it("preserves private endpoint and deployment on request URL", async () => {
    const seen: { url?: string; auth?: string; apiKey?: string } = {};
    const provider = createAzureOpenAIProvider({
      endpoint: "https://my-resource.privatelink.openai.azure.com",
      deployment: "chat-deploy",
      apiVersion: "2024-10-21",
      credential: () => "entra-token",
      authStyle: "bearer",
      fetch: async (input, init) => {
        seen.url = String(input);
        const headers = new Headers(init?.headers);
        seen.auth = headers.get("authorization") ?? undefined;
        seen.apiKey = headers.get("api-key") ?? undefined;
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = await collect(provider);
    assert.equal(
      seen.url,
      "https://my-resource.privatelink.openai.azure.com/openai/deployments/chat-deploy/chat/completions?api-version=2024-10-21",
    );
    assert.equal(seen.auth, "Bearer entra-token");
    assert.equal(seen.apiKey, undefined);
    assert.ok(events.some((event) => event.type === "content_delta"));
    assert.ok(events.some((event) => event.type === "done"));
  });

  it("fails closed when credential missing and supports api-key auth", async () => {
    const missing = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: async () => undefined,
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const events = await collect(missing);
    assert.equal(events[0]?.type, "error");

    let apiKey: string | null = null;
    const keyed = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: "azure-key",
      authStyle: "api-key",
      fetch: async (_input, init) => {
        apiKey = new Headers(init?.headers).get("api-key");
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    await collect(keyed);
    assert.equal(apiKey, "azure-key");
  });

  it("setup stays inert with zero fetch and zero credential resolution", async () => {
    const calls: unknown[] = [];
    const pkg = createAzureOpenAIProviderPackage({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => {
        calls.push("credential");
        return "t";
      },
      models: [{ provider: "azure", model: "gpt-4o" }],
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls.push(args[0]);
        throw new Error("should not fetch");
      }) as typeof fetch,
    });
    await pkg.setup({
      registerProvider: () => {},
      registerModel: () => {},
      registerAuthMethod: () => {},
    } as any);
    assertNoFetches(calls);
  });

  it("observes an already-aborted signal", async () => {
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => "t",
      fetch: (async () => new Response("data: [DONE]\n\n", { status: 200 })) as typeof fetch,
    });
    await assertAbortIsObserved({
      provider,
      request: { model: { provider: "azure", model: "gpt-4o" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    });
  });

  it("truncated stream without done fails loudly", async () => {
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => "t",
      fetch: (async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { status: 200 })) as typeof fetch,
    });
    const events = await collect(provider);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("unsupported cache hints are omitted from the request body", async () => {
    let body: any;
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => "t",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens_details":{"cached_tokens":2}}}\n\ndata: [DONE]\n\n',
          {
            status: 200,
          },
        );
      }) as typeof fetch,
    });
    const events = await collect(provider, {
      options: { cacheKey: "session-1", cacheRetention: "long", cache: { breakpoints: [{ location: "system_prompt" }] } },
    });
    assertNoForeignCacheFields(body);
    const usage = events.find((event) => event.type === "usage")?.usage;
    assert.equal(usage?.cacheReadTokens, 2);
  });

  it("package factory registers provider without runtime deps", () => {
    const pkg = createAzureOpenAIProviderPackage({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => "t",
      models: [{ provider: "azure", model: "gpt-4o" }],
    });
    assert.equal(pkg.name, "@arnilo/prism-providers/azure");
    assert.equal(
      azureChatCompletionsUrl({
        endpoint: "https://demo.openai.azure.com",
        deployment: "x",
      }).includes(AZURE_OPENAI_DEFAULT_API_VERSION),
      true,
    );
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });

  it("forwards_sanitized_reasoning_compat_and_snaps_to_family_levels", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createAzureOpenAIProvider({
      endpoint: "https://demo.openai.azure.com",
      credential: () => "t",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    const generate = (model: Record<string, unknown>, compat?: Record<string, unknown>) =>
      collect(provider, { model, options: { compat } });

    // gpt-5.1 deployment + xhigh → snapped high via the OpenAI family heuristic.
    await generate({ provider: "azure", model: "gpt-5.1" }, { reasoning_effort: "xhigh" });
    assert.equal(body!.reasoning_effort, "high");
    // reasoning object: effort snapped, summary preserved.
    await generate({ provider: "azure", model: "gpt-5.1" }, { reasoning: { effort: "xhigh", summary: "auto" } });
    assert.deepEqual(body!.reasoning, { effort: "high", summary: "auto" });
    // No thinking compat → field absent.
    await generate({ provider: "azure", model: "gpt-4o" });
    assert.equal(body!.reasoning_effort, undefined);
    assert.equal(body!.reasoning, undefined);
    // Unrecognized compat keys never reach the body.
    await generate({ provider: "azure", model: "gpt-4o" }, { route: "anthropic", preserveThinking: true, reasoning_effort: "low" });
    assert.equal(body!.reasoning_effort, "low");
    assert.equal(body!.route, undefined);
    assert.equal(body!.preserveThinking, undefined);
  });
});
