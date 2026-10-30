import { test } from "bun:test";
import assert from "node:assert/strict";
import { providerDone, providerTextDelta } from "@arnilo/prism";
import { analyzeCacheStability, PROBE_FORGET_TURN, runCacheProbe, sharedPrefixBytes } from "./cache-probe.mjs";

/** A route whose "provider" caches the longest repeated prefix of the previous request body, as an implicit cache would. */
function stubRoute({ cacheBytesPerToken = 4 } = {}) {
  return async (_ref, { beforeAttempt }) => {
    const rows = [];
    let previous = "";
    const provider = {
      id: "stub",
      async *generate(request) {
        const body = JSON.stringify({ context: request.context ?? [], system: request.system ?? [], messages: request.messages });
        await beforeAttempt("http://stub/chat", { body });
        const shared = sharedPrefixBytes(previous, body);
        rows.push({
          inputTokens: Math.ceil(body.length / cacheBytesPerToken),
          cacheReadTokens: Math.floor(shared / cacheBytesPerToken),
          cacheWriteTokens: 0,
        });
        previous = body;
        yield providerTextDelta("ok");
        yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      },
    };
    return {
      model: { provider: "stub", model: "main", limits: { contextWindow: 128_000, maxOutputTokens: 256 } },
      providers: [provider],
      usage: async () => rows,
      close: async () => {},
    };
  };
}

test("cache_probe_report_holds_no_text_and_flags_forget_break", async () => {
  const report = await runCacheProbe({ ref: "stub/main", openRoute: stubRoute() });
  assert.equal(report.requests, 12);
  assert.equal(report.wireAttempts, 12);
  assert.equal(report.status, "as-expected");
  assert.deepEqual(report.unexpectedMisses, []);
  assert.equal(report.expectedBreakRequest, PROBE_FORGET_TURN);
  assert.equal(report.breakReadsLess, true, "the forget changes the prefix, so that request reads less than its predecessor");
  assert.deepEqual(
    report.perRequest.filter((row) => row.event).map((row) => [row.turn, row.event]),
    [
      [4, "insert"],
      [9, "forget"],
    ],
  );
  // An additive write at turn 4 keeps the cache: the request after it reads at least what its predecessor did.
  assert.ok(report.perRequest[3].cacheReadTokens >= report.perRequest[2].cacheReadTokens);
  const json = JSON.stringify(report);
  for (const text of ["canary rollouts", "retry budget", "Do not use tools", "hello", "goodbye"])
    assert.equal(json.includes(text), false, text);
  for (const row of report.perRequest) assert.match(row.bodySha256, /^[a-f0-9]{64}$/);
});

test("cache_probe_never_exceeds_its_request_bound", async () => {
  await assert.rejects(runCacheProbe({ ref: "stub/main", maxRequests: 5, openRoute: stubRoute() }), /request bound|ceiling|bound/i);
});

test("cache_stability_row_flags_a_miss_that_is_not_the_forget", () => {
  const request = (turn, cacheReadTokens, body) => ({ turn, inputTokens: 100, cacheReadTokens, cacheWriteTokens: 0, body });
  const good = analyzeCacheStability(
    [
      request(1, 0, "aaaa"),
      request(2, 80, "aaaab"),
      ...Array.from({ length: 6 }, (_, i) => request(3 + i, 80, "aaaabc")),
      request(9, 10, "aaxx"),
      request(10, 80, "aaxxy"),
    ],
    { forgetTurn: 9 },
  );
  assert.equal(good.status, "as-expected");
  assert.equal(good.expectedBreakRequest, 9);
  assert.equal(good.breakReadsLess, true);
  const bad = analyzeCacheStability([request(1, 0, "a"), request(2, 80, "ab"), request(3, 0, "abc")], { forgetTurn: 9 });
  assert.equal(bad.status, "deviations");
  assert.deepEqual(bad.unexpectedMisses, [3]);
});
