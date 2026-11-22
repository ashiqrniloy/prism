import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { anthropicMessagesEvents, parseRetryAfterMs, providerPackage } from "../provider-kit/index.js";
import {
  createAgent,
  createDefaultRetryPolicy,
  isTransientErrorInfo,
  type ErrorInfo,
  type ModelProvider,
  type ProviderEvent,
} from "../index.js";
import { errorToErrorInfo } from "../redaction.js";
import { mergeRetry } from "../models/retry.js";
import { providerDone, providerTextDelta } from "../models/events.js";
import { failedRun } from "./run-result-helpers.js";

/** A provider that fails `failures` times with `error`, then answers "ok". */
function flakyProvider(error: ErrorInfo, failures = 1): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      id: "mock",
      async *generate() {
        calls += 1;
        if (calls <= failures) yield { type: "error", error };
        else yield providerTextDelta("ok");
        yield providerDone();
      },
    },
  };
}

async function agentWith(provider: ModelProvider, extra: Record<string, unknown> = {}) {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [provider])],
    ...extra,
  });
  return agent.session();
}

const decide = (error: ErrorInfo, attempt = 1, options = {}) =>
  createDefaultRetryPolicy({ jitter: 0, ...options }).decide({ sessionId: "s", runId: "r", attempt, error });

describe("retry defaults (plan 227 Task 2)", () => {
  it("single_429_is_retried_by_default", async () => {
    // retry-after-ms keeps the test fast and proves the hint, not the 500 ms backoff, sets the wait.
    const { provider, calls } = flakyProvider({ message: "slow down", code: 429, failureClass: "rate_limited", retryAfterMs: 5 });
    const result = await (await agentWith(provider)).run("Hi");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "ok");
    assert.equal(calls(), 2);
  });

  it("default_policy_has_four_attempts_and_exponential_backoff", async () => {
    const error = { message: "busy", code: 503 };
    assert.deepEqual(await decide(error, 1), { retry: true, delayMs: 500 });
    assert.deepEqual(await decide(error, 2), { retry: true, delayMs: 1000 });
    assert.deepEqual(await decide(error, 3), { retry: true, delayMs: 2000 });
    assert.deepEqual(await decide(error, 4), { retry: false });
    assert.deepEqual(await decide(error, 9, { maxAttempts: 20 }), { retry: true, delayMs: 30_000 }, "capped at 30 s");
    assert.deepEqual(mergeRetry(undefined, undefined), {}, "no configuration means the default policy");
  });

  it("retry_false_disables_default_retry", async () => {
    for (const config of [{ retry: false }, {}]) {
      const { provider, calls } = flakyProvider({ message: "busy", code: 503 });
      const session = await agentWith(provider, config);
      await failedRun(session.run("Hi", "retry" in config ? undefined : { retry: false }), /busy/);
      assert.equal(calls(), 1);
    }
    assert.equal(mergeRetry(false, undefined), undefined);
    assert.equal(mergeRetry({ maxAttempts: 2 }, false), undefined);
    assert.deepEqual(mergeRetry(false, { maxAttempts: 2 }), { maxAttempts: 2 }, "a run can turn retry back on");
  });

  it("retry_after_within_bound_is_honored_exactly", async () => {
    const random = () => 1; // full jitter would add 25%; a hint is never jittered
    const hint = { message: "slow down", code: 429, retryAfterMs: 20_000 };
    assert.deepEqual(await decide(hint, 1, { jitter: 0.25, random }), { retry: true, delayMs: 20_000 }, "not capped by maxDelayMs");
    assert.deepEqual(await decide({ ...hint, retryAfterMs: 60_000 }), { retry: true, delayMs: 60_000 }, "the bound is inclusive");
    // End to end: the run sleeps for the hint, not the 500 ms default backoff.
    const { provider } = flakyProvider({ message: "slow down", code: 429, retryAfterMs: 40 });
    const started = performance.now();
    const result = await (await agentWith(provider, { retry: { baseDelayMs: 5_000 } })).run("Hi");
    const elapsed = performance.now() - started;
    assert.equal(result.status, "completed");
    assert.ok(elapsed >= 35 && elapsed < 2_000, `waited ${elapsed} ms`);
  });

  it("retry_after_beyond_bound_fails_without_sleeping", async () => {
    assert.deepEqual(await decide({ message: "slow down", code: 429, retryAfterMs: 60_001 }), { retry: false });
    // Plan 239 Task 4: the host's `maxRetryAfterMs` is the ceiling; no fixed cap sits above it.
    assert.deepEqual(
      await decide({ message: "slow down", code: 429, retryAfterMs: 700_000 }, 1, { maxRetryAfterMs: 10_000_000 }),
      { retry: true, delayMs: 700_000 },
      "a host-raised maxRetryAfterMs is honored past 600 s",
    );
    assert.deepEqual(await decide({ message: "slow down", code: 429, retryAfterMs: 700_001 }, 1, { maxRetryAfterMs: 700_000 }), {
      retry: false,
    });
    const { provider, calls } = flakyProvider({ message: "slow down", code: 429, failureClass: "rate_limited", retryAfterMs: 120_000 });
    const started = performance.now();
    const result = await failedRun((await agentWith(provider)).run("Hi"), /slow down/);
    assert.ok(performance.now() - started < 1_000, "did not sleep");
    assert.equal(calls(), 1);
    assert.equal(result.error?.failureClass, "rate_limited");
    assert.equal(result.error?.retryAfterMs, 120_000, "the hint stays on the error");
  });

  it("econnaborted_is_transient", () => {
    const aborted = Object.assign(new TypeError("socket connection aborted"), { code: "ECONNABORTED" });
    assert.equal(isTransientErrorInfo(errorToErrorInfo(aborted)), true, "wording no longer reads as an abort");
    for (const code of [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ENOTFOUND",
      "EPIPE",
      "UND_ERR_CONNECT_TIMEOUT",
    ])
      assert.equal(isTransientErrorInfo({ message: "x", code }), true, code);
  });

  it("http_409_is_not_retried", async () => {
    assert.equal(isTransientErrorInfo({ message: "conflict", code: 409 }), false);
    assert.equal(isTransientErrorInfo({ message: "temporarily unavailable, rate limit, timeout" }), false, "message text is never read");
  });

  it("abort_error_is_never_retried", () => {
    assert.equal(isTransientErrorInfo({ name: "AbortError", message: "x", code: 20, failureClass: "transient" }), false);
  });

  it("retry_wait_ends_on_run_abort", async () => {
    const { provider, calls } = flakyProvider({ message: "busy", code: 503 }, 5);
    const controller = new AbortController();
    const run = (await agentWith(provider, { retry: { baseDelayMs: 10_000 } })).run("Hi", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = performance.now();
    controller.abort(new Error("cancelled"));
    await failedRun(run, /cancelled|aborted/i, "aborted");
    assert.ok(performance.now() - started < 1_000);
    assert.equal(calls(), 1);
  });

  it("quota_and_auth_are_never_retried", () => {
    for (const failureClass of ["quota", "auth", "permanent", "context_overflow"] as const)
      assert.equal(isTransientErrorInfo({ message: "x", code: 429, failureClass }), false, failureClass);
    assert.equal(isTransientErrorInfo({ message: "x", failureClass: "rate_limited" }), true);
    assert.equal(isTransientErrorInfo({ message: "x", failureClass: "transient" }), true);
  });

  it("parse_retry_after_forms", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    assert.equal(parseRetryAfterMs({ "retry-after-ms": "1500.4", "retry-after": "9" }), 1500, "retry-after-ms wins and rounds");
    assert.equal(parseRetryAfterMs(new Headers({ "Retry-After": "2" })), 2000);
    assert.equal(parseRetryAfterMs({ "Retry-After": "1.5" }), 1500);
    assert.equal(parseRetryAfterMs({ "retry-after": "Wed, 21 Oct 2015 07:28:10 GMT" }, undefined, now), 10_000);
    assert.equal(parseRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", undefined, now), 0, "a past date is no wait");
    assert.equal(parseRetryAfterMs({}, "3"), 3000, "a body value is seconds");
    assert.equal(parseRetryAfterMs({ "retry-after": "nonsense" }, 4), 4000, "a malformed header falls through to the body");
    for (const bad of ["", "soon", "-1", "-0.5"]) assert.equal(parseRetryAfterMs({ "retry-after": bad }), undefined, bad);
    assert.equal(parseRetryAfterMs({ "retry-after-ms": "-5" }), undefined);
    assert.equal(parseRetryAfterMs(null), undefined);
  });

  it("anthropic_rate_limit_error_is_rate_limited", async () => {
    const classOf = async (type: string) => {
      const body = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message: "m" } })}\n\n`;
      const events: ProviderEvent[] = [];
      for await (const event of anthropicMessagesEvents(new Response(body).body!)) events.push(event);
      const error = events.find((event) => event.type === "error");
      return error?.type === "error" ? error.error.failureClass : undefined;
    };
    assert.equal(await classOf("rate_limit_error"), "rate_limited");
    assert.equal(await classOf("overloaded_error"), "transient");
    assert.equal(await classOf("api_error"), "transient");
    assert.equal(await classOf("invalid_request_error"), "permanent");
  });

  it("responses_wire_codes_classify_like_anthropic", async () => {
    const { classifyProviderFailure } = await import("../provider-kit/transport.js");
    assert.equal(classifyProviderFailure(Object.assign(new Error("x"), { code: "rate_limit_exceeded" })), "rate_limited");
    assert.equal(classifyProviderFailure(Object.assign(new Error("x"), { code: "server_error" })), "transient");
    assert.equal(classifyProviderFailure(Object.assign(new Error("x"), { code: "ENOTFOUND" })), "transient");
    assert.equal(classifyProviderFailure(Object.assign(new Error("x"), { code: "EPIPE" })), "transient");
  });

  it("unsafe_wire_code_never_reaches_error_info", () => {
    assert.equal(errorToErrorInfo(Object.assign(new Error("x"), { code: "rate_limit_exceeded" })).code, "rate_limit_exceeded");
    assert.equal(errorToErrorInfo(Object.assign(new Error("x"), { code: "key sk-live-abc leaked here" })).code, undefined);
    assert.equal(errorToErrorInfo(Object.assign(new Error("x"), { code: "a".repeat(65) })).code, undefined);
    assert.equal(errorToErrorInfo(Object.assign(new Error("x"), { code: 503 })).code, 503);
  });
});
