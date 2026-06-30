import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMockProvider, providerDone, providerTextDelta, providerToolCallDelta, providerUsage } from "../index.js";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct, assertUsageAccounting, collectProviderEvents } from "../testing/provider-conformance.js";

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

  it("conformance_rejects_malformed_tool_call_delta_arguments", () => {
    assert.throws(() => assertToolCallDeltasReconstruct([
      providerToolCallDelta({ index: 0, id: "call_1", name: "lookup", argumentsText: "not-json" }),
    ], []), /Invalid tool call arguments at index 0/);
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

  it("conformance_serialized_request_covers_text_thinking_tool_result_and_images", () => {
    assertSerializedRequestCoversContent(
      {
        model: { provider: "mock", model: "demo" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "thinking", text: "think-deep" },
              { type: "image", url: "https://example.invalid/img.png" },
              { type: "tool_result", toolCallId: "call_1", name: "lookup", result: { id: "42" } },
            ],
          },
          { role: "assistant", content: [{ type: "tool_call", id: "call_2", name: "sum", arguments: { a: 1, b: 2 } }] },
        ],
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "thinking", text: "think-deep" },
              { type: "image_url", image_url: { url: "https://example.invalid/img.png" } },
              { type: "tool_result", tool_call_id: "call_1", name: "lookup", content: JSON.stringify({ id: "42" }) },
            ],
          },
          { role: "assistant", tool_calls: [{ id: "call_2", type: "function", function: { name: "sum", arguments: JSON.stringify({ a: 1, b: 2 }) } }] },
        ],
      },
    );
  });

  it("conformance_serialized_request_fails_when_non_text_block_is_dropped", () => {
    assert.throws(
      () =>
        assertSerializedRequestCoversContent(
          {
            model: { provider: "mock", model: "demo" },
            messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", url: "https://example.invalid/img.png" }] }],
          },
          { messages: [{ role: "user", content: "hi" }] },
        ),
      /image.*dropped|missing canaries/i,
    );
  });

  it("conformance_serialized_request_allows_unsupported_blocks_to_be_absent", () => {
    assertSerializedRequestCoversContent(
      {
        model: { provider: "mock", model: "demo" },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", url: "https://example.invalid/img.png" }] }],
      },
      { messages: [{ role: "user", content: "hi" }] },
      { unsupported: ["image"] },
    );
  });

  it("conformance_no_secret_leak_fails_on_known_secret", () => {
    assert.throws(
      () => assertNoSecretLeak([providerTextDelta("error: sk-fake-123")], ["sk-fake-123"]),
      /Secret leaked/,
    );
  });
});
