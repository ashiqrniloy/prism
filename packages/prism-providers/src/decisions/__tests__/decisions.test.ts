import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { CredentialRequest } from "@arnilo/prism";
import * as laya from "../../laya/index.js";
import * as typesafe from "../../typesafe/index.js";
import {
  askSystemOneDecisions,
  DEFAULT_MAX_SYSTEMONE_STATE_BYTES,
  SystemOneAbortedError,
  SystemOneAuthError,
  type SystemOneBody,
  type SystemOneDecisionOptions,
  SystemOneError,
  SystemOneInvalidRequestError,
  SystemOneRetryExhaustedError,
} from "../index.js";

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

const RICH_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    route: { type: "choice", choice: "ask", probabilities: { run: 0.12, ask: 0.71, reject: 0.17 }, confidence: 0.71 },
    risk: { type: "noul", noul: 0.5 },
    quality: {
      type: "score",
      score: 1.7,
      legend: { "0": "opaque", "1": "partial", "2": "actionable" },
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      confidence: 0.7,
    },
  },
  usage: { input_tokens: 96, output_tokens: 0 },
};

const BODY: SystemOneBody = {
  model: "jev-latest",
  state: "rm -rf ./build",
  questions: {
    route: { type: "choice", instructions: "How should this be handled?", criteria: { run: "run", ask: "ask", reject: "reject" } },
    risk: { type: "noul", instructions: "Would running this destroy data?" },
  },
};

function options(fetchImpl: typeof fetch, overrides: Partial<SystemOneDecisionOptions> = {}): SystemOneDecisionOptions {
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

function noulQuestions(count: number): SystemOneBody["questions"] {
  const questions: Record<string, SystemOneBody["questions"][string]> = {};
  for (let index = 0; index < count; index += 1) {
    questions[`q${index}`] = { type: "noul", instructions: `question ${index}` };
  }
  return questions;
}

describe("@arnilo/prism-providers/decisions", () => {
  it("decisions_round_trip_preserves_raw_answers_model_usage_and_timing", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(RICH_RESPONSE));
    const result = await askSystemOneDecisions(BODY, options(impl));
    assert.equal(calls.length, 1, "one round trip per successful decision call");
    assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone", "base URL trailing slash is trimmed");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), BODY, "the body is sent verbatim");
    assert.equal(result.model, "jev-1.13.0", "the responding checkpoint is preserved, not the advisory request model");
    assert.deepEqual(result.answers, RICH_RESPONSE.answers, "raw probabilities, legend, confidence, and scores survive untouched");
    assert.equal(result.answers.risk.type === "noul" ? result.answers.risk.noul : undefined, 0.5, "a borderline noul stays a probability");
    assert.equal(result.answers.quality.type === "score" ? result.answers.quality.score : undefined, 1.7, "a score is not rounded");
    assert.deepEqual(result.usage, { inputTokens: 96, outputTokens: 0, totalTokens: 96 });
    assert.ok(Number.isFinite(result.timingMs) && result.timingMs >= 0, "elapsed time is reported");
  });

  it("decisions_failures_stay_typed_and_never_become_a_neutral_answer", async () => {
    const unauthorized = fakeFetch(() => jsonResponse({ error: { code: "invalid_api_key" } }, 401));
    await assert.rejects(askSystemOneDecisions(BODY, options(unauthorized.impl)), (error: unknown) => {
      assert.ok(error instanceof SystemOneAuthError);
      assert.equal(error.status, 401);
      return true;
    });

    const invalid = fakeFetch(() => jsonResponse({ error: { message: "questions.route.criteria: expected 2-255 options" } }, 422));
    await assert.rejects(askSystemOneDecisions(BODY, options(invalid.impl)), (error: unknown) => {
      assert.ok(error instanceof SystemOneInvalidRequestError);
      assert.match(error.message, /2-255 options/);
      return true;
    });

    const exhausted = fakeFetch(() => jsonResponse({ error: { message: "overloaded" } }, 529));
    await assert.rejects(askSystemOneDecisions(BODY, options(exhausted.impl, { maxRetries: 0 })), (error: unknown) => {
      assert.ok(error instanceof SystemOneRetryExhaustedError);
      assert.equal(error.status, 529);
      return true;
    });

    const controller = new AbortController();
    controller.abort();
    const aborted = fakeFetch(() => jsonResponse(RICH_RESPONSE));
    await assert.rejects(askSystemOneDecisions(BODY, options(aborted.impl), controller.signal), (error: unknown) => {
      assert.ok(error instanceof SystemOneAbortedError);
      assert.equal(error.status, 0, "an abort has no HTTP status");
      return true;
    });
    assert.equal(aborted.calls.length, 0, "a pre-aborted signal never fetches");
  });

  it("decisions_bounds_fail_before_fetch", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(RICH_RESPONSE));
    const cases: readonly (readonly [string, SystemOneBody, Partial<SystemOneDecisionOptions>?])[] = [
      ["too many questions", { ...BODY, questions: noulQuestions(257) }],
      ["too few choice options", { ...BODY, questions: { route: { type: "choice", instructions: "Pick", criteria: { only: "one" } } } }],
      [
        "too many score levels",
        {
          ...BODY,
          questions: {
            quality: {
              type: "score",
              instructions: "Rate",
              criteria: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            },
          },
        },
      ],
      ["missing instructions", { ...BODY, questions: { risk: { type: "noul" } as never } }],
      ["oversized state", { ...BODY, state: "x".repeat(200) }, { maxStateBytes: 64 }],
      ["invalid deadline", { ...BODY }, { timeoutMs: 0 }],
    ];
    for (const [name, body, overrides] of cases) {
      await assert.rejects(askSystemOneDecisions(body, options(impl, overrides)), (error: unknown) => {
        assert.ok(error instanceof SystemOneError, `${name}: typed error`);
        assert.equal(error.status, 0, `${name}: no HTTP status`);
        assert.match(error.message, /invalid System One decision request/, `${name}: names the violation`);
        return true;
      });
    }
    assert.equal(calls.length, 0, "every bound violation failed before any fetch");
  });

  it("decisions_accepts_the_documented_limits", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(RICH_RESPONSE));
    const body: SystemOneBody = { ...BODY, questions: noulQuestions(256) };
    await askSystemOneDecisions(body, options(impl));
    assert.equal(calls.length, 1, "256 questions and a default 256 KiB state bound pass");
    assert.equal(DEFAULT_MAX_SYSTEMONE_STATE_BYTES, 262_144);
  });

  it("decisions_resolves_the_credential_once_under_the_provider_and_redacts_it", async () => {
    const requests: CredentialRequest[] = [];
    const apiKey = {
      resolve: (request: CredentialRequest) => {
        requests.push(request);
        return { type: "api_key" as const, value: "sk-secret" };
      },
    };
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: { message: "upstream echoed sk-secret" } }, 529));
    await assert.rejects(askSystemOneDecisions(BODY, options(impl, { apiKey, maxRetries: 0 })), (error: unknown) => {
      assert.ok(error instanceof SystemOneRetryExhaustedError);
      assert.doesNotMatch(error.message, /sk-secret/, "the API key never reaches the error");
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(requests.length, 1, "the credential source is resolved exactly once");
    assert.equal(requests[0].provider, "TypeSafe Jev", "resolution uses the configured provider label");
    assert.equal(requests[0].name, "apiKey");
  });

  it("decisions_abort_between_retries_stops_retrying", async () => {
    const controller = new AbortController();
    const { impl, calls } = fakeFetch(() => {
      setTimeout(() => controller.abort(), 5);
      return jsonResponse({ error: { message: "rate limited" } }, 429);
    });
    await assert.rejects(
      askSystemOneDecisions(BODY, options(impl, { baseDelayMs: 200, maxRetries: 2 }), controller.signal),
      (error: unknown) => {
        assert.ok(error instanceof SystemOneAbortedError);
        return true;
      },
    );
    assert.equal(calls.length, 1, "the abort landed during the retry wait, not as another attempt");
  });

  it("decisions_deadline_composes_with_the_retry_loop_without_an_answer", async () => {
    const impl = ((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("deadline signal was not forwarded to fetch");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }) as typeof fetch;
    await assert.rejects(askSystemOneDecisions(BODY, options(impl, { timeoutMs: 20 })), (error: unknown) => {
      assert.ok(error instanceof SystemOneAbortedError);
      assert.match(error.message, /20ms deadline/);
      return true;
    });
  });

  it("decisions_surface_is_reexported_from_the_provider_packages", () => {
    assert.equal(typesafe.askSystemOneDecisions, askSystemOneDecisions);
    assert.equal(laya.askSystemOneDecisions, askSystemOneDecisions);
    assert.equal(typesafe.SystemOneAbortedError, SystemOneAbortedError);
    assert.equal(laya.SystemOneAbortedError, SystemOneAbortedError);
  });
});
