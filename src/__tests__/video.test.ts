import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentBlockInputModality, MODEL_INPUT_CAPABILITIES } from "../content.js";
import {
  assertVideoGenerationSupported,
  modelSupportsVideoGeneration,
  VideoGenerationError,
  type VideoGenerationJob,
  type VideoGenerationProvider,
} from "../contracts.js";
import { runVideoGenerationConformance } from "../testing/provider-conformance.js";

function fakeVideo(provider = "fake"): VideoGenerationProvider {
  let polls = 0;
  let submitted = 0;
  let model = "";
  return {
    id: provider,
    async submit(request) {
      submitted += 1;
      if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "empty");
      if (request.prompt.length > 100) throw new VideoGenerationError("input_too_large", "cap");
      polls = 0;
      model = request.model;
      return { jobId: `job-${submitted}` };
    },
    async status(jobId) {
      polls += 1;
      if (polls < 2) return { jobId, state: "queued" };
      return {
        jobId,
        state: "succeeded",
        video: { url: "https://example.com/out.mp4", mimeType: "video/mp4", provider, model },
      };
    },
  };
}

describe("video contract", () => {
  it("video_is_a_first_class_input_capability_and_modality", () => {
    assert.ok(MODEL_INPUT_CAPABILITIES.includes("video"));
    assert.equal(
      contentBlockInputModality({ type: "video", mediaType: "video/mp4", data: "AAAA" }),
      "video",
      "typed video blocks map to the video input modality",
    );
    assert.equal(contentBlockInputModality({ type: "text", text: "x" }), undefined);
  });

  it("modelSupportsVideoGeneration_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsVideoGeneration(undefined), false);
    assert.equal(modelSupportsVideoGeneration({}), false);
    assert.equal(modelSupportsVideoGeneration({ videoGeneration: true }), true);
  });

  it("assertVideoGenerationSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "sora-2", capabilities: { speech: true } };
    assert.throws(
      () => assertVideoGenerationSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("runVideoGenerationConformance_passes_fake_lifecycle_probes", async () => {
    const job = await runVideoGenerationConformance({
      provider: fakeVideo(),
      model: "wanx2.2-t2v-plus",
      maxPromptChars: 100,
      sample: { prompt: "a red cube spinning" },
    });
    assert.equal(job?.state, "succeeded");
    assert.equal(job?.video?.provider, "fake");
  });

  it("runVideoGenerationConformance_fails_on_oversized_prompt_that_resolves", async () => {
    const lax: VideoGenerationProvider = {
      id: "fake",
      submit: async (request) => {
        if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "empty");
        return { jobId: "j1" };
      },
      status: async (jobId) => ({
        jobId,
        state: "succeeded",
        video: { url: "https://example.com/out.mp4", provider: "fake", model: request_model },
      }),
    };
    const request_model = "wanx";
    await assert.rejects(() => runVideoGenerationConformance({ provider: lax, model: "wanx", maxPromptChars: 10 }), /input_too_large/);
  });

  it("runVideoGenerationConformance_fails_on_never_terminal_status", async () => {
    const stuck: VideoGenerationProvider = {
      id: "fake",
      submit: async (request) => {
        if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "empty");
        return { jobId: "j1" };
      },
      status: async (jobId) => ({ jobId, state: "running" }),
    };
    await assert.rejects(
      () => runVideoGenerationConformance({ provider: stuck, model: "m", sample: { maxPolls: 3 } }),
      /did not reach a terminal state/,
    );
  });

  it("runVideoGenerationConformance_tolerates_failed_jobs_but_flags_broken_provenance", async () => {
    const failing: VideoGenerationProvider = {
      id: "fake",
      submit: async (request) => {
        if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "empty");
        return { jobId: "j1" };
      },
      status: async (jobId) => ({ jobId, state: "failed", error: "moderation blocked" }),
    };
    const failed = await runVideoGenerationConformance({ provider: failing, model: "m", sample: {} });
    assert.equal(failed?.state, "failed");

    const wrongModel: VideoGenerationProvider = {
      id: "fake",
      submit: async (request) => {
        if (request.prompt.length === 0) throw new VideoGenerationError("empty_input", "empty");
        return { jobId: "j1" };
      },
      status: async (jobId): Promise<VideoGenerationJob> => ({
        jobId,
        state: "succeeded",
        video: { url: "https://x/y.mp4", provider: "fake", model: "someone-elses-model" },
      }),
    };
    await assert.rejects(
      () => runVideoGenerationConformance({ provider: wrongModel, model: "m", sample: {} }),
      /provenance model someone-elses-model must be preserved/,
    );
  });
});
