import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbeddingsProvider, EmbeddingsResult } from "../contracts.js";
import { assertEmbeddingsSupported, EmbeddingsError, modelSupportsEmbeddings } from "../contracts.js";
import { runEmbeddingsConformance } from "../testing/provider-conformance.js";

function fakeProvider(result: Partial<EmbeddingsResult> & { vectors?: (readonly number[])[] }): EmbeddingsProvider {
  return {
    id: "fake",
    async embedMany(request) {
      if (request.inputs.length === 0) throw new EmbeddingsError("empty_input", "empty");
      if (request.inputs.length > 3) throw new EmbeddingsError("batch_too_large", "cap");
      const vectors = result.vectors ?? request.inputs.map(() => [0.1, 0.2, 0.3]);
      return { vectors, usage: result.usage ?? {}, dimensions: result.dimensions ?? 3 };
    },
  };
}

describe("embeddings contract", () => {
  it("modelSupportsEmbeddings_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsEmbeddings(undefined), false);
    assert.equal(modelSupportsEmbeddings({}), false);
    assert.equal(modelSupportsEmbeddings({ embeddings: true }), true);
    assert.equal(modelSupportsEmbeddings({ embeddings: false }), false);
  });

  it("assertEmbeddingsSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "text-embedding-3-small", capabilities: { tools: true } };
    assert.throws(
      () => assertEmbeddingsSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof EmbeddingsError);
        assert.equal(error.code, "unsupported_model");
        assert.match(error.message, /openai\/text-embedding-3-small/);
        return true;
      },
    );
    assert.doesNotThrow(() => assertEmbeddingsSupported({ provider: "openai", model: "m", capabilities: { embeddings: true } }));
  });

  it("runEmbeddingsConformance_passes_fake_provider_probes", async () => {
    const result = await runEmbeddingsConformance({
      provider: fakeProvider({}),
      model: "text-embedding-3-small",
      maxBatchSize: 3,
      sample: { inputs: ["a", "b"], dimensions: 3 },
    });
    assert.equal(result?.dimensions, 3);
  });

  it("runEmbeddingsConformance_fails_on_vector_count_mismatch", async () => {
    await assert.rejects(
      () =>
        runEmbeddingsConformance({
          provider: fakeProvider({ vectors: [[0.1]] }),
          model: "m",
          sample: { inputs: ["a", "b"] },
        }),
      /vector count 1 must match input count 2/,
    );
  });

  it("runEmbeddingsConformance_fails_on_non_finite_vectors", async () => {
    await assert.rejects(
      () =>
        runEmbeddingsConformance({
          provider: fakeProvider({ vectors: [[Number.NaN]] }),
          model: "m",
          sample: { inputs: ["a"] },
        }),
      /finite/,
    );
  });

  it("runEmbeddingsConformance_fails_on_dimensions_mismatch", async () => {
    await assert.rejects(
      () =>
        runEmbeddingsConformance({
          provider: fakeProvider({ dimensions: 3 }),
          model: "m",
          sample: { inputs: ["a"], dimensions: 7 },
        }),
      /dimensions 3 must match expected 7/,
    );
  });

  it("runEmbeddingsConformance_fails_when_oversized_batch_resolves", async () => {
    await assert.rejects(() => runEmbeddingsConformance({ provider: fakeProvider({}), model: "m", maxBatchSize: 2 }), /batch_too_large/);
  });
});
