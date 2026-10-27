import assert from "node:assert/strict";
import { test } from "bun:test";
import { createDomainPolicy } from "../domains.js";
import { createNativeFetch } from "../native/fetch.js";
import { citation } from "../normalize.js";
import { createWebTools } from "../tools.js";
import type { WebSearchAdapter, WebSearchResponse } from "../types.js";

const now = new Date().toISOString();

test("domain_block_wins_over_allow", () => {
  const policy = createDomainPolicy({ allow: ["example.com", "*.example.com"], block: ["ads.example.com", "*.tracked.test"] });
  assert.equal(policy.allows("https://example.com/page"), true);
  assert.equal(policy.allows("https://www.example.com/page"), true);
  assert.equal(policy.allows("https://ads.example.com/page"), false, "block wins over an allowed parent");
  assert.equal(policy.allows("https://x.tracked.test/"), false);
  assert.equal(policy.allows("https://other.test/"), false, "an allow list permits nothing else");
  assert.throws(
    () => policy.assert("https://ads.example.com/page"),
    (error: { code?: string; message: string }) => {
      assert.equal(error.code, "ERR_PRISM_WEB_DOMAIN");
      assert.match(error.message, /ads\.example\.com/u);
      return true;
    },
  );
});

test("domain_matching_normalizes_hosts", () => {
  const policy = createDomainPolicy({ allow: ["EXAMPLE.com.", "*.bücher.example"] });
  assert.equal(policy.allows("https://example.com/"), true, "case and a trailing dot normalize");
  assert.equal(policy.allows("https://shop.bücher.example/"), true, "an IDN entry matches an IDN URL");
  assert.equal(policy.allows("https://shop.xn--bcher-kva.example/"), true, "and the punycode form of the same host");

  const wildcard = createDomainPolicy({ allow: ["*.example.com"] });
  assert.equal(wildcard.allows("https://a.example.com/"), true);
  assert.equal(wildcard.allows("https://example.com/"), false, "`*.` matches subdomains, not the apex");
  assert.equal(wildcard.allows("https://evil-example.com/"), false, "a look-alike suffix is not a subdomain");
  assert.equal(wildcard.allows("https://example.com.evil.test/"), false);
});

test("domain_policy_rejects_unusable_entries", () => {
  assert.throws(() => createDomainPolicy({ allow: ["https://example.com/x"] }), /bare hostname/u);
  assert.throws(() => createDomainPolicy({ block: ["exa*mple.com"] }), /leading/u);
  assert.throws(() => createDomainPolicy({ allow: [""] }), /empty hostname/u);
  assert.throws(() => createDomainPolicy({ allow: Array.from({ length: 257 }, (_, i) => `h${i}.test`) }), /256/u);
});

test("domain_allow_filters_search_results", async () => {
  const results = [
    { ...citation("brave", "https://allowed.test/a"), title: "allowed", retrievedAt: now },
    { ...citation("brave", "https://blocked.test/b"), title: "blocked", retrievedAt: now },
  ];
  const search: WebSearchAdapter = {
    provider: "brave",
    supports: new Set(),
    limits: { maxResults: 10 },
    search: async (query): Promise<WebSearchResponse> => ({ provider: "brave", query, results, untrusted: true }),
  };
  const tools = createWebTools({ search, domains: createDomainPolicy({ allow: ["allowed.test"] }) });
  const tool = tools.find((candidate) => candidate.name === "web_search")!;
  assert.match(tool.description ?? "", /host-approved domains/u);
  const result = await tool.execute({ query: "q" }, { sessionId: "s", runId: "r", toolCallId: "c" } as never);
  const value = result.value as { results: Array<{ url: string }>; filtered?: number };
  assert.deepEqual(
    value.results.map((row) => row.url),
    ["https://allowed.test/a"],
  );
  assert.equal(value.filtered, 1);
  const text = (result.content as readonly { text: string }[])[0]!.text;
  assert.ok(!text.includes("blocked.test"), "a filtered result never reaches the rendered text");
});

test("domain_policy_refuses_fetch_and_redirect_hop", async () => {
  const domains = createDomainPolicy({ allow: ["allowed.test"] });
  const requested: string[] = [];
  const fetch = createNativeFetch({
    userAgent: "test",
    domains,
    request: async (url) => {
      requested.push(url.toString());
      return new Response(null, { status: 302, headers: { location: "https://blocked.test/next" } });
    },
  });

  await assert.rejects(fetch.fetch("https://blocked.test/start"), /does not permit blocked\.test/u);
  assert.deepEqual(requested, [], "a non-permitted first URL makes no request");

  await assert.rejects(fetch.fetch("https://allowed.test/start"), (error: { code?: string; message: string }) => {
    assert.equal(error.code, "ERR_PRISM_WEB_DOMAIN");
    assert.match(error.message, /blocked\.test/u);
    return true;
  });
  assert.deepEqual(requested, ["https://allowed.test/start"], "the hop itself is never requested");
});
