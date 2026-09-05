import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertModerationSupported,
  ModerationError,
  type ModerationProvider,
  type ModerationResult,
  modelSupportsModeration,
} from "../contracts.js";
import { runModerationConformance } from "../testing/provider-conformance.js";

/** Plan acceptance criterion: fake category mapping; unknown-category passthrough preserved. */
function fakeModerator(options: { extraCategories?: Record<string, { score: number; flagged: boolean }> } = {}): ModerationProvider {
  const classify = (input: string, model?: string): ModerationResult => {
    const categories: Record<string, { score: number; flagged: boolean }> = {
      hate: { score: input.includes("hate") ? 0.97 : 0.0002, flagged: input.includes("hate") },
      violence: { score: 0.01, flagged: false },
      ...options.extraCategories,
    };
    const flagged = Object.values(categories).some((verdict) => verdict.flagged);
    return {
      flagged,
      categories,
      raw: { provider_categories: Object.keys(categories) },
      model: model ?? "fake-moderation",
    };
  };
  return {
    id: "fake",
    async moderate(request) {
      if (typeof request.input === "string") {
        if (request.input.length === 0) throw new ModerationError("empty_input", "empty");
        if (request.input.length > 50) throw new ModerationError("input_too_large", "cap");
        return classify(request.input, request.model);
      }
      return request.input.map((input, index) => {
        if (input.length === 0) throw new ModerationError("empty_input", `empty batch item ${index}`);
        if (input.length > 50) throw new ModerationError("input_too_large", `batch item ${index}`);
        return classify(input, request.model);
      });
    },
  };
}

describe("moderation contract", () => {
  it("modelSupportsModeration_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsModeration(undefined), false);
    assert.equal(modelSupportsModeration({}), false);
    assert.equal(modelSupportsModeration({ moderation: true }), true);
  });

  it("assertModerationSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "omni-moderation-latest", capabilities: { speech: true } };
    assert.throws(
      () => assertModerationSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof ModerationError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("runModerationConformance_passes_fake_category_mapping", async () => {
    const result = await runModerationConformance({
      provider: fakeModerator(),
      model: "fake-moderation",
      maxInputChars: 50,
      sample: { input: "say hate words" },
    });
    assert.equal(result?.flagged, true, "provider flagged output passes through verbatim");
    assert.equal(result?.categories.hate?.score, 0.97, "scores are provider output — no local threshold");
  });

  it("runModerationConformance_preserves_unknown_category_passthrough", async () => {
    const result = await runModerationConformance({
      provider: fakeModerator({ extraCategories: { "brand-new-vendor-category": { score: 0.4, flagged: false } } }),
      model: "fake-moderation",
      sample: {},
    });
    assert.deepEqual(result?.categories["brand-new-vendor-category"], { score: 0.4, flagged: false });
  });

  it("runModerationConformance_fails_on_out_of_range_scores", async () => {
    const bad: ModerationProvider = {
      id: "fake",
      moderate: async (request) => {
        if ((typeof request.input === "string" ? request.input : request.input.join(" ")).length === 0)
          throw new ModerationError("empty_input", "empty");
        return { flagged: false, categories: { hate: { score: 1.5, flagged: false } } };
      },
    };
    await assert.rejects(() => runModerationConformance({ provider: bad, model: "m", sample: {} }), /must be a number in \[0,1\]/);
  });

  it("runModerationConformance_fails_on_oversized_input_that_resolves", async () => {
    const lax: ModerationProvider = {
      id: "fake",
      moderate: async (request) => {
        if ((typeof request.input === "string" ? request.input : request.input.join(" ")).length === 0)
          throw new ModerationError("empty_input", "empty");
        return {
          flagged: false,
          categories: { hate: { score: 0, flagged: false } },
          model: request.model,
        };
      },
    };
    await assert.rejects(() => runModerationConformance({ provider: lax, model: "m", maxInputChars: 10 }), /input_too_large/);
  });

  it("runModerationConformance_supports_batch_arity", async () => {
    const provider = fakeModerator();
    const results = await provider.moderate({ input: ["clean", "hate speech"], model: "fake-moderation" });
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 2);
    assert.equal((results as ModerationResult[])[1].flagged, true);
  });
});
