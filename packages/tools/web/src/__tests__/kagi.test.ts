import assert from "node:assert/strict";
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import { createKagiSearch } from "../kagi.js";
import { WebToolError } from "../transport.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

function stub(body: unknown, status = 200) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(input.toString()), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const body = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body)) as Record<string, unknown>;
const header = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);

test("kagi_search_normalizes_results", async () => {
  const { fetch, calls } = stub(fixture("kagi-search.json"));
  const search = createKagiSearch({ credentials: async () => "kagi-test", fetch });
  const response = await search.search("prism agent");
  assert.equal(response.provider, "kagi");
  assert.deepEqual(
    response.results.map((result) => result.url),
    ["https://example.org/kagi-one", "https://example.org/kagi-two"],
  );
  assert.equal(response.results[0]!.snippet, "First Kagi snippet");
  assert.equal(response.results[0]!.publishedAt, "2026-10-03T00:00:00Z");
  assert.match(response.results[0]!.citationId, /^web:kagi:[0-9a-f]{64}$/u);
  assert.equal(calls[0]!.url.toString(), "https://kagi.com/api/v1/search", "v1, not the deprecated v0 GET");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(header(calls[0]!.init, "authorization"), "Bot kagi-test");
});

test("kagi_v1_request_shape_carries_lens_and_filters", async () => {
  const { fetch, calls } = stub(fixture("kagi-search.json"));
  const search = createKagiSearch({ credentials: async () => "kagi-test", fetch });
  await search.search("prism agent", {
    freshness: "month",
    country: "us",
    offset: 1,
    includeDomains: ["example.org"],
    excludeDomains: ["spam.example"],
  });
  const request = body(calls[0]!.init);
  assert.equal(request.query, "prism agent");
  assert.equal(request.workflow, "search");
  assert.equal(request.page, 2, "offset 1 is page 2");
  assert.equal(request.limit, 10);
  assert.deepEqual(request.lens, {
    sitesIncluded: ["example.org"],
    sitesExcluded: ["spam.example"],
    timeRelative: "month",
  });
  assert.deepEqual(request.filters, { region: "US" });
});

test("kagi_year_freshness_uses_a_date_filter", async () => {
  const { fetch, calls } = stub(fixture("kagi-search.json"));
  const search = createKagiSearch({ credentials: async () => "kagi-test", fetch });
  await search.search("prism agent", { freshness: "year" });
  const request = body(calls[0]!.init);
  assert.equal((request.lens as Record<string, unknown> | undefined)?.timeRelative, undefined);
  const after = (request.filters as { after?: string }).after;
  assert.match(after ?? "", /^\d{4}-\d{2}-\d{2}$/u);
  const days = (Date.now() - Date.parse(`${after}T00:00:00Z`)) / 86_400_000;
  assert.ok(days > 360 && days < 370, `after is about a year ago (${days} days)`);
});

test("kagi_rejects_language_and_an_offset_past_page_10", async () => {
  const { fetch } = stub(fixture("kagi-search.json"));
  const search = createKagiSearch({ credentials: async () => "kagi-test", fetch });
  await assert.rejects(
    async () => search.search("q", { language: "en" }),
    (error: unknown) => error instanceof WebToolError && /language is not supported/u.test(error.message),
  );
  await assert.rejects(
    async () => search.search("q", { offset: 10 }),
    (error: unknown) => error instanceof WebToolError && /offset must be 0\.\.9/u.test(error.message),
  );
});

test("kagi_key_never_leaks", async () => {
  const canary = "kagi-CANARY-DO-NOT-ECHO";
  const { fetch } = stub({ error: [{ message: `unauthorized ${canary}` }] }, 401);
  const search = createKagiSearch({ credentials: async () => canary, fetch });
  const error = await search.search("q").then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof WebToolError);
  assert.ok(!error.message.includes(canary));
  assert.ok(!String(error.stack).includes(canary));
});
