import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMockProvider, providerDone, providerTextDelta, providerToolCallDelta, providerUsage } from "../index.js";
import { assertAbortIsObserved, assertProviderStreamConforms, assertToolCallDeltasReconstruct, assertUsageAccounting, collectProviderEvents } from "../testing/provider-conformance.js";

const request = { model: { provider: "mock", model: "demo" }, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as const;

void describe("provider conformance", () => {
  it("conformance_collects_events_in_order", async () => {
    const events = [providerTextDelta("Hi"), providerDone()];
    assert.deepEqual(await collectProviderEvents(createMockProvider(events), request), events);
  });

  it("conformance_fails_missing_done_or_error", async () => {
    await assert.rejects(assertProviderStreamConforms({ provider: createMockProvider([providerTextDelta("Hi")]), request }), /must end/);
  });

  it("conformance_checks_abort_signal", async () => {
    await assertAbortIsObserved({ provider: createMockProvider([providerDone()]), request });
  });

  it("conformance_reconstructs_tool_call_deltas", () => {
    const calls = assertToolCallDeltasReconstruct([
      providerToolCallDelta({ index: 0, id: "call_1", name: "lookup", argumentsText: "{\"a\":" }),
      providerToolCallDelta({ index: 0, argumentsText: "1}" }),
      providerDone(),
    ], [{ index: 0, id: "call_1", name: "lookup", arguments: { a: 1 } }]);

    assert.deepEqual(calls[0]?.arguments, { a: 1 });
  });

  it("conformance_checks_cache_usage_fields", async () => {
    const events = await assertProviderStreamConforms({
      provider: createMockProvider([providerTextDelta("Hi"), providerUsage({ inputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 }), providerDone()]),
      request,
      expect: { text: "Hi", usage: { cacheReadTokens: 2, cacheWriteTokens: 1 } },
    });

    assert.equal(assertUsageAccounting(events, { inputTokens: 3 }).inputTokens, 3);
  });

  it("testing_subpath_is_exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/provider-conformance"]);
  });
});
