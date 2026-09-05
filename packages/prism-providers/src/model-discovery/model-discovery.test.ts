import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelConfig } from "@arnilo/prism";
import {
  createFakeModelDiscovery,
  createGoogleModelDiscovery,
  createOpenAiCompatibleModelDiscovery,
  ModelDiscoveryError,
  mergeModelCatalog,
  runModelDiscoveryConformance,
} from "./index.js";

/** Counting injected transport: returns scripted envelopes and records request URLs/headers. */
function scriptedFetch(
  envelopes: unknown[],
  options: { readonly status?: number } = {},
): {
  fetch: typeof fetch;
  readonly requests: { readonly url: string; readonly headers: Record<string, string> }[];
} {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  let calls = 0;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url: String(input), headers });
    const body = envelopes[Math.min(calls, envelopes.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status: options.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: transport, requests };
}

const catalogOverride: ModelConfig = {
  provider: "openai-compatible",
  model: "gpt-mini",
  displayName: "GPT Mini (host)",
  capabilities: { input: ["text", "image"], output: ["text"], tools: true, streaming: true, reasoning: true },
  limits: { contextWindow: 200_000, maxOutputTokens: 8_192 },
  cost: { input: 0.15, output: 0.6, currency: "usd", unit: "1M" },
};

describe("createOpenAiCompatibleModelDiscovery", () => {
  it("normalizes {data:[{id}]} to ModelConfig, merges catalog overrides, and caches within TTL", async () => {
    const { fetch, requests } = scriptedFetch([{ data: [{ id: "gpt-mini" }, { id: "gpt-big", owned_by: "org" }] }]);
    const discovery = createOpenAiCompatibleModelDiscovery({
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-test",
      catalog: [catalogOverride],
      fetch,
    });
    const first = await discovery.listModels();
    assert.equal(first.provenance.source, "api");
    assert.equal(first.provenance.provider, "openai-compatible");
    assert.ok(!Number.isNaN(Date.parse(first.provenance.fetchedAt)));
    assert.equal(first.models.length, 2);
    // Catalog override merges capability/limits/cost fields over the normalized entry.
    assert.equal(first.models[0]!.model, "gpt-mini");
    assert.equal((first.models[0]!.capabilities as { tools?: boolean }).tools, true);
    assert.equal((first.models[0]!.limits as { contextWindow?: number }).contextWindow, 200_000);
    assert.equal(first.models[0]!.displayName, "GPT Mini (host)");
    // Non-catalog entries stay untouched passthrough.
    assert.deepEqual(first.models[1], { provider: "openai-compatible", model: "gpt-big" });

    // Forced refresh (ttlMs: 0) re-fetches and re-merges deterministically.
    const merged = await discovery.listModels({ ttlMs: 0 });
    assert.deepEqual(merged.models, first.models);

    // TTL honored: second call within the window serves the cache (no network).
    const cached = createOpenAiCompatibleModelDiscovery({
      baseUrl: "https://gw.example/v1",
      catalog: [catalogOverride],
      fetch,
      ttlMs: 3_600_000,
    });
    const a = await cached.listModels();
    const b = await cached.listModels();
    assert.equal(requests.length, 3); // 1 + forced refresh + cached call adds none
    assert.equal(b.provenance.fetchedAt, a.provenance.fetchedAt);
    assert.equal(b.provenance.ttlMs, 3_600_000);

    // Bearer credential rides the request; egress stays on the configured base URL.
    assert.equal(requests[0]!.headers.authorization, "Bearer sk-test");
    assert.equal(requests[0]!.url, "https://gw.example/v1/models");
  });

  it("throws typed errors on HTTP failures, bad envelopes, and missing ids", async () => {
    const failure = scriptedFetch([{ error: "boom" }], { status: 503 });
    const discovery = createOpenAiCompatibleModelDiscovery({ baseUrl: "https://gw.example/v1", apiKey: "sk-test", fetch: failure.fetch });
    await assert.rejects(discovery.listModels(), (error: unknown) => {
      assert.ok(error instanceof ModelDiscoveryError);
      assert.equal(error.provider, "openai-compatible");
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /sk-test/); // credential never leaks into errors
      return true;
    });

    const badEnvelope = scriptedFetch([{ models: [] }]);
    await assert.rejects(
      createOpenAiCompatibleModelDiscovery({ baseUrl: "https://gw.example/v1", fetch: badEnvelope.fetch }).listModels(),
      ModelDiscoveryError,
    );
    const noId = scriptedFetch([{ data: [{ owned_by: "org" }] }]);
    await assert.rejects(
      createOpenAiCompatibleModelDiscovery({ baseUrl: "https://gw.example/v1", fetch: noId.fetch }).listModels(),
      ModelDiscoveryError,
    );
  });

  it("passes network-free conformance through an injected transport", async () => {
    await runModelDiscoveryConformance(() =>
      createOpenAiCompatibleModelDiscovery({
        baseUrl: "http://127.0.0.1:1/v1",
        catalog: [catalogOverride],
        fetch: scriptedFetch([{ data: [{ id: "gpt-mini" }] }]).fetch,
      }),
    );
  });
});

describe("createGoogleModelDiscovery", () => {
  it("normalizes {models:[…]} with limits/capabilities and follows nextPageToken", async () => {
    const { fetch, requests } = scriptedFetch([
      {
        models: [
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 8_192,
            thinking: true,
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/gemini-embed", supportedGenerationMethods: ["embedContent"] },
        ],
        nextPageToken: "page-2",
      },
      { models: [{ name: "models/gemini-flash", inputTokenLimit: 32_768 }] },
    ]);
    const discovery = createGoogleModelDiscovery({ apiKey: "gk-test", fetch });
    const result = await discovery.listModels();
    assert.equal(result.provenance.provider, "google");
    assert.deepEqual(
      result.models.map((m) => m.model),
      ["gemini-pro", "gemini-embed", "gemini-flash"],
    );
    assert.equal((result.models[0]!.limits as { contextWindow?: number }).contextWindow, 1_048_576);
    assert.equal((result.models[0]!.capabilities as { reasoning?: boolean }).reasoning, true);
    assert.equal((result.models[1]!.capabilities as { embeddings?: boolean }).embeddings, true);
    assert.equal(result.models[2]!.displayName, undefined);
    // Auth header + pagination query params.
    assert.equal(requests[0]!.headers["x-goog-api-key"], "gk-test");
    assert.match(requests[0]!.url, /pageSize=1000$/);
    assert.match(requests[1]!.url, /pageToken=page-2/);
  });

  it("requires an apiKey and passes conformance through an injected transport", async () => {
    await assert.rejects(
      createGoogleModelDiscovery({ apiKey: "", fetch: scriptedFetch([{ models: [] }]).fetch }).listModels(),
      ModelDiscoveryError,
    );
    await runModelDiscoveryConformance(() =>
      createGoogleModelDiscovery({ apiKey: "gk-test", fetch: scriptedFetch([{ models: [{ name: "models/gemini-pro" }] }]).fetch }),
    );
  });
});

describe("createFakeModelDiscovery + runModelDiscoveryConformance", () => {
  it("serves a catalog snapshot network-free and passes conformance", async () => {
    await runModelDiscoveryConformance(createFakeModelDiscovery);
    const discovery = createFakeModelDiscovery({
      provider: "fake",
      models: [{ provider: "fake", model: "m1", capabilities: { tools: true } }],
    });
    const result = await discovery.listModels();
    assert.equal(result.provenance.source, "catalog");
    assert.equal(result.provenance.provider, "fake");
    assert.equal(result.models[0]!.model, "m1");
    // Repeated calls are identical (deterministic snapshot).
    const again = await discovery.listModels({ ttlMs: 0 });
    assert.deepEqual(again, result);
  });
});

describe("mergeModelCatalog", () => {
  it("overrides matching ids and leaves the rest untouched", () => {
    const normalized: ModelConfig[] = [
      { provider: "p", model: "a" },
      { provider: "p", model: "b" },
    ];
    const merged = mergeModelCatalog(normalized, [{ provider: "p", model: "a", limits: { contextWindow: 128 } }]);
    assert.deepEqual(merged[0], { provider: "p", model: "a", limits: { contextWindow: 128 } });
    assert.deepEqual(merged[1], { provider: "p", model: "b" });
    assert.deepEqual(mergeModelCatalog(normalized, undefined), normalized);
  });
});
