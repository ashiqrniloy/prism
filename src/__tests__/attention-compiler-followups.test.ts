import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAttentionStickyFrontier, restoreAttentionStickyFrontier, serializeAttentionStickyFrontier } from "../attention-compiler.js";
import { createAttentionTruncationTrigger, resolveShouldCompact } from "../index.js";

const HEX = "a".repeat(32);
/** Documented frontier caps (plan 074 P3). Spelled out so a silent cap change fails here. */
const MAX_ATTENTION_THINKING_KEYS = 256;
const MAX_ATTENTION_TOOL_CALL_IDS = 256;

/** `parseAttentionStickyFrontier` returns undefined for a shape it cannot trust; tests assert. */
function parsed(value: unknown) {
  const frontier = parseAttentionStickyFrontier(value);
  assert.ok(frontier, `expected ${JSON.stringify(value)} to parse into a frontier`);
  return frontier;
}
const triggerContext = { sessionId: "s", entryCount: 1, estimateInputTokens: () => 0, resolveInputCapTokens: () => 1_000 };

describe("attention sticky frontier persistence (plan 074 P3)", () => {
  it("round-trips a live frontier without payload or model text", () => {
    const frontier = { thinking: new Set(["b".repeat(32)]), toolCallIds: new Set(["call-1", "call-2"]) };
    const persisted = serializeAttentionStickyFrontier(frontier);
    assert.deepEqual(persisted, { v: 1, thinking: ["b".repeat(32)], toolCallIds: ["call-1", "call-2"] });
    const restored = restoreAttentionStickyFrontier(parsed(persisted));
    assert.deepEqual([...restored.thinking], ["b".repeat(32)]);
    assert.deepEqual([...restored.toolCallIds], ["call-1", "call-2"]);
    assert.doesNotMatch(JSON.stringify(persisted), /omitted|sha256/, "frontier carries keys, never stub text");
  });

  it("keeps the newest window inside both caps", () => {
    const thinking = new Set(Array.from({ length: MAX_ATTENTION_THINKING_KEYS + 10 }, (_, index) => index.toString(16).padStart(32, "0")));
    const toolCallIds = new Set(Array.from({ length: MAX_ATTENTION_TOOL_CALL_IDS + 10 }, (_, index) => `call-${index}`));
    const persisted = serializeAttentionStickyFrontier({ thinking, toolCallIds });
    assert.equal(persisted.thinking.length, MAX_ATTENTION_THINKING_KEYS);
    assert.equal(persisted.toolCallIds.length, MAX_ATTENTION_TOOL_CALL_IDS);
    assert.equal(persisted.thinking.at(-1), (MAX_ATTENTION_THINKING_KEYS + 9).toString(16).padStart(32, "0"), "newest kept");
    assert.equal(persisted.toolCallIds.at(-1), `call-${MAX_ATTENTION_TOOL_CALL_IDS + 9}`);
    // A long checkpoint cannot grow past the live caps either.
    const reloaded = parsed({ thinking: [...persisted.thinking, HEX], toolCallIds: [] });
    assert.equal(reloaded.thinking.length, MAX_ATTENTION_THINKING_KEYS);
  });

  it("fails closed per entry and per shape, never throwing on a hand-edited checkpoint", () => {
    const parsed = parseAttentionStickyFrontier({
      thinking: ["not-a-hash", "A".repeat(32), "b".repeat(32), 7, null],
      toolCallIds: ["call-1", "", "x".repeat(257), "bad\u0000id", 12],
    });
    assert.deepEqual(parsed?.thinking, ["b".repeat(32)], "hex-only keys survive");
    assert.deepEqual(parsed?.toolCallIds, ["call-1"], "bounded non-empty ids survive");
    for (const malformed of [null, "nope", 42, [], {}, { thinking: [] }, { thinking: [], toolCallIds: "x" }]) {
      assert.equal(parseAttentionStickyFrontier(malformed), undefined, `shape ${JSON.stringify(malformed)} must not restore`);
    }
  });
});

describe("attention truncation follow-up (plan 074 P4)", () => {
  it("arms on consecutive truncated turns and fires once at the next boundary", async () => {
    const policy = createAttentionTruncationTrigger();
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false);
    assert.equal(policy.observe({ truncated: true }), 1);
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false, "one truncated turn is not enough");
    assert.equal(policy.observe({ truncated: true }), 2);
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), true, "two in a row compact once");
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false, "the fired streak is consumed");
    assert.equal(policy.streak(), 0);
  });

  it("relief clears the streak, and the threshold is configurable", async () => {
    const policy = createAttentionTruncationTrigger({ threshold: 3 });
    policy.observe({ truncated: true });
    policy.observe({ truncated: true });
    assert.equal(policy.observe({ truncated: false }), 0, "a turn that mutated everything relieved the pressure");
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false);
    policy.observe({ truncated: true });
    policy.observe({ truncated: true });
    policy.observe({ truncated: true });
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), true);
    policy.observe({ truncated: true });
    policy.reset();
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false, "reset clears an armed streak");
    assert.throws(() => createAttentionTruncationTrigger({ threshold: 0 }), /positive safe integer/);
    assert.throws(() => createAttentionTruncationTrigger({ threshold: 1.5 }), /positive safe integer/);
  });

  it("treats a missing or non-boolean truncated flag as relief", async () => {
    const policy = createAttentionTruncationTrigger({ threshold: 1 });
    assert.equal(policy.observe({}), 0);
    assert.equal(policy.observe({ truncated: "yes" }), 0);
    assert.equal(await resolveShouldCompact({ trigger: policy.trigger }, triggerContext), false);
  });
});
