import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { JsonObject } from "@arnilo/prism";
import { createBraveSearch, createExaSearch, createWebTools, WebToolError } from "../index.js";
import { DEFAULT_OBSCURA_SEARCH_PROFILE } from "../obscura/search-profile.js";
import { createObscuraWebTools } from "../obscura/web.js";
import { fakeObscuraCliPath } from "../obscura/__tests__/fake-cli.js";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const context = { sessionId: "s", runId: "r", toolCallId: "c" };
const input = (name: string) => (error: unknown) =>
  error instanceof WebToolError && error.code === "ERR_PRISM_WEB_INPUT" && new RegExp(name, "u").test(error.message);

function brave(searchQuery: (url: URL) => void = () => {}) {
  return createBraveSearch({
    credentials: async () => "key",
    fetch: async (request) => {
      searchQuery(new URL(String(request)));
      return json({ web: { results: [] } });
    },
  });
}

describe("search controls", () => {
  it("brave_maps_freshness_country_language_offset", async () => {
    let seen: URL | undefined;
    const search = brave((url) => (seen = url));
    await search.search("bun worker threads", { freshness: "month", country: "DE", language: "de", offset: 3, count: 5 });
    assert.equal(seen!.searchParams.get("freshness"), "pm");
    assert.equal(seen!.searchParams.get("country"), "de", "country codes are normalized to lowercase");
    assert.equal(seen!.searchParams.get("search_lang"), "de");
    assert.equal(seen!.searchParams.get("offset"), "3");
    assert.equal(seen!.searchParams.get("count"), "5");
    // One search is still one provider request, controls or not.
    for (const [freshness, expected] of [
      ["day", "pd"],
      ["week", "pw"],
      ["month", "pm"],
      ["year", "py"],
    ] as const) {
      await search.search("q", { freshness });
      assert.equal(seen!.searchParams.get("freshness"), expected);
    }
    // Brave's offset is 0-based and capped at 9.
    await search.search("q", { offset: 9 });
    assert.equal(seen!.searchParams.get("offset"), "9");
    await assert.rejects(() => search.search("q", { offset: 10 }), input("offset"));
  });

  it("brave_maps_domains_through_site_operators", async () => {
    let seen: URL | undefined;
    const search = brave((url) => (seen = url));
    await search.search("bun", { includeDomains: ["bun.sh", "example.com"], excludeDomains: ["spam.test"] });
    assert.equal(seen!.searchParams.get("q"), "bun site:bun.sh site:example.com -site:spam.test");
  });

  it("exa_maps_domains_and_freshness", async () => {
    let body: Record<string, unknown> | undefined;
    const search = createExaSearch({
      credentials: async () => "key",
      fetch: async (_request, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ results: [] });
      },
    });
    await search.search("bun", { includeDomains: ["bun.sh"], excludeDomains: ["spam.test"], country: "GB", freshness: "week" });
    assert.deepEqual(body!.includeDomains, ["bun.sh"]);
    assert.deepEqual(body!.excludeDomains, ["spam.test"]);
    assert.equal(body!.userLocation, "gb");
    const since = Date.parse(String(body!.startPublishedDate));
    const days = (Date.now() - since) / 86_400_000;
    assert.ok(days > 6.9 && days < 7.1, `startPublishedDate is about a week back (${days} days)`);
    assert.equal(body!.query, "bun", "Exa has no operator syntax, so domains stay structured");
  });

  it("obscura_profile_maps_controls_into_search_url", () => {
    const url = new URL(DEFAULT_OBSCURA_SEARCH_PROFILE.searchUrl("bun site:bun.sh", { freshness: "day", country: "de", language: "de" }));
    assert.equal(url.origin, "https://html.duckduckgo.com");
    assert.equal(url.searchParams.get("q"), "bun site:bun.sh");
    assert.equal(url.searchParams.get("df"), "d");
    assert.equal(url.searchParams.get("kl"), "de-de", "DDG's kl is a region-language pair");
    const bare = new URL(DEFAULT_OBSCURA_SEARCH_PROFILE.searchUrl("bun"));
    assert.equal(bare.searchParams.get("df"), null, "no control, no filter parameters");
    assert.equal(bare.searchParams.get("kl"), null);
  });

  it("obscura_web_search_sends_controls_through_the_profile", async () => {
    const toolSet = createObscuraWebTools({
      command: process.execPath,
      argsBefore: [fakeObscuraCliPath()],
      limits: { timeoutMs: 5_000 },
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const tool = toolSet.tools.find((candidate) => candidate.name === "web_search")!;
    const result = await tool.execute(
      { query: 'kept "quotes"', freshness: "year", country: "FR", include_domains: ["example.com"] },
      context as never,
    );
    assert.equal(result.error, undefined);
    // The fake CLI echoes the query it was given, including the operator added for the domain.
    const value = result.value as { results: readonly { url: string }[] };
    assert.equal(decodeURIComponent(value.results[0]!.url), 'https://example.com/a?q=kept "quotes" site:example.com');
  });

  it("schema_lists_only_backend_supported_controls", () => {
    const properties = (search: Parameters<typeof createWebTools>[0]["search"]) =>
      Object.keys(
        (createWebTools({ search }).find((tool) => tool.name === "web_search")!.parameters as JsonObject).properties as object,
      ).sort();
    assert.deepEqual(properties(brave()), [
      "count",
      "country",
      "exclude_domains",
      "freshness",
      "include_domains",
      "language",
      "offset",
      "query",
    ]);
    const exa = createExaSearch({ credentials: async () => "key", fetch: async () => json({ results: [] }) });
    assert.deepEqual(properties(exa), ["count", "country", "exclude_domains", "freshness", "include_domains", "query"]);
    const obscura = createObscuraWebTools({ command: process.execPath, argsBefore: [fakeObscuraCliPath()] });
    const search = obscura.tools.find((tool) => tool.name === "web_search")!;
    assert.deepEqual(Object.keys((search.parameters as JsonObject).properties as object).sort(), [
      "count",
      "country",
      "exclude_domains",
      "freshness",
      "include_domains",
      "language",
      "query",
    ]);
    const description = createWebTools({ search: exa }).find((tool) => tool.name === "web_search")!.description ?? "";
    assert.match(description, /include_domains/u);
    assert.equal(/`offset`|`language`/u.test(description), false, "the description lists only what this backend does");
  });

  it("unsupported_control_fails_naming_argument", async () => {
    const exa = createExaSearch({ credentials: async () => "key", fetch: async () => json({ results: [] }) });
    await assert.rejects(() => exa.search("q", { offset: 2 }), input("offset"));
    await assert.rejects(() => exa.search("q", { language: "en" }), input("language"));
    const tool = createWebTools({ search: exa }).find((candidate) => candidate.name === "web_search")!;
    await assert.rejects(async () => tool.execute({ query: "q", offset: 2 }, context), input("offset"));
    // Obscura has no paging control: continuing a DuckDuckGo result list needs a `vqd` token.
    const obscura = createObscuraWebTools({ command: process.execPath, argsBefore: [fakeObscuraCliPath()] });
    const obscuraSearch = obscura.tools.find((candidate) => candidate.name === "web_search")!;
    await assert.rejects(async () => obscuraSearch.execute({ query: "q", offset: 1 }, context as never), input("offset"));
  });

  it("domain_control_rejects_operator_injection", async () => {
    const search = brave();
    for (const domain of [
      "example.com OR site:evil.test",
      "site:evil.test",
      "https://example.com",
      "example.com/path",
      "*.example.com",
      "example",
      "a b.test",
    ]) {
      await assert.rejects(() => search.search("q", { includeDomains: [domain] }), input("include_domains"));
      await assert.rejects(() => search.search("q", { excludeDomains: [domain] }), input("exclude_domains"));
    }
    await assert.rejects(
      () => search.search("q", { includeDomains: Array.from({ length: 11 }, (_unused, i) => `d${i}.test`) }),
      input("include_domains"),
    );
    await assert.rejects(() => search.search("q", { freshness: "hour" as never }), input("freshness"));
    await assert.rejects(() => search.search("q", { country: "DEU" }), input("country"));
    await assert.rejects(() => search.search("q", { language: "eng" }), input("language"));
    await assert.rejects(() => search.search("q", { offset: -1 }), input("offset"));
  });

  it("domain_operators_count_toward_brave_query_limit", async () => {
    const search = brave();
    const domains = Array.from({ length: 10 }, (_unused, i) => `d${i}.example`);
    // A 45-word query fits; the ten operator terms push it past 50 words.
    const words = Array.from({ length: 45 }, (_unused, i) => `w${i}`).join(" ");
    await search.search(words);
    await assert.rejects(() => search.search(words, { includeDomains: domains }), input("query"));
    // The same holds for the 400-character limit: ten long-but-valid hostnames exceed it.
    const wide = Array.from({ length: 10 }, () => `${"sub".repeat(20)}.example`);
    await assert.rejects(() => search.search("q", { includeDomains: wide }), input("query"));
    await assert.rejects(() => search.search("q", { includeDomains: [`${"a".repeat(64)}.example`] }), input("include_domains"));
  });
});
