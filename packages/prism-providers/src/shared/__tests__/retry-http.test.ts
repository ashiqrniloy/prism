import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCommandCodeError } from "../../commandcode/index.js";
import { classifyHyperError } from "../../hyper/index.js";
import { classifyNeuralWattError } from "../../neuralwatt/index.js";
import { parseErrorBody, providerHttpError, RETRYABLE_STATUSES, readRetryAfterMs } from "../retry-http.js";

describe("@arnilo/prism-providers/shared (retry-http)", () => {
  it("retry_http_status_table_covers_429_and_5xx_only", () => {
    for (const status of [429, 500, 502, 503]) assert.equal(RETRYABLE_STATUSES.has(status), true, `${status} retryable`);
    for (const status of [400, 401, 402, 403, 404, 418, 501, 504])
      assert.equal(RETRYABLE_STATUSES.has(status), false, `${status} not retryable`);
  });

  it("retry_http_classifiers_agree_on_the_shared_status_table", () => {
    for (const status of [400, 401, 402, 403, 404, 429, 500, 502, 503, 504]) {
      const expected = RETRYABLE_STATUSES.has(status);
      assert.equal(classifyHyperError({ status }).retryable, expected, `hyper ${status}`);
      assert.equal(classifyNeuralWattError({ status }).retryable, expected, `neuralwatt ${status}`);
      assert.equal(classifyCommandCodeError({ status }).retryable, expected, `commandcode ${status}`);
      for (const decision of [classifyHyperError({ status }), classifyNeuralWattError({ status }), classifyCommandCodeError({ status })]) {
        assert.equal(decision.code, status, "numeric code is the HTTP status");
        assert.equal(decision.retryAfterMs, undefined, `${status} has no retry-after hint`);
      }
    }
  });

  it("retry_http_reads_retry_after_from_header_objects_and_headers_instances", () => {
    assert.equal(readRetryAfterMs({ "retry-after": "2" }), 2000);
    assert.equal(readRetryAfterMs({ "Retry-After": "2" }), 2000, "header names are case-insensitive");
    assert.equal(readRetryAfterMs({ "retry-after": "1.5" }), 1500, "fractional seconds round to ms");
    assert.equal(readRetryAfterMs(new Headers({ "retry-after": "3" })), 3000);
    assert.equal(readRetryAfterMs({ "retry-after": " 4 " }), 4000, "surrounding whitespace is tolerated");
  });

  it("retry_http_returns_no_hint_for_absent_or_malformed_values", () => {
    assert.equal(readRetryAfterMs(undefined), undefined);
    assert.equal(readRetryAfterMs({}), undefined);
    assert.equal(readRetryAfterMs({ "retry-after": "" }), undefined);
    assert.equal(readRetryAfterMs({ "retry-after": "   " }), undefined);
    assert.equal(readRetryAfterMs({ "retry-after": "soon" }), undefined);
    assert.equal(readRetryAfterMs({ "retry-after": "-1" }), undefined, "negative delays are not a hint");
    // The body fallback is off unless the caller passes it (NeuralWatt's `error.retry_after`).
    assert.equal(readRetryAfterMs({}, 5), 5000);
    assert.equal(readRetryAfterMs({}, "5"), 5000);
    assert.equal(readRetryAfterMs({}, Number.NaN), undefined);
    assert.equal(readRetryAfterMs({}, { seconds: 5 }), undefined);
    assert.equal(readRetryAfterMs({ "retry-after": "1" }, 9), 1000, "an explicit header wins over the body field");
  });

  it("retry_http_parse_error_body_accepts_only_object_envelopes", () => {
    assert.deepEqual(parseErrorBody({ error: { code: "rate_limit_error" } }), { error: { code: "rate_limit_error" } });
    for (const body of [undefined, null, "text", 42, [], { error: "x" }, { error: [1] }, {}]) {
      assert.equal(parseErrorBody(body), undefined, JSON.stringify(body) ?? "undefined");
    }
  });

  it("retry_http_builds_a_redacted_error_with_a_numeric_code", () => {
    const error = providerHttpError(
      "Provider",
      { status: 429, code: 429, errorCode: "rate_limit_error", retryAfterMs: 2000 },
      '{"error":{"message":"slow down secret-token-123"}}',
      ["secret-token-123"],
    );
    assert.match(error.message, /^Provider request failed: 429 code=rate_limit_error retry_after_ms=2000 /);
    assert.doesNotMatch(error.message, /secret-token-123/);
    assert.match(error.message, /\[REDACTED\]/);
    assert.equal((error as { code?: number }).code, 429);
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    assert.deepEqual({ enumerable: descriptor?.enumerable, writable: descriptor?.writable }, { enumerable: true, writable: false });
  });

  it("retry_http_omits_optional_message_parts", () => {
    const plain = providerHttpError("Provider", { status: 500, code: 500 }, "", []);
    assert.equal(plain.message, "Provider request failed: 500");
    assert.equal((plain as { code?: number }).code, 500);
    const withBody = providerHttpError("Provider", { status: 503, code: 503 }, "upstream unavailable", []);
    assert.equal(withBody.message, "Provider request failed: 503 upstream unavailable");
  });
});
