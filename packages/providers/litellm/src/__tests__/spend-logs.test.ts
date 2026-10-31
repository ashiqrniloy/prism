import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProviderTransportError } from "@arnilo/prism/provider-kit";
import { litellmSpendLogs, normalizeSpendRow } from "../index.js";

const secret = "sk-litellm-spend-canary-never-expose";
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./wire/spend-logs/${name}.json`, import.meta.url), "utf8"));

const matchId = "0f2a6f0e-6a1b-4a2e-9a5a-1f0b7c9d2e11";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers from a queue of bodies and records every URL it was asked for. */
function stub(handler: (url: URL, call: number) => Response) {
  const urls: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    urls.push(url);
    return handler(url, urls.length - 1);
  }) as typeof fetch;
  return { urls, fetch: fetchImpl };
}

describe("litellmSpendLogs", () => {
  it("spend_logs_by_request_id normalizes a recorded row and drops foreign rows", async () => {
    const { urls, fetch } = stub(() => json(fixture("by-request-id")));
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: [matchId],
      waitMs: 0,
      fetch,
    });
    assert.equal(result.missing.length, 0);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      callId: matchId,
      model: "cloudflare/@cf/meta/llama-4-scout-17b-16e-instruct",
      modelGroup: "prism-free/chat",
      modelId: "chat-scout",
      spend: 0.00007355,
      promptTokens: 12,
      completionTokens: 34,
      startTime: "2026-10-31T22:41:07.120000+00:00",
      endTime: "2026-10-31T22:41:08.480000+00:00",
      status: "success",
    });
    // One indexed read, and the row the proxy volunteered for another tenant is gone.
    assert.equal(urls.length, 1);
    assert.equal(urls[0]!.pathname, "/spend/logs");
    assert.equal(urls[0]!.searchParams.get("request_id"), matchId);
  });

  it("spend_logs_date_range_for_many_ids pages a range and filters locally", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `aaaaaaaa-1111-4000-8000-00000000000${index + 1}`);
    const { urls, fetch } = stub(() => json(fixture("v2-range")));
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: ids,
      since: "2026-10-31T22:00:00.000Z",
      until: "2026-10-31T23:00:00.000Z",
      waitMs: 0,
      fetch,
    });
    assert.deepEqual(
      result.rows.map((row) => row.callId),
      [ids[0], ids[1]],
    );
    assert.equal(result.missing.length, 19);
    assert.equal(urls.length, 1);
    assert.equal(urls[0]!.pathname, "/spend/logs/v2");
    assert.equal(urls[0]!.searchParams.get("page_size"), "100");
    assert.equal(urls[0]!.searchParams.get("start_date"), "2026-10-31T22:00:00.000Z");
  });

  it("spend_logs_date_range_for_many_ids stops at the page cap", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `id-${index}`);
    const full = Array.from({ length: 100 }, () => ({
      request_id: "ffffffff-0000-4000-8000-000000000009",
      litellm_call_id: "ffffffff-0000-4000-8000-000000000009",
      spend: 1,
    }));
    const { urls, fetch } = stub(() => json({ data: full, page: 1, page_size: 100, total: 10_000, total_pages: 100 }));
    await litellmSpendLogs({ baseUrl: "https://litellm.example", apiKey: async () => secret, callIds: ids, waitMs: 0, fetch });
    assert.equal(urls.length, 50);
    assert.equal(new Set(urls.map((url) => url.searchParams.get("page"))).size, 50);
  });

  it("spend_logs_waits_then_reports_missing polls until the row is flushed", async () => {
    let polls = 0;
    const { urls, fetch } = stub(() => {
      polls += 1;
      return json(polls < 3 ? [] : fixture("by-request-id"));
    });
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: [matchId],
      waitMs: 1_000,
      pollIntervalMs: 0,
      fetch,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(urls.length, 3);
  });

  it("spend_logs_waits_then_reports_missing gives up inside waitMs", async () => {
    const { fetch } = stub(() => json([]));
    const started = Date.now();
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: [matchId],
      waitMs: 40,
      pollIntervalMs: 10,
      fetch,
    });
    assert.ok(Date.now() - started < 2_000, "waited past the deadline");
    assert.deepEqual(result.missing, [matchId]);
    assert.equal(result.rows.length, 0);
  });

  it("spend_logs_drops_content_fields", async () => {
    const { fetch } = stub(() => json(fixture("content-fields")));
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: ["bbbbbbbb-2222-4000-8000-000000000001"],
      waitMs: 0,
      fetch,
    });
    const serialized = JSON.stringify(result);
    for (const canary of ["PROMPT-CANARY", "RESPONSE-CANARY", "HASHED-KEY-CANARY", "CACHE-KEY-CANARY", "authorization", "metadata"])
      assert.ok(!serialized.includes(canary), `leaked ${canary}`);
    assert.equal(result.rows[0]!.callId, "bbbbbbbb-2222-4000-8000-000000000001");
    assert.equal(result.rows[0]!.cacheReadTokens, 12);
    assert.equal(result.rows[0]!.spend, 0);
  });

  it("spend_logs_bounded_body throws the bounded-read error", async () => {
    const huge = JSON.stringify([{ litellm_call_id: matchId, pad: "a".repeat(4_300_000) }]);
    const { fetch } = stub(() => new Response(huge, { headers: { "content-type": "application/json" } }));
    const run = litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => secret, callIds: [matchId], waitMs: 0, fetch });
    await assert.rejects(run, (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_overflow");
  });

  it("spend_logs_secret_never_leaks on an auth refusal", async () => {
    const { fetch } = stub(() => new Response(`{"error": "invalid key ${secret}"}`, { status: 401 }));
    const run = litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => secret, callIds: [matchId], waitMs: 0, fetch });
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(secret), "leaked the key");
      assert.match(error.message, /ERR_LITELLM_SPEND_LOGS: 401/);
      assert.match(error.message, /internal_user/);
      return true;
    });
  });

  it("spend_logs_reports_a_server_refusal_with_the_body", async () => {
    const { fetch } = stub(() => new Response(`{"error": "spend log table locked"}`, { status: 500 }));
    await assert.rejects(
      litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => secret, callIds: [matchId], waitMs: 0, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ERR_LITELLM_SPEND_LOGS: 500 .*spend log table locked/);
        return true;
      },
    );
  });

  it("spend_logs_without_ids_reads_a_range", async () => {
    const { urls, fetch } = stub(() => json(fixture("v2-range")));
    const result = await litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => secret, waitMs: 0, fetch });
    assert.equal(urls[0]!.pathname, "/spend/logs/v2");
    assert.deepEqual(
      result.rows.map((row) => row.callId),
      ["aaaaaaaa-1111-4000-8000-000000000001", "aaaaaaaa-1111-4000-8000-000000000002", "ffffffff-0000-4000-8000-000000000002"],
    );
    assert.deepEqual(result.missing, []);
  });

  it("spend_logs_keeps_polling_a_large_id_set", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `poll-id-${index}`);
    let polls = 0;
    const flushed = {
      data: ids.map((callId) => ({ litellm_call_id: callId, model_id: "chat-scout", spend: 0 })),
      total_pages: 1,
    };
    const { urls, fetch } = stub(() => {
      polls += 1;
      return json(polls < 3 ? { data: [], total_pages: 1 } : flushed);
    });
    const result = await litellmSpendLogs({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: async () => secret,
      callIds: ids,
      waitMs: 1_000,
      pollIntervalMs: 0,
      fetch,
    });
    assert.equal(result.rows.length, 21);
    assert.deepEqual(result.missing, []);
    assert.equal(urls.length, 3);
  });

  it("spend_logs_refuses_an_unparseable_date_window", async () => {
    const { fetch } = stub(() => json({ data: [], total_pages: 1 }));
    await assert.rejects(
      litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => secret, since: "not-a-date", waitMs: 0, fetch }),
      /since\/until must be valid dates/,
    );
  });

  it("spend_logs_refuses_a_plain_text_key_off_loopback", async () => {
    await assert.rejects(
      litellmSpendLogs({ baseUrl: "http://litellm.example", apiKey: async () => secret, callIds: [matchId], waitMs: 0 }),
      /ERR_LITELLM_INSECURE_BASE_URL/,
    );
  });

  it("spend_logs_refuses_a_missing_key", async () => {
    await assert.rejects(litellmSpendLogs({ baseUrl: "http://127.0.0.1:4000", apiKey: async () => undefined, waitMs: 0 }), /no API key/);
  });
});

describe("normalizeSpendRow", () => {
  it("prefers the minted call id and strips the cache-hit suffix", () => {
    const [first] = fixture("content-fields") as Record<string, unknown>[];
    const row = normalizeSpendRow(first);
    assert.equal(row?.callId, "bbbbbbbb-2222-4000-8000-000000000001");
    const legacyOnly = normalizeSpendRow({ request_id: "abc_cache_hit1761950467.123", spend: 1 });
    assert.equal(legacyOnly?.callId, "abc");
  });

  it("returns undefined when the row names no call and drops unknown fields", () => {
    assert.equal(normalizeSpendRow({ spend: 1 }), undefined);
    assert.equal(normalizeSpendRow("nope"), undefined);
    const row = normalizeSpendRow({ litellm_call_id: "id", spend: "1", prompt_tokens: -2, startTime: 5 });
    assert.deepEqual(row, {
      callId: "id",
      model: "",
      modelGroup: "",
      spend: 0,
      promptTokens: 0,
      completionTokens: 0,
      startTime: "",
      endTime: "",
    });
  });

  it("keeps a zero cost as zero", () => {
    assert.equal(normalizeSpendRow({ litellm_call_id: "id", spend: 0 })?.spend, 0);
  });
});
