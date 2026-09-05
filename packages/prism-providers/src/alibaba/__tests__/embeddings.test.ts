import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmbeddingsError } from "@arnilo/prism";
import { runEmbeddingsConformance } from "@arnilo/prism/testing/provider-conformance";
import {
  ALIBABA_EMBEDDING_BATCH_SIZE,
  ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS,
  createAlibabaEmbedder,
  createAlibabaEmbeddingsProvider,
} from "../index.js";

// Compile-time structural assignability: the embedder must satisfy the
// @arnilo/prism-memory `Embedder` shape without importing it (no dependency).
type EmbedderShape = {
  readonly dimensions: number;
  embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
};
const _assignable: EmbedderShape = createAlibabaEmbedder({ model: "text-embedding-v4" });

function embeddingResponse(entries: readonly { index: number; embedding: readonly number[] }[]): Response {
  return new Response(JSON.stringify({ object: "list", data: entries, model: "text-embedding-v4" }), { status: 200 });
}

describe("createAlibabaEmbedder", () => {
  it("posts_openai_embeddings_shape_with_bearer_and_default_dimensions", async () => {
    let url = "";
    let headers: Headers | undefined;
    let body: any;
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-dashscope-secret",
      model: "text-embedding-v4",
      fetch: (async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return embeddingResponse([{ index: 0, embedding: [0.1, 0.2] }]);
      }) as typeof fetch,
    });
    const vectors = await embedder.embed(["hello"]);
    assert.equal(url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings");
    assert.equal(headers?.get("authorization"), "Bearer sk-dashscope-secret");
    assert.equal(headers?.get("content-type"), "application/json");
    assert.equal(body.model, "text-embedding-v4");
    assert.equal(embedder.id, "text-embedding-v4");
    assert.deepEqual(body.input, ["hello"]);
    assert.equal(body.dimensions, ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS);
    assert.equal(body.encoding_format, "float");
    assert.deepEqual(vectors, [[0.1, 0.2]]);
  });

  it("custom_dimensions_and_encoding_format_pass_through", async () => {
    let body: any;
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v3",
      dimensions: 512,
      encodingFormat: "base64",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return embeddingResponse([{ index: 0, embedding: [1] }]);
      }) as typeof fetch,
    });
    assert.equal(embedder.dimensions, 512);
    await embedder.embed(["x"]);
    assert.equal(body.dimensions, 512);
    assert.equal(body.encoding_format, "base64");
  });

  it("maps_response_entries_by_index_into_input_order", async () => {
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async () =>
        embeddingResponse([
          { index: 1, embedding: [2] },
          { index: 0, embedding: [1] },
          { index: 2, embedding: [3] },
        ])) as typeof fetch,
    });
    assert.deepEqual(await embedder.embed(["a", "b", "c"]), [[1], [2], [3]]);
  });

  it("empty_input_returns_empty_without_fetching", async () => {
    let fetchCalls = 0;
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async () => {
        fetchCalls += 1;
        return embeddingResponse([]);
      }) as typeof fetch,
    });
    assert.deepEqual(await embedder.embed([]), []);
    assert.equal(fetchCalls, 0);
  });

  it("chunks_inputs_at_the_dashscope_batch_cap_preserving_order", async () => {
    const bodies: any[] = [];
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return embeddingResponse(body.input.map((_: string, i: number) => ({ index: i, embedding: [i] })));
      }) as typeof fetch,
    });
    const texts = Array.from({ length: ALIBABA_EMBEDDING_BATCH_SIZE + 2 }, (_, i) => `t${i}`);
    const vectors = await embedder.embed(texts);
    assert.equal(bodies.length, 2, "12 inputs must split into 2 requests");
    assert.equal(bodies[0].input.length, ALIBABA_EMBEDDING_BATCH_SIZE);
    assert.equal(bodies[1].input.length, 2);
    assert.deepEqual(
      vectors,
      texts.map((_, i) => [i % ALIBABA_EMBEDDING_BATCH_SIZE]),
    );
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-dashscope-secret",
      model: "text-embedding-v4",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-dashscope-secret" } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(
      () => embedder.embed(["x"]),
      (error: Error) => {
        assert.ok(error.message.includes("401"), `status surfaced: ${error.message}`);
        assert.ok(!error.message.includes("sk-dashscope-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("caller_headers_cannot_override_provider_owned_headers", async () => {
    let headers: Headers | undefined;
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-dashscope-secret",
      model: "text-embedding-v4",
      headers: { authorization: "Bearer attacker", "content-type": "text/plain" },
      fetch: (async (_input, init) => {
        headers = new Headers(init?.headers);
        return embeddingResponse([{ index: 0, embedding: [1] }]);
      }) as typeof fetch,
    });
    await embedder.embed(["x"]);
    assert.equal(headers?.get("authorization"), "Bearer sk-dashscope-secret");
    assert.equal(headers?.get("content-type"), "application/json");
  });

  it("passes_the_abort_signal_through_to_fetch", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async (_input, init) => {
        seenSignal = init?.signal ?? undefined;
        return embeddingResponse([{ index: 0, embedding: [1] }]);
      }) as typeof fetch,
    });
    await embedder.embed(["x"], { signal: controller.signal });
    assert.equal(seenSignal, controller.signal);
  });

  it("abort_mid_embed_rejects_with_abort_error", async () => {
    const controller = new AbortController();
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async (_input, init) => {
        const signal = init?.signal;
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
        });
        return embeddingResponse([{ index: 0, embedding: [1] }]);
      }) as typeof fetch,
    });
    const pending = embedder.embed(["x"], { signal: controller.signal });
    controller.abort(new Error("aborted"));
    await assert.rejects(() => pending, /aborted/);
  });

  it("missing_response_index_fails_loudly", async () => {
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async () => embeddingResponse([{ index: 0, embedding: [1] }])) as typeof fetch,
    });
    await assert.rejects(() => embedder.embed(["a", "b"]), /missing index 1/);
  });
});

describe("createAlibabaEmbeddingsProvider", () => {
  it("posts_openai_embeddings_shape_and_maps_usage", async () => {
    let body: any;
    const provider = createAlibabaEmbeddingsProvider({
      apiKey: "sk-x",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { index: 0, embedding: [1] },
              { index: 1, embedding: [2] },
            ],
            usage: { prompt_tokens: 7, total_tokens: 7 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const result = await provider.embedMany({ model: "text-embedding-v4", inputs: ["a", "b"] });
    assert.equal(body.model, "text-embedding-v4");
    assert.deepEqual(body.input, ["a", "b"]);
    assert.equal(body.dimensions, ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS, "provider default dimensions when request omits it");
    assert.deepEqual(result.vectors, [[1], [2]]);
    assert.deepEqual(result.usage, { inputTokens: 7, totalTokens: 7 });
    assert.equal(result.dimensions, 1, "result dimensions report the actual vector length");
  });

  it("request_dimensions_override_the_provider_default", async () => {
    let body: any;
    const provider = createAlibabaEmbeddingsProvider({
      apiKey: "sk-x",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return embeddingResponse([{ index: 0, embedding: [1] }]);
      }) as typeof fetch,
    });
    const result = await provider.embedMany({ model: "text-embedding-v4", inputs: ["a"], dimensions: 512 });
    assert.equal(body.dimensions, 512);
    assert.equal(result.dimensions, 1);
  });

  it("strict_batch_cap_and_empty_input_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createAlibabaEmbeddingsProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return embeddingResponse([]);
      }) as typeof fetch,
    });
    const oversized = Array.from({ length: ALIBABA_EMBEDDING_BATCH_SIZE + 1 }, () => "x");
    await assert.rejects(
      () => provider.embedMany({ model: "text-embedding-v4", inputs: oversized }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "batch_too_large");
        assert.match(error.message, /at most 10/);
        return true;
      },
    );
    await assert.rejects(
      () => provider.embedMany({ model: "text-embedding-v4", inputs: [] }),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("passes_embeddings_conformance_with_fake_transport", async () => {
    const provider = createAlibabaEmbeddingsProvider({
      apiKey: "sk-x",
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        return embeddingResponse(body.input.map((_: string, i: number) => ({ index: i, embedding: [0.1, 0.2] })));
      }) as typeof fetch,
    });
    await runEmbeddingsConformance({
      provider,
      model: "text-embedding-v4",
      maxBatchSize: ALIBABA_EMBEDDING_BATCH_SIZE,
      sample: { inputs: ["a", "b"], dimensions: 2 },
    });
  });

  it("structural_bridge_keeps_the_embedder_assignable_to_the_memory_host_seam", async () => {
    // The embedder chunks at the DashScope cap even though the strict provider would reject oversized batches.
    const embedder = createAlibabaEmbedder({
      apiKey: "sk-x",
      model: "text-embedding-v4",
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        return embeddingResponse(body.input.map((_: string, i: number) => ({ index: i, embedding: [1] })));
      }) as typeof fetch,
    });
    const texts = Array.from({ length: ALIBABA_EMBEDDING_BATCH_SIZE + 1 }, () => "t");
    assert.equal((await embedder.embed(texts)).length, ALIBABA_EMBEDDING_BATCH_SIZE + 1);
  });
});
