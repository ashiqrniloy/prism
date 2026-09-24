import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SYSTEMONE_MAX_RETRIES,
  isRetryableSystemOneStatus,
  mapSystemOneUsage,
  postSystemOne,
  SystemOneAuthError,
  type SystemOneBody,
  type SystemOneClientOptions,
  SystemOneInvalidRequestError,
  SystemOneRetryExhaustedError,
} from "../systemone.js";

interface FakeCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function fakeFetch(handler: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function sentHeaders(call: FakeCall): Record<string, string> {
  assert.ok(call.init?.headers, "request carried headers");
  return call.init.headers as Record<string, string>;
}

const BODY: SystemOneBody = {
  model: "jev-latest",
  state: '{"body":"run the tests"}',
  questions: { risky: { type: "noul", instructions: "Is this destructive?" } },
};

const OK_RESPONSE = {
  model: "jev-1.13.0",
  answers: { risky: { type: "noul", noul: 0.91 } },
  usage: { input_tokens: 96, output_tokens: 0 },
};

function options(fetchImpl: typeof fetch, overrides: Partial<SystemOneClientOptions> = {}): SystemOneClientOptions {
  return {
    provider: "TypeSafe Jev",
    baseUrl: "https://api.typesafe.ai/",
    apiKey: "sk-secret",
    fetch: fetchImpl,
    jitter: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    ...overrides,
  };
}

describe("@arnilo/prism-providers/shared (systemone)", () => {
  it("systemone_posts_to_v1_systemone_with_bearer_auth_and_parses_answers", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const result = await postSystemOne(BODY, options(impl));
    assert.deepEqual(result, OK_RESPONSE);
    assert.equal(calls.length, 1, "one round trip per successful request");
    assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone", "base URL trailing slash is trimmed");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(sentHeaders(calls[0]).authorization, "Bearer sk-secret");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), BODY);
  });

  it("systemone_omits_authorization_when_no_key_is_configured", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    await postSystemOne(BODY, options(impl, { apiKey: undefined }));
    assert.equal(sentHeaders(calls[0]).authorization, undefined);
  });

  it("systemone_maps_usage_to_input_tokens_only", () => {
    assert.deepEqual(mapSystemOneUsage({ input_tokens: 96, output_tokens: 0 }), { inputTokens: 96, outputTokens: 0, totalTokens: 96 });
    assert.deepEqual(mapSystemOneUsage({ input_tokens: 12 }), { inputTokens: 12, outputTokens: 0, totalTokens: 12 });
    assert.equal(mapSystemOneUsage(undefined), undefined);
  });

  it("systemone_retry_status_table_covers_429_and_every_5xx", () => {
    for (const status of [429, 500, 501, 503, 529, 599]) assert.equal(isRetryableSystemOneStatus(status), true, `${status} retryable`);
    for (const status of [400, 401, 403, 404, 422]) assert.equal(isRetryableSystemOneStatus(status), false, `${status} not retryable`);
  });

  it("systemone_401_is_an_auth_error_with_redacted_body_and_no_retry", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: { code: "invalid_api_key", message: "bad key sk-secret" } }, 401));
    await assert.rejects(postSystemOne(BODY, options(impl)), (error: unknown) => {
      assert.ok(error instanceof SystemOneAuthError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 401, "numeric code is the HTTP status");
      assert.match(error.message, /invalid_api_key/);
      assert.match(error.message, /bad key/);
      assert.doesNotMatch(error.message, /sk-secret/, "the API key is redacted from the echoed body");
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    });
    assert.equal(calls.length, 1, "401 is never retried");
  });

  it("systemone_422_surfaces_field_detail_without_retry", async () => {
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ error: { message: "questions.verdict.criteria: expected 2-255 options" } }, 422),
    );
    await assert.rejects(postSystemOne(BODY, options(impl)), (error: unknown) => {
      assert.ok(error instanceof SystemOneInvalidRequestError);
      assert.equal(error.code, 422);
      assert.match(error.message, /questions\.verdict\.criteria/);
      assert.match(error.message, /2-255 options/);
      return true;
    });
    assert.equal(calls.length, 1, "422 is never retried");
  });

  it("systemone_retries_a_429_honoring_retry_after_then_succeeds", async () => {
    let attempts = 0;
    const { impl, calls } = fakeFetch(() =>
      ++attempts === 1 ? jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "1" }) : jsonResponse(OK_RESPONSE),
    );
    const result = await postSystemOne(BODY, options(impl));
    assert.deepEqual(result, OK_RESPONSE);
    assert.equal(calls.length, 2, "one retry after the 429");
  });

  it("systemone_retries_529_twice_then_succeeds", async () => {
    assert.equal(DEFAULT_SYSTEMONE_MAX_RETRIES, 2);
    let attempts = 0;
    const { impl, calls } = fakeFetch(() =>
      ++attempts <= 2 ? jsonResponse({ error: { message: "overloaded" } }, 529) : jsonResponse(OK_RESPONSE),
    );
    const result = await postSystemOne(BODY, options(impl));
    assert.deepEqual(result, OK_RESPONSE);
    assert.equal(calls.length, 3, "two retries + the original attempt");
  });

  it("systemone_exhausted_retries_throw_a_typed_error_carrying_retry_after", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: { message: "overloaded" } }, 529, { "retry-after": "2" }));
    await assert.rejects(postSystemOne(BODY, options(impl)), (error: unknown) => {
      assert.ok(error instanceof SystemOneRetryExhaustedError);
      assert.equal(error.status, 529);
      assert.equal(error.retryAfterMs, 2000);
      return true;
    });
    assert.equal(calls.length, 3, "bounded by maxRetries");
  });

  it("systemone_already_aborted_signal_never_fetches", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(OK_RESPONSE));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(postSystemOne(BODY, options(impl), controller.signal));
    assert.equal(calls.length, 0);
  });
});
