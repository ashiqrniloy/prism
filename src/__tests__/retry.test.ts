import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultRetryPolicy, isTransientErrorInfo, providerError, type RetryContext } from "../index.js";
import { errorToErrorInfo } from "../redaction.js";

describe("retry policy", () => {
  it("default retry policy retries known transient codes with capped backoff", async () => {
    // random: () => 0.5 lands the jitter factor at exactly 1, keeping delays deterministic.
    const policy = createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 15, random: () => 0.5 });
    const context: RetryContext = { sessionId: "s1", runId: "r1", attempt: 1, error: { message: "busy", code: 503 } };

    assert.deepEqual(await policy.decide(context), { retry: true, delayMs: 10 });
    assert.deepEqual(await policy.decide({ ...context, attempt: 2 }), { retry: true, delayMs: 15 });
    assert.deepEqual(await policy.decide({ ...context, attempt: 3 }), { retry: false });
  });

  it("jitters delays within the configured fraction", async () => {
    const policy = createDefaultRetryPolicy({ baseDelayMs: 100, maxDelayMs: 10_000, jitter: 0.25 });
    const context: RetryContext = { sessionId: "s1", runId: "r1", attempt: 1, error: { message: "busy", code: 503 } };

    assert.equal((await policy.decide(context)).retry, true);
    const low = createDefaultRetryPolicy({ baseDelayMs: 100, maxDelayMs: 10_000, jitter: 0.25, random: () => 0 });
    const high = createDefaultRetryPolicy({ baseDelayMs: 100, maxDelayMs: 10_000, jitter: 0.25, random: () => 1 });
    assert.equal((await low.decide(context)).delayMs, 75);
    assert.equal((await high.decide(context)).delayMs, 125);
    for (let i = 0; i < 50; i += 1) {
      const delay = (await policy.decide(context)).delayMs!;
      assert.ok(delay >= 75 && delay <= 125, `delay ${delay} outside ±25% jitter band`);
    }
  });

  it("honors error.retryAfterMs capped at maxDelayMs", async () => {
    const policy = createDefaultRetryPolicy({ baseDelayMs: 10, maxDelayMs: 1000, jitter: 0 });
    const context: RetryContext = {
      sessionId: "s1",
      runId: "r1",
      attempt: 1,
      error: { message: "rate limited", code: 429, retryAfterMs: 500 },
    };

    assert.deepEqual(await policy.decide(context), { retry: true, delayMs: 500 });
    assert.deepEqual(await policy.decide({ ...context, error: { ...context.error, retryAfterMs: 60_000 } }), {
      retry: true,
      delayMs: 1000,
    });
    // Jitter still applies on top of the hint.
    const jittered = createDefaultRetryPolicy({ baseDelayMs: 10, maxDelayMs: 1000, jitter: 0.5, random: () => 0 });
    assert.equal((await jittered.decide(context)).delayMs, 250);
  });

  it("errorToErrorInfo carries a numeric retryAfterMs hint", () => {
    const info = errorToErrorInfo(Object.assign(new Error("slow down"), { code: 429, retryAfterMs: 2500 }));
    assert.equal(info.retryAfterMs, 2500);
    assert.equal(errorToErrorInfo(Object.assign(new Error("x"), { retryAfterMs: -1 })).retryAfterMs, undefined);
    assert.equal(errorToErrorInfo(new Error("x")).retryAfterMs, undefined);
  });

  it("default retry policy does not retry abort or non transient errors", async () => {
    const policy = createDefaultRetryPolicy({ maxAttempts: 3 });

    assert.equal(
      (await policy.decide({ sessionId: "s1", runId: "r1", attempt: 1, error: { name: "AbortError", message: "aborted" } })).retry,
      false,
    );
    assert.equal(
      (await policy.decide({ sessionId: "s1", runId: "r1", attempt: 1, error: { message: "bad request", code: 400 } })).retry,
      false,
    );
    assert.equal(isTransientErrorInfo({ message: "temporary unavailable" }), true);
  });

  it("provider error preserves safe error code for retry without leaking secrets", () => {
    const event = providerError(Object.assign(new Error("failed token-123"), { code: 429 }), ["token-123"]);
    const info = errorToErrorInfo({ message: "timeout token-123", code: "ETIMEDOUT" }, ["token-123"]);

    assert.equal(event.type === "error" ? event.error.code : undefined, 429);
    assert.equal(event.type === "error" ? event.error.message : undefined, "failed [REDACTED]");
    assert.deepEqual(info, { message: "timeout [REDACTED]", code: "ETIMEDOUT" });
  });
});
