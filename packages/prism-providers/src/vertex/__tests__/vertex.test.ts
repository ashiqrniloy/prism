import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assertAbortIsObserved, assertNoFetches, assertNoForeignCacheFields } from "@arnilo/prism/testing/provider-conformance";
import { createVertexProvider, createVertexProviderPackage, vertexOpenApiBaseUrl } from "../index.js";

describe("@arnilo/prism-providers/vertex", () => {
  it("preserves location/project endpoint and uses ADC bearer token", async () => {
    const seen: { url?: string; auth?: string } = {};
    const provider = createVertexProvider({
      projectId: "proj-1",
      location: "europe-west1",
      credential: async () => "adc-token",
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.auth = new Headers(init?.headers).get("authorization") ?? undefined;
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "vertex", model: "google/gemini-2.0-flash-001" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(
      seen.url,
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/proj-1/locations/europe-west1/endpoints/openapi/chat/completions",
    );
    assert.equal(seen.auth, "Bearer adc-token");
    assert.ok(events.some((event) => event.type === "done"));
  });

  it("fails closed without credential and keeps custom endpoint host", async () => {
    const missing = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      credential: async () => undefined,
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const events = [];
    for await (const event of missing.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(events[0]?.type, "error");

    let url = "";
    const custom = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      endpoint: "https://vertex.private.example/v1/openai",
      credential: "tok",
      fetch: async (input) => {
        url = String(input);
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    for await (const _ of custom.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      /* drain */
    }
    assert.equal(url, "https://vertex.private.example/v1/openai/chat/completions");
    assert.equal(
      vertexOpenApiBaseUrl({ projectId: "p", location: "us-central1" }),
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi",
    );
  });

  it("setup stays inert with zero fetch and zero credential resolution", async () => {
    const calls: unknown[] = [];
    const pkg = createVertexProviderPackage({
      projectId: "p",
      location: "us-central1",
      credential: () => {
        calls.push("credential");
        return "t";
      },
      models: [{ provider: "vertex", model: "m" }],
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
    const provider = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      credential: () => "t",
      fetch: (async () => new Response("data: [DONE]\n\n", { status: 200 })) as typeof fetch,
    });
    await assertAbortIsObserved({
      provider,
      request: { model: { provider: "vertex", model: "m" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    });
  });

  it("truncated stream without done fails loudly", async () => {
    const provider = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      credential: () => "t",
      fetch: (async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { status: 200 })) as typeof fetch,
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("native Vertex cached-content lifecycle is unsupported and no cache hints reach the OpenAI-compatible body", async () => {
    let body: any;
    const provider = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      credential: () => "t",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }) as typeof fetch,
    });
    for await (const _ of provider.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { cacheKey: "session-1", cacheRetention: "long", cache: { breakpoints: [{ location: "system_prompt" }] } },
    })) {
      /* drain */
    }
    assertNoForeignCacheFields(body);
  });

  it("package stays separate from consumer google and has no runtime deps", () => {
    const pkg = createVertexProviderPackage({
      projectId: "p",
      location: "us-central1",
      credential: () => "t",
    });
    assert.equal(pkg.name, "@arnilo/prism-providers/vertex");
    assert.notEqual(pkg.name, "@arnilo/prism-providers/google");
    const google = readFileSync(new URL("../../../src/google/index.ts", import.meta.url), "utf8");
    assert.ok(!google.includes("provider-vertex"));
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });
});
