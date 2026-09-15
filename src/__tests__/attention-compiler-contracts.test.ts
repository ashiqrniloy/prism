import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENTION_BUDGET_ERROR_CODE,
  AttentionBudgetError,
  assertCompactionTrigger,
  createAttentionCompiler,
  DEFAULT_ATTENTION_COMPACT_RATIO,
  DEFAULT_ATTENTION_KEEP_LAST,
  DEFAULT_ATTENTION_RESERVE_TOKENS,
  DEFAULT_ATTENTION_THINKING_KEEP_TURNS,
  DEFAULT_ATTENTION_TRIGGER_RATIO,
  isAttentionBudgetError,
  resolveInputCap,
} from "../index.js";

const model = { limits: { contextWindow: 200_000, maxOutputTokens: 8_192 } };

describe("attention compiler contracts (plan 074 Task 2)", () => {
  it("resolves the input cap from the model window minus output and reserve", () => {
    assert.equal(createAttentionCompiler({}, { model }).inputCap, 200_000 - 8_192 - DEFAULT_ATTENTION_RESERVE_TOKENS);
    assert.equal(createAttentionCompiler({ reserveTokens: 0 }, { model }).inputCap, 191_808);
    assert.equal(createAttentionCompiler({ reserveTokens: 512 }, { model }).inputCap, 200_000 - 8_192 - 512);
  });

  it("lets a host maxInputTokens win over the model window", () => {
    const compiler = createAttentionCompiler({ maxInputTokens: 4_000 }, { model });
    assert.equal(compiler.inputCap, 4_000);
    // Host cap also works with no model at all.
    assert.equal(createAttentionCompiler({ maxInputTokens: 4_000 }).inputCap, 4_000);
  });

  it("throws at create when no cap can be resolved", () => {
    assert.throws(() => createAttentionCompiler({}), /requires maxInputTokens or model\.limits\.contextWindow/);
    assert.throws(() => createAttentionCompiler({}, { model: { limits: {} } }), /contextWindow/);
    assert.throws(
      () => createAttentionCompiler({}, { model: { limits: { contextWindow: 1_000, maxOutputTokens: 900 } } }),
      /non-positive input cap/,
    );
  });

  it("rejects malformed caps and reserves", () => {
    assert.throws(() => createAttentionCompiler({ maxInputTokens: 0 }), /maxInputTokens/);
    assert.throws(() => createAttentionCompiler({ maxInputTokens: 1.5 }), /maxInputTokens/);
    assert.throws(() => createAttentionCompiler({ reserveTokens: -1 }), /reserveTokens/);
    assert.throws(() => resolveInputCap({}, { limits: { contextWindow: 1_000, maxOutputTokens: Number.NaN } }), /maxOutputTokens/);
    assert.throws(() => resolveInputCap({}, { limits: { contextWindow: Number.NaN } }), /contextWindow/);
  });

  it("validates triggerRatio in the open interval (0, 1)", () => {
    for (const bad of [0, 1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5" as unknown as number]) {
      assert.throws(() => createAttentionCompiler({ triggerRatio: bad, maxInputTokens: 1_000 }), /triggerRatio/);
    }
    assert.equal(createAttentionCompiler({ triggerRatio: 0.5, maxInputTokens: 1_000 }).triggerRatio, 0.5);
  });

  it("fails closed when compactRatio does not exceed triggerRatio", () => {
    assert.throws(() => createAttentionCompiler({ triggerRatio: 0.8, compactRatio: 0.8, maxInputTokens: 1_000 }), /compactRatio/);
    assert.throws(() => createAttentionCompiler({ triggerRatio: 0.8, compactRatio: 0.5, maxInputTokens: 1_000 }), /compactRatio/);
    assert.equal(createAttentionCompiler({ triggerRatio: 0.8, compactRatio: 0.95, maxInputTokens: 1_000 }).compactRatio, 0.95);
  });

  it("applies documented defaults", () => {
    const compiler = createAttentionCompiler({}, { model });
    assert.equal(compiler.triggerRatio, DEFAULT_ATTENTION_TRIGGER_RATIO);
    assert.equal(compiler.triggerRatio, 0.75);
    assert.equal(compiler.compactRatio, DEFAULT_ATTENTION_COMPACT_RATIO);
    assert.equal(compiler.thinkingKeepTurns, DEFAULT_ATTENTION_THINKING_KEEP_TURNS);
    assert.equal(compiler.thinkingKeepTurns, 1);
    assert.equal(compiler.keepLast, DEFAULT_ATTENTION_KEEP_LAST);
    assert.equal(compiler.keepLast, 3);
    assert.equal(compiler.reserveTokens, DEFAULT_ATTENTION_RESERVE_TOKENS);
    assert.deepEqual(compiler.excludeTools, []);
  });

  it("validates keep counts", () => {
    assert.equal(createAttentionCompiler({ keepLast: 0, thinkingKeepTurns: 0 }, { model }).keepLast, 0);
    assert.throws(() => createAttentionCompiler({ keepLast: -1 }, { model }), /keepLast/);
    assert.throws(() => createAttentionCompiler({ thinkingKeepTurns: 1.5 }, { model }), /thinkingKeepTurns/);
  });

  it("normalizes excludeTools and freezes the handle", () => {
    const compiler = createAttentionCompiler({ excludeTools: ["submit_payment", "submit_payment", "wire_funds"] }, { model });
    assert.deepEqual(compiler.excludeTools, ["submit_payment", "wire_funds"]);
    assert.ok(Object.isFrozen(compiler));
    assert.ok(Object.isFrozen(compiler.excludeTools));
    assert.throws(() => {
      (compiler as { keepLast: number }).keepLast = 9;
    }, TypeError);
    assert.throws(() => createAttentionCompiler({ excludeTools: [""] }, { model }), /excludeTools/);
    assert.throws(() => createAttentionCompiler({ excludeTools: "submit_payment" as unknown as string[] }, { model }), /excludeTools/);
  });

  it("rejects an unknown compaction trigger type at create", () => {
    const trigger = { type: "every_full_moon" } as never;
    assert.throws(() => assertCompactionTrigger(trigger), /unknown compaction trigger type/);
    assert.throws(() => createAttentionCompiler({}, { model, compactionTrigger: trigger }), /unknown compaction trigger type/);
  });

  it("validates the known compaction trigger shapes", () => {
    assert.equal(assertCompactionTrigger({ type: "threshold_entries", entries: 10 }).type, "threshold_entries");
    assert.equal(assertCompactionTrigger({ type: "input_ratio", ratio: 0.9 }).type, "input_ratio");
    assert.equal(typeof assertCompactionTrigger({ type: "custom", shouldCompact: () => true }).type, "string");
    assert.throws(() => assertCompactionTrigger({ type: "threshold_entries", entries: 0 }), /threshold_entries/);
    assert.throws(() => assertCompactionTrigger({ type: "input_ratio", ratio: 1 }), /input_ratio/);
    assert.throws(() => assertCompactionTrigger({ type: "custom" } as never), /shouldCompact/);
  });

  it("fails closed when an input_ratio trigger would compact before the compiler stubs", () => {
    assert.throws(
      () => createAttentionCompiler({ triggerRatio: 0.75 }, { model, compactionTrigger: { type: "input_ratio", ratio: 0.6 } }),
      /must exceed attentionCompiler\.triggerRatio/,
    );
    const ok = createAttentionCompiler({ triggerRatio: 0.75 }, { model, compactionTrigger: { type: "input_ratio", ratio: 0.9 } });
    assert.equal(ok.triggerRatio, 0.75);
  });

  it("exposes a fail-closed budget error in the ContextBudgetError family", () => {
    const error = new AttentionBudgetError();
    assert.ok(error instanceof Error);
    assert.equal(error.code, ATTENTION_BUDGET_ERROR_CODE);
    assert.equal(error.name, "AttentionBudgetError");
    assert.ok(isAttentionBudgetError(error));
    assert.ok(!isAttentionBudgetError(new Error("attention budget exceeded")));
    assert.throws(() => {
      throw new AttentionBudgetError("attention budget exceeded: used 12000 of 15000");
    }, /used 12000 of 15000/);
  });

  it("resolves caps synchronously with no I/O surface", () => {
    const compiler = createAttentionCompiler({ triggerRatio: 0.8, excludeTools: ["x"] }, { model });
    assert.equal(compiler.inputCap, 200_000 - 8_192 - DEFAULT_ATTENTION_RESERVE_TOKENS);
    assert.ok(typeof (compiler as { then?: unknown }).then !== "function", "create must be synchronous");
    // Pure: the same inputs resolve the same cap, and the shared helper agrees.
    assert.equal(resolveInputCap({ reserveTokens: 1024 }, model), compiler.inputCap);
    assert.equal(resolveInputCap({ maxInputTokens: 100 }), 100);
  });
});
