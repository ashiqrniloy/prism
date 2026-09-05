import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmbeddingsError } from "@arnilo/prism";
import { runEmbeddingsConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIEmbeddingsProvider, OPENAI_EMBEDDINGS_MAX_BATCH_SIZE } from "../index.js";

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: any;
}

function okResponse(
  entries: readonly { index: number; embedding: readonly number[] }[],
  usage?: { prompt_tokens: number; total_tokens: number },
): Response {
  return new Response(JSON.stringify({ object: "list", data: entries, usage }), { status: 200 });
}

function captureFetch(
  entries: readonly { index: number; embedding: readonly number[] }[],
  usage?: { prompt_tokens: number; total_tokens: number },
) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return okResponse(entries, usage);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createOpenAIEmbeddingsProvider", () => {
  it("posts_openai_embeddings_shape_with_bearer_and_optional_dimensions", async () => {
    const { fetchImpl, requests } = captureFetch([{ index: 0, embedding: [0.1, 0.2] }], { prompt_tokens: 5, total_tokens: 5 });
    const provider = createOpenAIEmbeddingsProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
    const result = await provider.embedMany({ model: "text-embedding-3-small", inputs: ["hello"] });
    assert.equal(requests[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-openai-secret");
    assert.equal(requests[0].body.model, "text-embedding-3-small");
    assert.deepEqual(requests[0].body.input, ["hello"]);
    assert.equal(requests[0].body.dimensions, undefined, "dimensions omitted unless requested");
    assert.deepEqual(result.vectors, [[0.1, 0.2]]);
    assert.deepEqual(result.usage, { inputTokens: 5, totalTokens: 5 });
    assert.equal(result.dimensions, 2, "dimensions default to the first vector length");
  });

  it("maps_response_entries_by_index_into_input_order", async () => {
    const { fetchImpl } = captureFetch([
      { index: 1, embedding: [2] },
      { index: 0, embedding: [1] },
    ]);
    const provider = createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: fetchImpl });
    assert.deepEqual((await provider.embedMany({ model: "m", inputs: ["a", "b"] })).vectors, [[1], [2]]);
  });

  it("requested_dimensions_are_sent_and_enforced_on_vectors", async () => {
    const { fetchImpl, requests } = captureFetch([{ index: 0, embedding: [1, 2] }]);
    const provider = createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const result = await provider.embedMany({ model: "m", inputs: ["a"], dimensions: 2 });
    assert.equal(requests[0].body.dimensions, 2);
    assert.equal(result.dimensions, 2);
    const mismatch = captureFetch([{ index: 0, embedding: [1, 2, 3] }]);
    await assert.rejects(
      () =>
        createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: mismatch.fetchImpl }).embedMany({
          model: "m",
          inputs: ["a"],
          dimensions: 2,
        }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "response_malformed");
        assert.match(error.message, /index 0/);
        return true;
      },
    );
  });

  it("empty_input_fails_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createOpenAIEmbeddingsProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return okResponse([]);
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.embedMany({ model: "m", inputs: [] }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("oversized_batch_fails_typed_at_the_openai_cap", async () => {
    const { fetchImpl } = captureFetch([]);
    const provider = createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const inputs = Array.from({ length: OPENAI_EMBEDDINGS_MAX_BATCH_SIZE + 1 }, () => "x");
    await assert.rejects(
      () => provider.embedMany({ model: "m", inputs }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "batch_too_large");
        assert.match(error.message, /2048/);
        return true;
      },
    );
  });

  it("malformed_response_missing_index_fails_typed", async () => {
    const { fetchImpl } = captureFetch([{ index: 0, embedding: [1] }]);
    const provider = createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await assert.rejects(
      () => provider.embedMany({ model: "m", inputs: ["a", "b"] }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "response_malformed");
        assert.match(error.message, /missing index 1/);
        return true;
      },
    );
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const provider = createOpenAIEmbeddingsProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.embedMany({ model: "m", inputs: ["x"] }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("401"), `status surfaced: ${error.message}`);
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("passes_embeddings_conformance_with_fake_transport", async () => {
    const { fetchImpl } = captureFetch(
      [0, 1, 2].map((index) => ({ index, embedding: [0.1, 0.2, 0.3] })),
      { prompt_tokens: 3, total_tokens: 3 },
    );
    await runEmbeddingsConformance({
      provider: createOpenAIEmbeddingsProvider({ apiKey: "sk-x", fetch: fetchImpl }),
      model: "text-embedding-3-small",
      maxBatchSize: OPENAI_EMBEDDINGS_MAX_BATCH_SIZE,
      sample: { inputs: ["a", "b", "c"], dimensions: 3 },
    });
  });
});
