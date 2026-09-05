import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModerationError, type ModerationResult } from "@arnilo/prism";
import { runModerationConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIModerationProvider, OPENAI_MODERATION_DEFAULT_MODEL, OPENAI_MODERATION_INPUT_MAX_CHARS } from "../index.js";

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: any;
}

function captureModerationFetch(results: unknown[], status = 200) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify({ id: "modr-1", model: "omni-moderation-latest", results }), { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const OPENAI_ENTRY = {
  flagged: true,
  categories: { hate: true, violence: false, "brand-new-vendor-category": true },
  category_scores: { hate: 0.87, violence: 0.003, "brand-new-vendor-category": 0.42 },
};

describe("createOpenAIModerationProvider", () => {
  it("posts_openai_moderation_shape_and_maps_categories_data_driven", async () => {
    const { fetchImpl, requests } = captureModerationFetch([OPENAI_ENTRY]);
    const provider = createOpenAIModerationProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
    const result = await provider.moderate({ input: "some text", model: "omni-moderation-latest" });
    const single = result as ModerationResult;
    assert.equal(requests[0].url, "https://api.openai.com/v1/moderations");
    assert.equal(requests[0].headers.get("authorization"), "Bearer sk-openai-secret");
    assert.equal(requests[0].body.model, "omni-moderation-latest");
    assert.equal(requests[0].body.input, "some text");
    assert.equal(single.flagged, true, "provider flagged decision passes through");
    assert.equal(single.categories.hate?.flagged, true);
    assert.equal(single.categories.hate?.score, 0.87, "scores verbatim — no local threshold");
    assert.equal(single.categories.violence?.score, 0.003);
    assert.deepEqual(single.categories["brand-new-vendor-category"], { score: 0.42, flagged: true }, "unknown raw categories pass through");
    assert.equal(single.raw && typeof single.raw === "object", true, "raw payload preserved for audits");
    assert.equal(single.model, "omni-moderation-latest");
  });

  it("defaults_to_omni_moderation_latest_and_supports_batch_input", async () => {
    let calls = 0;
    const requests: CapturedRequest[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      const flagged = calls !== 1; // second batch item is clean
      calls += 1;
      return new Response(JSON.stringify({ id: "modr-1", model: "omni-moderation-latest", results: [{ ...OPENAI_ENTRY, flagged }] }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = createOpenAIModerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    const results = (await provider.moderate({ input: ["first", "second"] })) as ModerationResult[];
    assert.equal(requests[0].body.model, OPENAI_MODERATION_DEFAULT_MODEL, "adapter default model applied");
    assert.equal(requests[0].body.input, "first", "one provider request per batch item");
    assert.equal(requests.length, 2);
    assert.equal(results.length, 2, "batch results match input arity");
    assert.equal(results[1].flagged, false);
  });

  it("empty_oversized_input_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const provider = createOpenAIModerationProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.moderate({ input: "" }),
      (error: unknown) => {
        assert.ok(error instanceof ModerationError);
        assert.equal(error.code, "empty_input");
        return true;
      },
    );
    await assert.rejects(
      () => provider.moderate({ input: "x".repeat(OPENAI_MODERATION_INPUT_MAX_CHARS + 1) }),
      (error: unknown) => {
        assert.ok(error instanceof ModerationError);
        assert.equal(error.code, "input_too_large");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const provider = createOpenAIModerationProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 429 })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.moderate({ input: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ModerationError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("429"));
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("malformed_results_array_fails_typed", async () => {
    const { fetchImpl } = captureModerationFetch([], 200);
    const provider = createOpenAIModerationProvider({ apiKey: "sk-x", fetch: fetchImpl });
    await assert.rejects(
      () => provider.moderate({ input: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof ModerationError);
        assert.equal(error.code, "response_malformed");
        return true;
      },
    );
  });

  it("passes_moderation_conformance_with_fake_transport", async () => {
    const { fetchImpl } = captureModerationFetch([OPENAI_ENTRY]);
    await runModerationConformance({
      provider: createOpenAIModerationProvider({ apiKey: "sk-x", fetch: fetchImpl }),
      model: "omni-moderation-latest",
      maxInputChars: OPENAI_MODERATION_INPUT_MAX_CHARS,
      sample: { input: "conformance probe" },
    });
  });
});
