import { describe, expect, test } from "bun:test";
import { resolveInputCap } from "@arnilo/prism";
import { MAX_OUTPUT_TOKENS } from "../session-bench/run.mjs";
import { buildLongRule, MAIN_OUTPUT_TOKENS, smokeFailure, upstreamRetryFetch, withoutConnectTimeout } from "./live.mjs";
import { productInputCap } from "./pressure.mjs";
import { longSharedConfig, mainModel } from "./run.mjs";

const UPSTREAM =
  '{"error":{"message":"Upstream request failed: [invalid_request_error] reasoning_effort \'low\' is not supported","type":"invalid_request_error"}}';
const answers = (...list) => {
  const sent = [];
  const fetch = async (_input, init) => {
    sent.push(init?.body);
    const [status, body] = list[Math.min(sent.length - 1, list.length - 1)];
    return new Response(body, { status });
  };
  return { fetch, sent };
};
const noSleep = { sleep: async () => {} };

describe("upstreamRetryFetch (plan 218.5 Task 7)", () => {
  test("an upstream-failure 400 is sent again and the later answer reaches the run", async () => {
    const { fetch, sent } = answers([400, UPSTREAM], [200, "ok"]);
    const response = await upstreamRetryFetch(fetch, noSleep)("u", { body: "{}" });
    expect(response.status).toBe(200);
    expect(sent.length).toBe(2);
  });

  test("a 400 that keeps naming an upstream failure is handed on after 3 resends", async () => {
    const { fetch, sent } = answers([400, UPSTREAM]);
    const response = await upstreamRetryFetch(fetch, noSleep)("u", { body: "{}" });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(UPSTREAM);
    expect(sent.length).toBe(4);
  });

  test("a reasoning_effort refusal that outlasts the resends is sent once more without the parameter", async () => {
    const { fetch, sent } = answers([400, UPSTREAM], [400, UPSTREAM], [400, UPSTREAM], [400, UPSTREAM], [200, "ok"]);
    const lines = [];
    const body = JSON.stringify({ model: "m", reasoning_effort: "low", messages: [] });
    const response = await upstreamRetryFetch(fetch, { ...noSleep, log: (line) => lines.push(line) })("u", { body });
    expect(response.status).toBe(200);
    expect(sent.length).toBe(5);
    expect(sent.slice(0, 4).every((sentBody) => sentBody === body)).toBe(true);
    expect(JSON.parse(sent[4])).toEqual({ model: "m", messages: [] });
    expect(lines.at(-1)).toMatch(/without it/);
  });

  test("another upstream 400 that outlasts the resends is handed on unchanged", async () => {
    const other = '{"error":{"message":"Upstream request failed: [server_error] overloaded"}}';
    const { fetch, sent } = answers([400, other]);
    const response = await upstreamRetryFetch(fetch, noSleep)("u", { body: JSON.stringify({ reasoning_effort: "low" }) });
    expect(response.status).toBe(400);
    expect(sent.length).toBe(4);
  });

  test("a 400 the gateway raises itself is handed on at once", async () => {
    const own = '{"type":"error","error":{"type":"MissingSessionID","message":"Request is missing x-opencode-session"}}';
    const { fetch, sent } = answers([400, own]);
    const response = await upstreamRetryFetch(fetch, noSleep)("u", { body: "{}" });
    expect(response.status).toBe(400);
    expect(sent.length).toBe(1);
  });

  test("other statuses pass through untouched", async () => {
    const { fetch, sent } = answers([503, "busy"]);
    expect((await upstreamRetryFetch(fetch, noSleep)("u", {})).status).toBe(503);
    expect(sent.length).toBe(1);
  });
});

describe("withoutConnectTimeout (plan 218.5 Task 7)", () => {
  test("every request turns the kernel's connect timeout off and keeps the rest of its options", async () => {
    const seen = [];
    const provider = {
      id: "p",
      async *generate(input) {
        seen.push(input.options);
        yield { type: "done" };
      },
    };
    const [wrapped] = withoutConnectTimeout([provider]);
    expect(wrapped.id).toBe("p");
    for await (const _ of wrapped.generate({ options: { sessionId: "s", timeouts: { idleMs: 5 } } }));
    for await (const _ of wrapped.generate({}));
    expect(seen).toEqual([{ sessionId: "s", timeouts: { idleMs: 5, connectMs: null } }, { timeouts: { connectMs: null } }]);
  });
});

describe("the main agent's output reserve (plan 218.5 Task 7, owner 2026-11-24)", () => {
  test("the main model asks for 16,384 output tokens and the product's input cap stays the design's", () => {
    const model = mainModel(
      { provider: "p", model: "m", parameters: { maxTokens: 2_048, temperature: 0 } },
      {
        window: 32_000,
        mainOutputTokens: MAIN_OUTPUT_TOKENS,
      },
    );
    expect(model.limits).toEqual({ contextWindow: 46_336, maxOutputTokens: 16_384 });
    expect(model.parameters).toEqual({ maxTokens: 16_384, temperature: 0 });
    expect(resolveInputCap({}, model)).toBe(productInputCap(32_000));
    expect(model.limits.contextWindow - model.limits.maxOutputTokens).toBe(32_000 - MAX_OUTPUT_TOKENS);
  });

  test("at the default reserve the model and the shared config are the offline ones", () => {
    expect(mainModel({ provider: "p", model: "m" }, { window: 32_000 })).toEqual({
      provider: "p",
      model: "m",
      limits: { contextWindow: 32_000, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });
    expect("mainOutputTokens" in longSharedConfig({ window: 32_000 })).toBe(false);
    expect(longSharedConfig({ window: 32_000, mainOutputTokens: 16_384 }).mainOutputTokens).toBe(16_384);
  });

  test("the rule records the reserve and the main window", () => {
    const rule = buildLongRule();
    expect(rule.mainOutputTokens).toBe(16_384);
    expect(rule.mainWindow).toBe(46_336);
    expect(rule.maxOutputTokens).toBe(2_048);
    expect(rule.window).toBe(32_000);
  });
});

describe("the smoke rule (plan 218.5 Task 7, owner 2026-11-25)", () => {
  test("a provider error the retries absorbed is reported, not a miss; a faulted task is a miss", () => {
    const row = (status, providerErrors) => ({ status, meter: { providerErrors } });
    expect(smokeFailure(row({ 1: { status: "completed" }, 2: { status: "completed" } }, 1))).toBeUndefined();
    expect(smokeFailure(row({ 1: { status: "completed" }, 2: { status: "failed", code: "ERR_PRISM_RUN_LIMIT" } }, 0))).toBeUndefined();
    expect(smokeFailure(row({ 1: { status: "failed", code: "ERR_PROVIDER" } }, 2))).toBe("1 faulted tasks, 2 provider errors");
  });
});
