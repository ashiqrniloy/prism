import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "bun:test";
import type { JsonObject } from "@arnilo/prism";
import { loadProviderPackage } from "@arnilo/prism/testing";
import { assertAbortIsObserved, assertNoFetches, assertNoForeignCacheFields } from "@arnilo/prism/provider-kit";
import { createVertexProvider, vertex, vertexOpenApiBaseUrl } from "../index.js";

describe("@arnilo/prism-provider-vertex", () => {
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

  it("setup stays inert with zero fetch", async () => {
    const calls: unknown[] = [];
    const pkg = vertex({
      project: "p",
      location: "us-central1",
      credential: "env:PRISM_TEST_VERTEX_KEY",
      models: [{ provider: "vertex", model: "m" }],
      fetch: (async (...args: Parameters<typeof fetch>) => {
        calls.push(args[0]);
        throw new Error("should not fetch");
      }) as typeof fetch,
    });
    await loadProviderPackage(pkg);
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
      options: { sessionId: "s1", cacheKey: "session-1", cacheRetention: "long", cache: { breakpoints: [{ location: "system_prompt" }] } },
    })) {
      /* drain */
    }
    assertNoForeignCacheFields(body);
  });

  it("package stays separate from the google provider package and has no runtime deps", () => {
    const pkg = vertex({
      project: "p",
      location: "us-central1",
      credential: "env:PRISM_TEST_VERTEX_KEY",
    });
    assert.equal(pkg.definition.name, "@arnilo/prism-provider-vertex");
    assert.notEqual(pkg.definition.name, "@arnilo/prism-provider-google");
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.equal(JSON.stringify(manifest).includes("@arnilo/prism-provider-google"), false);
  });

  it("forwards_sanitized_reasoning_compat_and_snaps_gemini_levels", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createVertexProvider({
      projectId: "proj-1",
      location: "europe-west1",
      credential: async () => "adc-token",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    const gemini = { provider: "vertex", model: "google/gemini-2.0-flash-001" } as const;
    const generate = async (compat?: JsonObject) => {
      for await (const _event of provider.generate({
        model: gemini,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        options: { compat },
      })) {
        /* drain */
      }
    };
    // Gemini on Vertex: xhigh snaps to high (declared low/medium/high).
    await generate({ reasoning_effort: "xhigh" });
    assert.equal(body!.reasoning_effort, "high");
    await generate();
    assert.equal(body!.reasoning_effort, undefined);
    await generate({ route: "x", reasoning_effort: "low" });
    assert.equal(body!.reasoning_effort, "low");
    assert.equal(body!.route, undefined);
  });
});
