import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AZURE_OPENAI_DEFAULT_API_VERSION,
  azureChatCompletionsUrl,
  createAzureOpenAIProvider,
  createAzureOpenAIProviderPackage,
} from "../index.js";

async function collect(provider: ReturnType<typeof createAzureOpenAIProvider>) {
  const events = [];
  for await (const event of provider.generate({
    model: { provider: "azure", model: "gpt-4o" },
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  }))
    events.push(event);
  return events;
}

describe("@arnilo/prism-provider-azure", () => {
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
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
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
        return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    await collect(keyed);
    assert.equal(apiKey, "azure-key");
  });

  it("package factory registers provider without runtime deps", () => {
    const pkg = createAzureOpenAIProviderPackage({
      endpoint: "https://demo.openai.azure.com",
      deployment: "d1",
      credential: () => "t",
      models: [{ provider: "azure", model: "gpt-4o" }],
    });
    assert.equal(pkg.name, "@arnilo/prism-provider-azure");
    assert.equal(
      azureChatCompletionsUrl({
        endpoint: "https://demo.openai.azure.com",
        deployment: "x",
      }).includes(AZURE_OPENAI_DEFAULT_API_VERSION),
      true,
    );
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });
});
