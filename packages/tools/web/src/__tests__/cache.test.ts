import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import {
  createFetchCache,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_BYTES,
  MEMO_MAX_ENTRIES,
  MEMO_TTL_SECONDS,
  resolveFetchCache,
  tryCanonicalUrl,
  withFetchCache,
} from "../cache.js";
import { createWebTools } from "../tools.js";
import { WebToolError } from "../transport.js";
import type { WebDocument, WebFetchAdapter } from "../types.js";

/** A fetch over a counting stub, so a cache hit is observable as "no call". */
function countingFetch(markdown = "page text") {
  const calls: string[] = [];
  const adapter: WebFetchAdapter = {
    provider: "native",
    fetch: async (url) => {
      calls.push(url);
      return { citationId: `web:native:${url}`, provider: "native", url, markdown, retrievedAt: new Date().toISOString(), untrusted: true };
    },
  };
  return { adapter, calls };
}

function annotated(overrides: { readonly ttlSeconds?: number; readonly maxEntries?: number; readonly maxBytes?: number } = {}) {
  return resolveFetchCache({ ttlSeconds: 60, ...overrides });
}

test("cache_hit_makes_no_request", async () => {
  const { adapter, calls } = countingFetch();
  const fetch = withFetchCache(adapter, createFetchCache(annotated()));
  const first = await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  const second = await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  assert.deepEqual(calls, ["https://example.com/doc"], "the second call is a cache hit");
  assert.equal(first.cached, undefined, "the first response is not marked");
  assert.equal(second.cached, true);
  assert.equal(typeof second.cachedAgeMs, "number");
  // The fragment is not part of the page, so it is not part of the key.
  await fetch.fetch("https://example.com/doc#section", { sessionId: "s" });
  assert.equal(calls.length, 1, "a fragment reuses the stored page");
});

test("cache_refresh_bypasses", async () => {
  const { adapter, calls } = countingFetch();
  const fetch = withFetchCache(adapter, createFetchCache(annotated()));
  await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  const refreshed = await fetch.fetch("https://example.com/doc", { sessionId: "s", refresh: true });
  assert.deepEqual(calls, ["https://example.com/doc", "https://example.com/doc"]);
  assert.equal(refreshed.cached, undefined, "a refreshed page is a fresh fetch");
});

test("cache_entries_expire_after_ttl", async () => {
  let now = 1_000;
  const { adapter, calls } = countingFetch();
  const fetch = withFetchCache(adapter, createFetchCache(annotated({ ttlSeconds: 60 }), () => now));
  await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  now += 60_000;
  await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  assert.equal(calls.length, 1, "exactly at the TTL the page is still fresh");
  now += 1;
  await fetch.fetch("https://example.com/doc", { sessionId: "s" });
  assert.equal(calls.length, 2, "one millisecond later it is refetched");
});

test("cache_evicts_by_bytes_and_count", () => {
  const now = () => 0;
  const { adapter } = countingFetch();
  const byCount = createFetchCache(annotated({ maxEntries: 2 }), now);
  const fetch = withFetchCache(adapter, byCount);
  return (async () => {
    await fetch.fetch("https://a.test/", { sessionId: "s" });
    await fetch.fetch("https://b.test/", { sessionId: "s" });
    await fetch.fetch("https://c.test/", { sessionId: "s" });
    assert.ok(byCount.read("s", "https://c.test/") !== undefined, "the newest page is kept");
    assert.equal(byCount.read("s", "https://a.test/"), undefined, "the oldest page is evicted by count");

    const small = createFetchCache(annotated({ maxBytes: 10 }), now);
    const text = countingFetch("0123456789abcd");
    const smallFetch = withFetchCache(text.adapter, small);
    await smallFetch.fetch("https://big.test/", { sessionId: "s" });
    assert.equal(small.read("s", "https://big.test/"), undefined, "a page over the whole budget is not stored");
    await smallFetch.fetch("https://big.test/", { sessionId: "s" });
    assert.equal(text.calls.length, 2, "so it is fetched again rather than evicting everything");
  })();
});

test("cache_is_session_scoped_and_never_persisted", async () => {
  const { adapter, calls } = countingFetch();
  const cache = createFetchCache(annotated());
  const fetch = withFetchCache(adapter, cache);
  await fetch.fetch("https://example.com/doc", { sessionId: "a" });
  assert.equal(cache.read("b", "https://example.com/doc"), undefined, "another session never reads it");
  await fetch.fetch("https://example.com/doc", { sessionId: "b" });
  assert.equal(calls.length, 2);
  // A request without a session neither reads nor writes: the `web.fetch` service default.
  await fetch.fetch("https://example.com/doc");
  assert.equal(calls.length, 3);
  assert.equal(cache.read(undefined, "https://example.com/doc"), undefined, "nothing is stored without a session");

  // Structural proof: the cache module holds entries in its own map; it cannot write the branch.
  const source = readFileSync(new URL("../cache.ts", import.meta.url), "utf8");
  assert.ok(!/state\.(session|log)\(/u.test(source), "the cache never touches the persisted session state");
  assert.ok(!/package_state/u.test(source));
});

test("cache_dropped_on_session_dispose", () => {
  const cache = createFetchCache(annotated());
  cache.write("a", "https://example.com/doc", page("https://example.com/doc"));
  cache.write("b", "https://example.com/doc", page("https://example.com/doc"));
  cache.dropSession("a");
  assert.equal(cache.read("a", "https://example.com/doc"), undefined, "the closed session is gone");
  assert.ok(cache.read("b", "https://example.com/doc") !== undefined, "another session is untouched");
});

test("cache_defaults_and_validation", () => {
  const memo = resolveFetchCache(undefined);
  assert.equal(memo.ttlMs, MEMO_TTL_SECONDS * 1_000);
  assert.equal(memo.maxEntries, MEMO_MAX_ENTRIES);
  assert.equal(memo.annotated, false, "no config means the anonymous memo");
  const configured = resolveFetchCache({ ttlSeconds: 900 });
  assert.equal(configured.maxEntries, DEFAULT_CACHE_MAX_ENTRIES);
  assert.equal(configured.maxBytes, DEFAULT_CACHE_MAX_BYTES);
  assert.equal(configured.annotated, true);

  for (const config of [
    { ttlSeconds: 0 },
    { ttlSeconds: 86_401 },
    { ttlSeconds: 1.5 },
    { ttlSeconds: 60, maxEntries: 0 },
    { ttlSeconds: 60, maxBytes: 0 },
  ])
    assert.throws(
      () => resolveFetchCache(config as never),
      (error: unknown) => error instanceof WebToolError && error.code === "ERR_PRISM_WEB_INPUT" && /cache\./u.test(error.message),
    );
  assert.equal(tryCanonicalUrl("ftp://example.com/x"), undefined);
  assert.equal(tryCanonicalUrl("https://example.com/x#f")?.endsWith("#f"), false);
});

test("web_fetch_exposes_refresh_only_with_cache_config", async () => {
  const { adapter, calls } = countingFetch();
  const cache = createFetchCache(annotated());
  const tools = createWebTools({ fetch: adapter, cache });
  const tool = tools.find((candidate) => candidate.name === "web_fetch")!;
  assert.ok((tool.parameters as { properties: Record<string, unknown> }).properties.refresh !== undefined);
  assert.match(tool.description ?? "", /refresh: true/u);
  const context = { sessionId: "s", runId: "r", toolCallId: "c" };
  await tool.execute({ url: "https://example.com/doc" }, context);
  const second = await tool.execute({ url: "https://example.com/doc", offset: 1 }, context);
  assert.equal(calls.length, 1);
  assert.equal((second.value as { cached?: true }).cached, true);
  assert.match((second.content as readonly { text: string }[])[0]!.text, /cached \d+s ago/u);
  await tool.execute({ url: "https://example.com/doc", refresh: true }, context);
  assert.equal(calls.length, 2);

  const plain = createWebTools({ fetch: adapter }).find((candidate) => candidate.name === "web_fetch")!;
  assert.equal((plain.parameters as { properties: Record<string, unknown> }).properties.refresh, undefined);
  assert.ok(!/refresh: true/u.test(plain.description ?? ""), "without cache config there is nothing to refresh past");
});

function page(url: string): WebDocument {
  return { citationId: `web:native:${url}`, provider: "native", url, markdown: "page", retrievedAt: new Date().toISOString(), untrusted: true };
}
