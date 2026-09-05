import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImageGenerationError } from "@arnilo/prism";
import { runImageGenerationConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIImageGenerationProvider, OPENAI_IMAGE_MAX_COUNT, OPENAI_IMAGE_PROMPT_MAX_CHARS } from "../index.js";

const PNG_B64 = Buffer.from([1, 2, 3, 4]).toString("base64");

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: any;
}

function captureJsonFetch(data: unknown[] | string) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify({ data, usage: { input_tokens: 2, total_tokens: 2 } }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const IMAGE_ENTRY = { b64_json: PNG_B64, output_format: "png" };

describe("createOpenAIImageGenerationProvider", () => {
  it("posts_openai_generation_shape_with_b64_json_and_maps_images", async () => {
    const { fetchImpl, requests } = captureJsonFetch([{ ...IMAGE_ENTRY, revised_prompt: "a crimson cube" }]);
    const provider = createOpenAIImageGenerationProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
    const result = await provider.generate({ model: "gpt-image-1", prompt: "a red cube", size: "1024x1024", count: 1 });
    assert.equal(requests[0].url, "https://api.openai.com/v1/images/generations");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-openai-secret");
    assert.equal(requests[0].body.model, "gpt-image-1");
    assert.equal(requests[0].body.prompt, "a red cube");
    assert.equal(requests[0].body.response_format, "b64_json", "bytes contract");
    assert.equal(requests[0].body.size, "1024x1024");
    assert.equal(requests[0].body.n, 1);
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.images[0].bytes, new Uint8Array([1, 2, 3, 4]));
    assert.equal(result.images[0].mimeType, "image/png");
    assert.equal(result.images[0].provider, "openai", "provenance preserved");
    assert.equal(result.images[0].model, "gpt-image-1");
    assert.equal(result.images[0].revisedPrompt, "a crimson cube");
    assert.deepEqual(result.usage, { inputTokens: 2, totalTokens: 2 });
  });

  it("empty_oversized_prompt_and_oversized_count_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createOpenAIImageGenerationProvider({
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
      () => provider.generate({ model: "m", prompt: "x".repeat(OPENAI_IMAGE_PROMPT_MAX_CHARS + 1) }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x", count: OPENAI_IMAGE_MAX_COUNT + 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("invalid_b64_decode_fails_typed", async () => {
    const { fetchImpl } = captureJsonFetch([{ b64_json: "!!!not-base64!!!", output_format: "png" }]);
    const provider = createOpenAIImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "response_malformed");
        assert.match(error.message, /invalid base64/);
        return true;
      },
    );
  });

  it("edit_posts_multipart_with_decoded_image_parts_and_mask", async () => {
    const requests: { url: string; form: FormData }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), form: init?.body as FormData });
      return new Response(JSON.stringify({ data: [IMAGE_ENTRY] }), { status: 200 });
    }) as typeof fetch;
    const provider = createOpenAIImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const result = await provider.edit({
      model: "gpt-image-1",
      prompt: "make it blue",
      images: [{ type: "image", data: PNG_B64, mimeType: "image/png" }],
      mask: { type: "image", data: PNG_B64 },
    });
    assert.equal(requests[0].url, "https://api.openai.com/v1/images/edits");
    assert.equal(requests[0].form.get("model") as string, "gpt-image-1");
    assert.equal(requests[0].form.get("prompt") as string, "make it blue");
    const image = requests[0].form.get("image[]") as File;
    assert.equal((await image.arrayBuffer()).byteLength, 4, "base64 data decoded to bytes");
    assert.ok(requests[0].form.get("mask") instanceof File);
    assert.equal(result.images[0].provider, "openai");
  });

  it("edit_resolves_url_parts_through_the_injected_url_resolver", async () => {
    const downloaded: string[] = [];
    const fetchImpl = (async () => new Response(JSON.stringify({ data: [IMAGE_ENTRY] }), { status: 200 })) as typeof fetch;
    const provider = createOpenAIImageGenerationProvider({
      apiKey: "sk-x",
      fetch: fetchImpl,
      fetchUrl: (async (url: URL) => {
        downloaded.push(url.href);
        return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
      }) as (url: URL, init?: { readonly signal?: AbortSignal }) => Promise<Response>,
    });
    await provider.edit({ model: "gpt-image-1", prompt: "x", images: [{ type: "image", url: "https://example.com/in.png" }] });
    assert.deepEqual(downloaded, ["https://example.com/in.png"], "url part fetched via the injected resolver");
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const provider = createOpenAIImageGenerationProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({ model: "m", prompt: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ImageGenerationError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("401"));
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("passes_image_generation_conformance_with_fake_transport", async () => {
    const { fetchImpl } = captureJsonFetch([IMAGE_ENTRY]);
    await runImageGenerationConformance({
      provider: createOpenAIImageGenerationProvider({ apiKey: "sk-x", fetch: fetchImpl }),
      model: "gpt-image-1",
      maxPromptChars: OPENAI_IMAGE_PROMPT_MAX_CHARS,
      sample: { prompt: "a red cube", size: "1024x1024", count: 1 },
    });
  });
});
