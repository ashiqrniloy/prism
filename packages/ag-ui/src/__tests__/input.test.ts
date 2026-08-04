import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgUiInput } from "../input.js";
import { resolveAgUiLimits } from "../limits.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  };
}

describe("parseAgUiInput", () => {
  it("retains official full request fields for a host projector without granting them authority", () => {
    const parsed = parseAgUiInput(
      input({
        parentRunId: "parent-1",
        state: { selected: "client" },
        context: [{ description: "selection", value: "untrusted" }],
        forwardedProps: { ui: { theme: "dark" } },
        tools: [{ name: "client_action", description: "client only", parameters: { type: "object" } }],
        resume: [{ interruptId: "run-1:1", status: "cancelled" }],
      }),
      resolveAgUiLimits(),
    );
    assert.equal(parsed.parentRunId, "parent-1");
    assert.equal(parsed.tools[0]?.name, "client_action");
    assert.deepEqual(parsed.state, { selected: "client" });
    assert.equal(parsed.resume[0]?.status, "cancelled");
  });

  it("rejects dangerous, deep, wide, and oversized media values before host callbacks", () => {
    const poisoned = JSON.parse(
      '{"threadId":"thread-1","runId":"run-1","state":{"__proto__":"bad"},"messages":[{"id":"user-1","role":"user","content":"hello"}],"tools":[],"context":[],"forwardedProps":{}}',
    );
    assert.throws(() => parseAgUiInput(poisoned, resolveAgUiLimits()), /forbidden key/);
    assert.throws(
      () => parseAgUiInput(input({ state: { one: { two: { three: true } } } }), resolveAgUiLimits({ maxJsonDepth: 2 })),
      /maxJsonDepth/,
    );
    assert.throws(
      () => parseAgUiInput(input({ state: { one: 1, two: 2, three: 3 } }), resolveAgUiLimits({ maxJsonProperties: 2 })),
      /maxJsonProperties/,
    );
    assert.throws(
      () =>
        parseAgUiInput(
          input({
            messages: [
              {
                id: "user-1",
                role: "user",
                content: [{ type: "image", source: { type: "data", value: "a".repeat(2_000), mimeType: "image/png" } }],
              },
            ],
          }),
          resolveAgUiLimits({ maxInputMediaBytes: 1024 }),
        ),
      /media/,
    );
  });
});
