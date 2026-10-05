import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { ModelDiscoveryError, runModelDiscoveryConformance } from "@arnilo/prism/provider-kit";
import { createGoogleModelDiscovery } from "../model-discovery.js";

/** Counting injected transport: returns scripted envelopes and records request URLs/headers. */
function scriptedFetch(
  envelopes: unknown[],
  options: { readonly status?: number } = {},
): {
  fetch: typeof fetch;
  readonly requests: { readonly url: string; readonly headers: Record<string, string> }[];
} {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  let calls = 0;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url: String(input), headers });
    const body = envelopes[Math.min(calls, envelopes.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status: options.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: transport, requests };
}

describe("createGoogleModelDiscovery", () => {
  it("normalizes {models:[…]} with limits/capabilities and follows nextPageToken", async () => {
    const { fetch, requests } = scriptedFetch([
      {
        models: [
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 8_192,
            thinking: true,
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/gemini-embed", supportedGenerationMethods: ["embedContent"] },
        ],
        nextPageToken: "page-2",
      },
      { models: [{ name: "models/gemini-flash", inputTokenLimit: 32_768 }] },
    ]);
    const discovery = createGoogleModelDiscovery({ apiKey: "gk-test", fetch });
    const result = await discovery.listModels();
    assert.equal(result.provenance.provider, "google");
    assert.deepEqual(
      result.models.map((m) => m.model),
      ["gemini-pro", "gemini-embed", "gemini-flash"],
    );
    assert.equal((result.models[0]!.limits as { contextWindow?: number }).contextWindow, 1_048_576);
    assert.equal((result.models[0]!.capabilities as { reasoning?: boolean }).reasoning, true);
    assert.equal((result.models[1]!.capabilities as { embeddings?: boolean }).embeddings, true);
    assert.equal(result.models[2]!.displayName, undefined);
    // Auth header + pagination query params.
    assert.equal(requests[0]!.headers["x-goog-api-key"], "gk-test");
    assert.match(requests[0]!.url, /pageSize=1000$/);
    assert.match(requests[1]!.url, /pageToken=page-2/);
  });

  it("requires an apiKey and passes conformance through an injected transport", async () => {
    await assert.rejects(
      createGoogleModelDiscovery({ apiKey: "", fetch: scriptedFetch([{ models: [] }]).fetch }).listModels(),
      ModelDiscoveryError,
    );
    await runModelDiscoveryConformance(() =>
      createGoogleModelDiscovery({ apiKey: "gk-test", fetch: scriptedFetch([{ models: [{ name: "models/gemini-pro" }] }]).fetch }),
    );
  });

  it("is re-exported from the package entrypoint with its options type", async () => {
    const entry = await import("../index.js");
    assert.equal(typeof entry.createGoogleModelDiscovery, "function");
    assert.equal(typeof entry.google, "function");
  });
});
