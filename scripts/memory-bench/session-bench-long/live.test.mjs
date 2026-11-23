import { describe, expect, test } from "bun:test";
import { upstreamRetryFetch, withoutConnectTimeout } from "./live.mjs";

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
