import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VideoGenerationError } from "@arnilo/prism";
import { runVideoGenerationConformance } from "@arnilo/prism/testing/provider-conformance";
import { ALIBABA_VIDEO_MAX_DURATION_SECONDS, ALIBABA_VIDEO_PROMPT_MAX_CHARS, createAlibabaVideoGenerationProvider } from "../index.js";

const RESULT_URL = "https://oss-data.aliyun-media.com/out.mp4";
const SUBMIT_OK = { output: { task_id: "task-9", task_status: "PENDING" }, request_id: "r1" };
const TASK_DONE = { output: { task_id: "task-9", task_status: "SUCCEEDED", results: [{ url: RESULT_URL }] } };

interface CapturedRequest {
  url: string;
  headers: Headers;
  body?: any;
}

function dashscopeFetch(submitOk: unknown, pollResponses: unknown[]) {
  const requests: CapturedRequest[] = [];
  let pollIndex = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.includes("/video-synthesis") || url.includes("/image2video")) {
      requests.push({ url, headers, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(submitOk), { status: 200 });
    }
    requests.push({ url, headers });
    const response = pollResponses[Math.min(pollIndex, pollResponses.length - 1)];
    pollIndex += 1;
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createAlibabaVideoGenerationProvider", () => {
  it("submits_t2v_task_and_polls_to_succeeded_with_provenance", async () => {
    const { fetchImpl, requests } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const provider = createAlibabaVideoGenerationProvider({ apiKey: "sk-dashscope-secret", fetch: fetchImpl, pollIntervalMs: 1 });
    const { jobId } = await provider.submit({ model: "wanx2.2-t2v-plus", prompt: "a red cube spinning", durationSeconds: 5 });
    assert.equal(jobId, "task-9");
    assert.equal(requests[0].url, "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-synthesis/video-synthesis");
    assert.equal(requests[0].headers.get("x-dashscope-async"), "enable");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-dashscope-secret");
    assert.equal(requests[0].body.model, "wanx2.2-t2v-plus");
    assert.equal(requests[0].body.input.prompt, "a red cube spinning");
    assert.equal(requests[0].body.parameters.duration, 5);
    const job = await provider.status(jobId);
    assert.equal(job.state, "succeeded");
    assert.equal(job.video?.url, RESULT_URL);
    assert.equal(job.video?.provider, "alibaba", "provenance preserved");
    assert.equal(job.video?.model, "wanx2.2-t2v-plus", "status remembers the submitted model");
    assert.equal(job.video?.mimeType, "video/mp4");
  });

  it("image_to_video_uses_the_i2v_route_and_passes_img_url", async () => {
    const { fetchImpl, requests } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const provider = createAlibabaVideoGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await provider.submit({
      model: "wanx2.2-i2v-plus",
      prompt: "make it spin",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
    assert.match(requests[0].url, /\/image2video\/video-synthesis$/);
    assert.equal(requests[0].body.input.img_url, "data:image/png;base64,AAAA");
  });

  it("empty_oversized_inputs_fail_typed_without_submitting", async () => {
    let fetchCalls = 0;
    const provider = createAlibabaVideoGenerationProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.submit({ model: "m", prompt: "" }),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    await assert.rejects(
      () => provider.submit({ model: "m", prompt: "x".repeat(ALIBABA_VIDEO_PROMPT_MAX_CHARS + 1) }),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    await assert.rejects(
      () => provider.submit({ model: "m", prompt: "x", durationSeconds: ALIBABA_VIDEO_MAX_DURATION_SECONDS + 1 }),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    await assert.rejects(
      () => provider.submit({ model: "m", prompt: "x", images: [{ type: "image" }] }),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("failed_task_maps_to_failed_job_with_provider_message", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [
      { output: { task_status: "FAILED", code: "InvalidParameter", message: "bad prompt" } },
    ]);
    const provider = createAlibabaVideoGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const { jobId } = await provider.submit({ model: "m", prompt: "x" });
    const job = await provider.status(jobId);
    assert.equal(job.state, "failed");
    assert.match(job.error ?? "", /InvalidParameter bad prompt/);
  });

  it("waitFor_polls_until_terminal_and_times_out_typed", async () => {
    const stuck = dashscopeFetch(SUBMIT_OK, [{ output: { task_status: "RUNNING" } }]);
    const provider = createAlibabaVideoGenerationProvider({ apiKey: "sk-x", fetch: stuck.fetchImpl, pollIntervalMs: 1, timeoutMs: 20 });
    const { jobId } = await provider.submit({ model: "m", prompt: "x" });
    await assert.rejects(
      () => provider.waitFor(jobId),
      (error: unknown) => {
        assert.ok(error instanceof VideoGenerationError);
        assert.match(error.message, /did not finish within 20ms/);
        return true;
      },
    );

    const done = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const ok = createAlibabaVideoGenerationProvider({ apiKey: "sk-x", fetch: done.fetchImpl, pollIntervalMs: 1 });
    const { jobId: id2 } = await ok.submit({ model: "m", prompt: "x" });
    const job = await ok.waitFor(id2);
    assert.equal(job.state, "succeeded");
  });

  it("passes_video_generation_conformance_with_fake_transport", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    await runVideoGenerationConformance({
      provider: createAlibabaVideoGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl, pollIntervalMs: 1 }),
      model: "wanx2.2-t2v-plus",
      maxPromptChars: ALIBABA_VIDEO_PROMPT_MAX_CHARS,
      sample: { prompt: "a red cube spinning" },
    });
  });
});
