import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeneratedImage, ImageGenerationProvider, ImageGenerationResult } from "../contracts.js";
import { assertImageGenerationSupported, ImageGenerationError, modelSupportsImageGeneration } from "../contracts.js";
import { runImageGenerationConformance } from "../testing/provider-conformance.js";

function fakeImage(bytes: readonly number[] = [1, 2, 3], provider = "fake"): ImageGenerationProvider {
  return {
    id: provider,
    async generate(request) {
      if (request.prompt.length === 0) throw new ImageGenerationError("empty_input", "empty");
      if (request.prompt.length > 100) throw new ImageGenerationError("input_too_large", "cap");
      return { images: [{ bytes: new Uint8Array(bytes), mimeType: "image/png", provider, model: request.model }] };
    },
    async edit(request) {
      if (request.images.length === 0) throw new ImageGenerationError("empty_input", "no image");
      return { images: [{ bytes: new Uint8Array(bytes), mimeType: "image/png", provider, model: request.model }] };
    },
  };
}

describe("image generation contract", () => {
  it("modelSupportsImageGeneration_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsImageGeneration(undefined), false);
    assert.equal(modelSupportsImageGeneration({}), false);
    assert.equal(modelSupportsImageGeneration({ imageGeneration: true }), true);
  });

  it("assertImageGenerationSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "gpt-image-1", capabilities: { speech: true } };
    assert.throws(
      () => assertImageGenerationSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("runImageGenerationConformance_passes_fake_provider_probes", async () => {
    const result = await runImageGenerationConformance({
      provider: fakeImage(),
      model: "gpt-image-1",
      maxPromptChars: 100,
      sample: { prompt: "a red cube", count: 1 },
    });
    assert.equal(result?.images[0]?.mimeType, "image/png");
  });

  it("runImageGenerationConformance_fails_on_oversized_prompt_that_resolves", async () => {
    const lax: ImageGenerationProvider = {
      id: "fake",
      generate: async (request) => {
        if (request.prompt.length === 0) throw new ImageGenerationError("empty_input", "empty");
        return { images: [{ bytes: new Uint8Array([1]), mimeType: "image/png", provider: "fake", model: request.model }] };
      },
      edit: async () => ({ images: [] }),
    };
    await assert.rejects(() => runImageGenerationConformance({ provider: lax, model: "m", maxPromptChars: 3 }), /input_too_large/);
  });

  it("runImageGenerationConformance_fails_on_wrong_image_count", async () => {
    await assert.rejects(
      () => runImageGenerationConformance({ provider: fakeImage(), model: "m", sample: { count: 2 } }),
      /image count 1 must match requested 2/,
    );
  });

  it("runImageGenerationConformance_fails_on_broken_provenance", async () => {
    const provider = fakeImage([1, 2, 3], "fake");
    const original = (await provider.generate({ model: "m", prompt: "x" })) as ImageGenerationResult & { images: GeneratedImage[] };
    provider.generate = async (request) => {
      if (request.prompt.length === 0) throw new ImageGenerationError("empty_input", "empty");
      return { images: [{ ...original.images[0], provider: "someone-else" }] };
    };
    await assert.rejects(
      () => runImageGenerationConformance({ provider, model: "m", sample: {} }),
      /provenance provider someone-else must be preserved/,
    );
  });
});
