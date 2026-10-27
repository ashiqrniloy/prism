import assert from "node:assert/strict";
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTavilySearch } from "../tavily.js";
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

test("tavily_search_normalizes_results", async () => {
  const { fetch, calls } = stub(fixture("tavily-search.json"));
  const search = createTavilySearch({ credentials: async () => "tvly-test", fetch });
  const response = await search.search("prism agent");
  assert.equal(response.provider, "tavily");
  assert.deepEqual(
    response.results.map((result) => result.url),
    ["https://example.org/tavily-one", "https://example.org/tavily-two"],
  );
  assert.equal(response.results[0]!.snippet, "First Tavily snippet");
  assert.equal(response.results[0]!.publishedAt, "2026-10-02");
  assert.match(response.results[0]!.citationId, /^web:tavily:[0-9a-f]{64}$/u);
  assert.equal(calls[0]!.url.toString(), "https://api.tavily.com/search");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(header(calls[0]!.init, "authorization"), "Bearer tvly-test");
});

test("tavily_maps_controls_into_the_request_body", async () => {
  const { fetch, calls } = stub(fixture("tavily-search.json"));
  const search = createTavilySearch({ credentials: async () => "tvly-test", fetch });
  await search.search("prism agent", {
    freshness: "week",
    country: "US",
    language: "EN",
    includeDomains: ["example.org"],
    excludeDomains: ["spam.example"],
  });
  const request = body(calls[0]!.init);
  assert.equal(request.time_range, "week");
  assert.equal(request.language, "en");
  assert.equal(request.topic, "general", "country is only honored on the general topic");
  assert.equal(request.country, "United States", "the two-letter contract becomes Tavily's English name");
  assert.deepEqual(request.include_domains, ["example.org"]);
  assert.deepEqual(request.exclude_domains, ["spam.example"]);
});

test("tavily_rejects_offset_and_an_unknown_country", async () => {
  const { fetch } = stub(fixture("tavily-search.json"));
  const search = createTavilySearch({ credentials: async () => "tvly-test", fetch });
  await assert.rejects(
    async () => search.search("q", { offset: 1 }),
    (error: unknown) => error instanceof WebToolError && /offset is not supported/u.test(error.message),
  );
  await assert.rejects(
    async () => search.search("q", { country: "ZZ" }),
    (error: unknown) => error instanceof WebToolError && /country is not a known ISO 3166-1 code/u.test(error.message),
  );
});

test("tavily_key_never_leaks", async () => {
  const canary = "tvly-CANARY-DO-NOT-ECHO";
  const { fetch } = stub({ detail: `invalid api key ${canary}` }, 401);
  const search = createTavilySearch({ credentials: async () => canary, fetch });
  const error = await search.search("q").then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof WebToolError);
  assert.equal(error.code, "ERR_PRISM_WEB_RESPONSE");
  assert.ok(!error.message.includes(canary));
  assert.ok(!String(error.stack).includes(canary));
});
