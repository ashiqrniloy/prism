import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImageGenerationError } from "@arnilo/prism";
import { runImageGenerationConformance } from "@arnilo/prism/testing/provider-conformance";
import { ALIBABA_IMAGE_MAX_COUNT, createAlibabaImageGenerationProvider } from "../index.js";

const RESULT_URL = "https://oss-data.aliyun-media.com/out.png";

interface CapturedRequest {
  url: string;
  headers: Headers;
  body?: any;
}

function dashscopeFetch(submitOk: unknown, pollResponses: unknown[], _resultBytes = new Uint8Array([1, 2, 3])) {
  const requests: CapturedRequest[] = [];
  let pollIndex = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/image-synthesis")) {
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

function fakeFetchUrl(resultBytes = new Uint8Array([1, 2, 3])) {
  const downloaded: string[] = [];
  const fetchUrl = (async (url: URL) => {
    downloaded.push(url.href);
    return new Response(resultBytes, { status: 200 });
  }) as (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>;
  return { fetchUrl, downloaded };
}

const SUBMIT_OK = { output: { task_id: "task-1", task_status: "PENDING" }, request_id: "r1" };
const TASK_DONE = { output: { task_status: "SUCCEEDED", results: [{ url: RESULT_URL }] } };

describe("createAlibabaImageGenerationProvider", () => {
  it("submits_async_task_polls_to_success_and_downloads_result_bytes", async () => {
    const { fetchImpl, requests } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const { fetchUrl, downloaded } = fakeFetchUrl();
    const provider = createAlibabaImageGenerationProvider({
      apiKey: "sk-dashscope-secret",
      fetch: fetchImpl,
      fetchUrl,
      pollIntervalMs: 1,
    });
    const result = await provider.generate({ model: "wanx2.1-t2i-turbo", prompt: "a red cube", size: "1024x1024" });
    assert.equal(requests[0].url, "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis");
    assert.equal(requests[0].headers.get("x-dashscope-async"), "enable");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-dashscope-secret");
    assert.equal(requests[0].body.model, "wanx2.1-t2i-turbo");
    assert.equal(requests[0].body.input.prompt, "a red cube");
    assert.equal(requests[0].body.parameters.size, "1024x1024");
    assert.match(requests[1].url, /\/api\/v1\/tasks\/task-1$/, "polls the submitted task id");
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.images[0].bytes, new Uint8Array([1, 2, 3]), "result URL downloaded to bytes");
    assert.equal(result.images[0].provider, "alibaba", "provenance preserved");
    assert.equal(result.images[0].model, "wanx2.1-t2i-turbo");
    assert.equal(result.images[0].url, RESULT_URL, "provider URL passthrough");
    assert.equal(result.images[0].mimeType, "image/png");
    assert.deepEqual(downloaded, [RESULT_URL], "result URL downloaded via the injected resolver");
  });

  it("failed_task_rejects_typed_with_provider_message", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [
      { output: { task_status: "FAILED", code: "InvalidParameter", message: "bad prompt" } },
    ]);
    const provider = createAlibabaImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl, pollIntervalMs: 1 });
    await assert.rejects(
      () => provider.generate({ model: "wanx2.1-t2i-turbo", prompt: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "request_failed");
        assert.match(error.message, /InvalidParameter bad prompt/);
        return true;
      },
    );
  });

  it("empty_oversized_prompt_and_oversized_count_fail_typed_without_submitting", async () => {
    let fetchCalls = 0;
    const provider = createAlibabaImageGenerationProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "" }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x".repeat(801) }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x", count: ALIBABA_IMAGE_MAX_COUNT + 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("task_timeout_rejects_typed", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [{ output: { task_status: "RUNNING" } }]);
    const provider = createAlibabaImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl, pollIntervalMs: 1, timeoutMs: 20 });
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "request_failed");
        assert.match(error.message, /did not finish within 20ms/);
        return true;
      },
    );
  });

  it("edit_rejects_typed_unsupported_operation", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const provider = createAlibabaImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await assert.rejects(
      () => provider.edit({ model: "m", prompt: "x", images: [{ type: "image", data: "aGk=" }] }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "unsupported_operation");
        return true;
      },
    );
  });

  it("passes_image_generation_conformance_with_fake_transport", async () => {
    const { fetchImpl } = dashscopeFetch(SUBMIT_OK, [TASK_DONE]);
    const { fetchUrl } = fakeFetchUrl();
    await runImageGenerationConformance({
      provider: createAlibabaImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl, fetchUrl, pollIntervalMs: 1 }),
      model: "wanx2.1-t2i-turbo",
      maxPromptChars: 800,
      sample: { prompt: "a red cube", count: 1 },
    });
  });
});
