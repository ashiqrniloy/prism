import assert from "node:assert/strict";
import { test } from "bun:test";
import { readFileSync } from "node:fs";
import { createKagiSearch } from "../kagi.js";
import { createSearxngSearch } from "../searxng.js";
import { createTavilySearch } from "../tavily.js";
import { searchControlProperties } from "../controls.js";
import { WebToolError } from "../transport.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

/** A fetch stub that records every request and answers with one recorded body. */
function stub(body: unknown, status = 200) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(input.toString()), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const header = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);

test("searxng_search_normalizes_results", async () => {
  const { fetch, calls } = stub(fixture("searxng-search.json"));
  const search = createSearxngSearch({ origin: "https://search.example.org", fetch });
  const response = await search.search("prism agent");
  assert.equal(response.provider, "searxng");
  assert.equal(response.untrusted, true);
  assert.deepEqual(
    response.results.map((result) => result.url),
    ["https://example.org/searxng-one", "https://example.org/searxng-two"],
    "duplicates collapse to one row",
  );
  assert.equal(response.results[0]!.title, "SearXNG One");
  assert.equal(response.results[0]!.snippet, "First SearXNG snippet");
  assert.equal(response.results[1]!.publishedAt, undefined);
  assert.match(response.results[0]!.citationId, /^web:searxng:[0-9a-f]{64}$/u);
  assert.equal(calls[0]!.url.searchParams.get("format"), "json");
  assert.equal(calls[0]!.url.searchParams.get("q"), "prism agent");
  assert.equal(header(calls[0]!.init, "authorization"), null, "a keyless instance is asked without an auth header");
});

test("searxng_sends_bearer_when_a_key_is_configured", async () => {
  const { fetch, calls } = stub(fixture("searxng-search.json"));
  const search = createSearxngSearch({ origin: "https://search.example.org", fetch, credentials: async () => "proxy-token" });
  await search.search("prism agent");
  assert.equal(header(calls[0]!.init, "authorization"), "Bearer proxy-token");
});

test("searxng_maps_controls_into_the_query_and_url", async () => {
  const { fetch, calls } = stub(fixture("searxng-search.json"));
  const search = createSearxngSearch({ origin: "https://search.example.org", fetch });
  await search.search("prism agent", {
    freshness: "month",
    language: "DE",
    offset: 2,
    includeDomains: ["example.org"],
    excludeDomains: ["spam.example"],
  });
  const url = calls[0]!.url;
  assert.equal(url.searchParams.get("time_range"), "month");
  assert.equal(url.searchParams.get("language"), "de");
  assert.equal(url.searchParams.get("pageno"), "3", "offset 2 is the third page");
  assert.equal(url.searchParams.get("q"), "prism agent site:example.org -site:spam.example");
});

test("searxng_rejects_non_https_origin_without_loopback_opt_in", () => {
  const credentialless = { fetch: stub({}).fetch };
  assert.throws(
    () => createSearxngSearch({ origin: "http://127.0.0.1:8888", ...credentialless }),
    (error: unknown) => error instanceof WebToolError && error.code === "ERR_PRISM_WEB_ORIGIN",
  );
  assert.throws(
    () => createSearxngSearch({ origin: "http://search.example.org", allowLoopback: true, ...credentialless }),
    (error: unknown) => error instanceof WebToolError && error.code === "ERR_PRISM_WEB_ORIGIN",
  );
  const loopback = createSearxngSearch({ origin: "http://127.0.0.1:8888", allowLoopback: true, ...credentialless });
  assert.equal(loopback.provider, "searxng");
});

test("searxng_rejects_week_freshness", async () => {
  const { fetch } = stub(fixture("searxng-search.json"));
  const search = createSearxngSearch({ origin: "https://search.example.org", fetch });
  await assert.rejects(
    async () => search.search("q", { freshness: "week" }),
    (error: unknown) =>
      error instanceof WebToolError &&
      error.code === "ERR_PRISM_WEB_INPUT" &&
      /freshness must be one of day, month, year/u.test(error.message),
  );
});

test("searxng_rejects_a_country_control", async () => {
  const { fetch } = stub(fixture("searxng-search.json"));
  const search = createSearxngSearch({ origin: "https://search.example.org", fetch });
  await assert.rejects(
    async () => search.search("q", { country: "US" }),
    (error: unknown) => error instanceof WebToolError && /country is not supported/u.test(error.message),
  );
});

test("search_controls_match_backend_support", () => {
  const credential = async () => "k";
  const adapters = [
    createSearxngSearch({ origin: "https://search.example.org" }),
    createTavilySearch({ credentials: credential }),
    createKagiSearch({ credentials: credential }),
  ];
  const freshness = (adapter: (typeof adapters)[number]): readonly string[] => {
    const properties = searchControlProperties(adapter.supports, adapter.controlValues) as Record<
      string,
      { enum?: readonly string[] }
    >;
    return properties.freshness?.enum ?? [];
  };
  assert.deepEqual(freshness(adapters[0]!), ["day", "month", "year"], "SearXNG has no week window");
  assert.deepEqual(freshness(adapters[1]!), ["day", "week", "month", "year"]);
  assert.deepEqual(freshness(adapters[2]!), ["day", "week", "month", "year"]);
  assert.deepEqual([...adapters[0]!.supports].sort(), [
    "excludeDomains",
    "freshness",
    "includeDomains",
    "language",
    "offset",
  ]);
  assert.ok(!adapters[1]!.supports.has("offset"), "Tavily pages nothing");
  assert.ok(!adapters[2]!.supports.has("language"), "Kagi v1 has no language control");
});
