import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "../index.js";
import type { ProviderEvent, ProviderRequest } from "../index.js";

async function collect(provider = createMockProvider(), request: Partial<ProviderRequest> = {}) {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate({
    model: { provider: provider.id, model: "demo" },
    messages: [],
    ...request,
  })) {
    events.push(event);
  }
  return events;
}

describe("mock provider", () => {
  it("streams text and done", async () => {
    const provider = createMockProvider([providerTextDelta("Hello"), providerDone()]);

    assert.deepEqual(await collect(provider), [providerTextDelta("Hello"), providerDone()]);
  });

  it("streams tool calls", async () => {
    const call = toolCallContent("call_1", "lookup", { id: "1" });
    const provider = createMockProvider([providerToolCall(call), providerDone()]);

    assert.deepEqual(await collect(provider), [providerToolCall(call), providerDone()]);
  });

  it("receives abort signal", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const provider = createMockProvider([providerDone()], {
      onRequest(request) {
        seen = request.signal;
      },
    });

    await collect(provider, { signal: controller.signal });

    assert.equal(seen, controller.signal);
  });

  it("can emit errors", async () => {
    const provider = createMockProvider([{ type: "error", error: { message: "boom" } }]);

    assert.deepEqual(await collect(provider), [{ type: "error", error: { message: "boom" } }]);
  });
});
