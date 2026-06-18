import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDefaultRetryPolicy, isTransientErrorInfo, providerError, type RetryContext } from "../index.js";
import { errorToErrorInfo } from "../redaction.js";

describe("retry policy", () => {
  it("default retry policy retries known transient codes with capped backoff", async () => {
    const policy = createDefaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 15 });
    const context: RetryContext = { sessionId: "s1", runId: "r1", attempt: 1, error: { message: "busy", code: 503 } };

    assert.deepEqual(await policy.decide(context), { retry: true, delayMs: 10 });
    assert.deepEqual(await policy.decide({ ...context, attempt: 2 }), { retry: true, delayMs: 15 });
    assert.deepEqual(await policy.decide({ ...context, attempt: 3 }), { retry: false });
  });

  it("default retry policy does not retry abort or non transient errors", async () => {
    const policy = createDefaultRetryPolicy({ maxAttempts: 3 });

    assert.equal((await policy.decide({ sessionId: "s1", runId: "r1", attempt: 1, error: { name: "AbortError", message: "aborted" } })).retry, false);
    assert.equal((await policy.decide({ sessionId: "s1", runId: "r1", attempt: 1, error: { message: "bad request", code: 400 } })).retry, false);
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
