import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest } from "@arnilo/prism";
import { classifyNeuralWattError, createNeuralWattProvider, neuralWattHttpError } from "../index.js";

function jsonResponse(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function textResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function errorBody(code: string, retryAfter?: number, retryStrategy?: object): object {
  return { error: { code, message: `error ${code}`, ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}), ...(retryStrategy ? { retry_strategy: retryStrategy } : {}) } };
}

describe("@arnilo/prism-provider-neuralwatt (retry)", () => {
  it("neuralwatt_retry_classifier_non_retryable_client_statuses", () => {
    for (const status of [400, 401, 402, 403, 404]) {
      const decision = classifyNeuralWattError({ status, body: errorBody("bad_request") });
      assert.equal(decision.retryable, false, `${status} should be non-retryable`);
      assert.equal(decision.code, status);
      assert.equal(decision.retryAfterMs, undefined, `${status} has no retry-after`);
      assert.equal(decision.strategy, undefined, `${status} has no strategy`);
    }
  });

  it("neuralwatt_retry_classifier_honors_retry_after_429", () => {
    const strategy = { type: "concurrent_budget", suggested_initial_delay_s: 1, max_delay_s: 60, backoff: "exponential", jitter: "full" };
    const decision = classifyNeuralWattError({
      status: 429,
      headers: { "retry-after": "2" },
      body: errorBody("concurrent_budget_exceeded", 2, strategy),
    });
    assert.equal(decision.retryable, true);
    assert.equal(decision.code, 429);
    assert.equal(decision.retryAfterMs, 2000);
    assert.equal(decision.errorCode, "concurrent_budget_exceeded");
    assert.deepEqual(decision.strategy, strategy);
  });

  it("neuralwatt_retry_classifier_reads_body_retry_after_when_header_absent", () => {
    const decision = classifyNeuralWattError({ status: 503, body: errorBody("model_overloaded", 5) });
    assert.equal(decision.retryable, true);
    assert.equal(decision.retryAfterMs, 5000);
  });

  it("neuralwatt_retry_classifier_retries_500_502_503", () => {
    for (const status of [500, 502, 503]) {
      const decision = classifyNeuralWattError({ status, body: errorBody("server_error") });
      assert.equal(decision.retryable, true, `${status} should be retryable`);
      assert.equal(decision.code, status);
    }
  });

  it("neuralwatt_retry_classifier_tolerates_malformed_json", () => {
    // undefined body, null body, non-object body, missing error field
    assert.equal(classifyNeuralWattError({ status: 429 }).retryable, true);
    assert.equal(classifyNeuralWattError({ status: 429, body: null }).retryable, true);
    assert.equal(classifyNeuralWattError({ status: 429, body: "not json" }).retryable, true);
    assert.equal(classifyNeuralWattError({ status: 429, body: { foo: 1 } }).retryable, true);
    assert.equal(classifyNeuralWattError({ status: 429, body: { foo: 1 } }).retryAfterMs, undefined);
    // Unknown status falls back to non-retryable.
    assert.equal(classifyNeuralWattError({ status: 418 }).retryable, false);
    assert.equal(classifyNeuralWattError({ status: 418 }).code, 418);
  });

  it("neuralwatt_http_error_sets_code_and_redacts", () => {
    const decision = classifyNeuralWattError({ status: 429, headers: { "retry-after": "1" }, body: errorBody("tpm_uncached_exceeded", 1) });
    const error = neuralWattHttpError(decision, "body with secret-neuralwatt-token", ["secret-neuralwatt-token"]);
    assert.equal((error as { code?: number }).code, 429);
    assert.match(error.message, /NeuralWatt request failed: 429/);
    assert.match(error.message, /code=tpm_uncached_exceeded/);
    assert.match(error.message, /retry_after_ms=1000/);
    assert.doesNotMatch(error.message, /secret-neuralwatt-token/);
    assert.match(error.message, /\[REDACTED\]/);
  });

  it("neuralwatt_provider_error_redacts_retry_body", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "secret-neuralwatt-token",
      fetch: (async () =>
        textResponse(429, `{"error":{"code":"concurrent_budget_exceeded","message":"slow down secret-neuralwatt-token","retry_after":1}}`, { "retry-after": "1" })) as typeof fetch,
    });
    const request: ProviderRequest = {
      model: { provider: "neuralwatt", model: "glm-5.2", capabilities: { input: ["text"], output: ["text"], streaming: true }, limits: { contextWindow: 1024 } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const events = [] as { type: string; error?: { code?: number | string; message?: string } }[];
    for await (const event of provider.generate(request)) events.push(event as never);
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, "error event emitted");
    assert.equal(errorEvent?.error?.code, 429, "error code is the numeric HTTP status");
    assert.doesNotMatch(errorEvent?.error?.message ?? "", /secret-neuralwatt-token/, "token redacted from provider error");
    assert.match(errorEvent?.error?.message ?? "", /\[REDACTED\]/);
  });

  it("neuralwatt_provider_error_on_500_is_retryable_code", async () => {
    const provider = createNeuralWattProvider({
      apiKey: "fake-neuralwatt-key",
      fetch: (async () => jsonResponse(500, errorBody("server_error"))) as typeof fetch,
    });
    const request: ProviderRequest = {
      model: { provider: "neuralwatt", model: "glm-5.2", capabilities: { input: ["text"], output: ["text"], streaming: true }, limits: { contextWindow: 1024 } },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const events = [] as { type: string; error?: { code?: number | string } }[];
    for await (const event of provider.generate(request)) events.push(event as never);
    const errorEvent = events.find((event) => event.type === "error");
    assert.equal(errorEvent?.error?.code, 500);
  });
});
