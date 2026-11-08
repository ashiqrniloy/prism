import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createBraveSearch, createFirecrawlFetch, WebToolError } from "../index.js";
import { createFirecrawlExtractor } from "../firecrawl.js";

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ok = () => json({ web: { results: [] } });
const scrape = () => json({ success: true, data: { markdown: "# page", metadata: { sourceURL: "https://example.com/a" } } });
const code = (expected: string) => (error: unknown) => error instanceof WebToolError && error.code === expected;

describe("transport queue", () => {
  it("nine_parallel_fetches_complete_with_four_in_flight", async () => {
    let active = 0,
      peak = 0,
      requests = 0;
    const search = createBraveSearch({
      credentials: async () => "key",
      limits: { maxConcurrency: 4 },
      fetch: async () => {
        requests++;
        active++;
        peak = Math.max(peak, active);
        // Long enough for the next calls to pile up behind the four slots.
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return ok();
      },
    });
    const results = await Promise.all(Array.from({ length: 9 }, (_unused, i) => search.search(`q${i}`)));
    assert.equal(results.length, 9, "every queued call completes instead of failing");
    assert.equal(requests, 9);
    assert.equal(peak, 4, "the concurrency bound still holds");
  });

  it("queue_beyond_max_queued_fails_with_limit_error", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const search = createBraveSearch({
      credentials: async () => "key",
      limits: { maxConcurrency: 1, maxQueued: 1 },
      fetch: async () => {
        await gate;
        return ok();
      },
    });
    const first = search.search("q1"),
      waiting = search.search("q2"),
      refused = search.search("q3");
    await assert.rejects(() => refused, code("ERR_PRISM_WEB_LIMIT"));
    await assert.rejects(() => refused, /queue is full/u);
    release();
    await Promise.all([first, waiting]);
  });

  it("aborted_waiter_never_acquires", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const urls: string[] = [];
    const search = createBraveSearch({
      credentials: async () => "key",
      limits: { maxConcurrency: 1, maxQueued: 4 },
      fetch: async (request) => {
        urls.push(new URL(String(request)).searchParams.get("q") ?? "");
        await gate;
        return ok();
      },
    });
    const first = search.search("first");
    const controller = new AbortController();
    const abandoned = search.search("abandoned", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(() => abandoned, code("ERR_PRISM_WEB_ABORTED"));
    release();
    await first;
    // The aborted waiter left the queue: no slot was consumed and no request was made for it.
    await search.search("after");
    assert.deepEqual(urls, ["first", "after"]);
  });
});

describe("transport retries", () => {
  it("firecrawl_scrape_not_retried_on_500", async () => {
    let calls = 0;
    const fetch = createFirecrawlFetch({
      credentials: async () => "key",
      fetch: async () => {
        calls++;
        return json({ error: "boom" }, 500);
      },
    });
    await assert.rejects(() => fetch.fetch("https://example.com/a"), code("ERR_PRISM_WEB_RESPONSE"));
    assert.equal(calls, 1, "a scrape that may already have run is not submitted again");
  });

  it("firecrawl_scrape_retried_on_429", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetch = createFirecrawlFetch({
      credentials: async () => "key",
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async () => {
        calls++;
        return calls === 1 ? json({ error: "slow down" }, 429) : scrape();
      },
    });
    const document = await fetch.fetch("https://example.com/a");
    assert.equal(calls, 2, "a 429 was refused, not billed, so the scrape is safe to repeat");
    assert.equal(document.markdown, "# page");
    assert.equal(delays.length, 1);
  });

  it("firecrawl_extract_create_never_retried", async () => {
    let calls = 0;
    const extractor = createFirecrawlExtractor({
      credentials: async () => "key",
      schema: { type: "object", properties: { title: { type: "string" } } },
      validator: { validate: () => ({ ok: true, value: {} }) },
      fetch: async () => {
        calls++;
        return json({ error: "slow down" }, 429);
      },
    } as never);
    await assert.rejects(() => extractor.extract(["https://example.com/a"]), code("ERR_PRISM_WEB_RESPONSE"));
    assert.equal(calls, 1, "creating a paid extract job is never submitted twice");
  });

  it("retry_after_http_date_is_honored", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetch = createFirecrawlFetch({
      credentials: async () => "key",
      limits: { maxRateLimitDelayMs: 5_000 },
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async () => {
        calls++;
        if (calls === 1) return json({ error: "slow down" }, 429, { "retry-after": new Date(Date.now() + 2_000).toUTCString() });
        return scrape();
      },
    });
    await fetch.fetch("https://example.com/a");
    assert.equal(calls, 2);
    assert.ok(delays[0]! > 1_000 && delays[0]! <= 2_000, `an HTTP date becomes a delay from now (${delays[0]}ms)`);
  });

  it("retry_after_past_date_is_zero", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetch = createFirecrawlFetch({
      credentials: async () => "key",
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async () => {
        calls++;
        if (calls === 1) return json({ error: "slow down" }, 429, { "retry-after": new Date(Date.now() - 60_000).toUTCString() });
        return scrape();
      },
    });
    await fetch.fetch("https://example.com/a");
    assert.deepEqual(delays, [0], "a past HTTP date means retry immediately");
  });

  it("retry_after_date_stays_capped_by_max_rate_limit_delay", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetch = createFirecrawlFetch({
      credentials: async () => "key",
      limits: { maxRateLimitDelayMs: 1_000 },
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async () => {
        calls++;
        if (calls === 1) return json({ error: "slow down" }, 429, { "retry-after": new Date(Date.now() + 600_000).toUTCString() });
        return scrape();
      },
    });
    await fetch.fetch("https://example.com/a");
    assert.deepEqual(delays, [1_000]);
  });
});
