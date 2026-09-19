/** Plan 086 Task 2: the four trigger axes, run-input-budget resolution, fired-axis attribution.
 *  The headline case is the synapta Plan 118 scenario — a run input cap sitting far below the
 *  model window, where the legacy `input_ratio` gate never opens before the run dies. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attentionTriggerState,
  compileAttention,
  createAttentionCompiler,
  evaluateAttentionTrigger,
  isAttentionBudgetError,
  resolveRunAttentionCompiler,
} from "../attention-compiler.js";
import type { ContextBudgetMessageGroups } from "../context-budget.js";
import type { AttentionTriggerState, Message, ModelConfig } from "../index.js";

const model: ModelConfig = { provider: "test", model: "test-model" };
/** 1M window on purpose: `input_ratio` at 0.75 gates at ~745k input tokens. */
const wide: ModelConfig = { provider: "test", model: "wide", limits: { contextWindow: 1_000_000, maxOutputTokens: 8_192 } };

const body = (chars: number) => "x".repeat(chars);

function textMessage(role: Message["role"], text: string): Message {
  return { role, content: [{ type: "text", text }] };
}

function toolMessage(toolCallId: string, name: string, result: unknown): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId, name, result }] };
}

function groups(history: Message[]): ContextBudgetMessageGroups {
  return {
    instructions: [textMessage("system", "Policy")],
    summaries: [],
    history,
    input: [textMessage("user", "go")],
    attachments: [],
    toolResults: [],
  };
}

const history = (): Message[] => [
  toolMessage("call_1", "grep", { value: body(4_000) }),
  textMessage("assistant", "notes"),
  toolMessage("call_2", "grep", { value: body(4_000) }),
];

/** This request's measured estimate, taken from an unfired gate so no row is folded. */
async function estimateOf(target: ContextBudgetMessageGroups): Promise<number> {
  const probe = createAttentionCompiler({ maxInputTokens: 1_000_000 }, { model });
  const { report } = await compileAttention({ compiler: probe, groups: target, turn: 1 });
  return report.used;
}

function state(overrides: Partial<AttentionTriggerState> = {}): AttentionTriggerState {
  return { estimatedInputTokens: 500, inputCapTokens: 1_000, runInputTokens: 0, turn: 1, ...overrides };
}

/** A compiler whose cap is exactly this request's estimate, so the ratio axis trips immediately
 *  and settles after one stub — a fold point independent of the token estimator's calibration. */
async function calibratedLegacy(ratio: number, keepLast = 0) {
  const target = groups(history());
  const estimate = await estimateOf(target);
  const options = { maxInputTokens: estimate / ratio, keepLast };
  return { target, options, estimate };
}

describe("attention trigger axes (plan 086 T2)", () => {
  it("run_input_ratio folds on run-budget spend that input_ratio never sees (synapta scenario)", async () => {
    const target = groups(history());
    const options = { keepLast: 1 };

    // 380k spent of a 500k budget is past the 375k fold point, while this request is far below
    // the 745k the ratio axis waits for. Folding is the mitigation, not a failure: the spend is
    // booked, so the axis must not fail closed the way a per-request axis does.
    const runAxis = createAttentionCompiler(
      { ...options, trigger: { kind: "run_input_ratio", ratio: 0.75 } },
      {
        model: wide,
        runInputBudget: 500_000,
      },
    );
    const folded = await compileAttention({ compiler: runAxis, groups: target, turn: 12, runInputTokens: 380_000 });
    assert.equal(folded.report.firedAxis, "run_input_ratio");
    assert.ok(folded.report.stubbedToolResults >= 1, "the aged tool result is folded");
    assert.equal(folded.report.truncated, false, "a target-less axis folds every eligible row");

    const windowAxis = createAttentionCompiler({ ...options, trigger: { kind: "input_ratio", ratio: 0.75 } }, { model: wide });
    const inert = await compileAttention({ compiler: windowAxis, groups: target, turn: 12, runInputTokens: 380_000 });
    assert.equal(inert.mutated, false, "the same request is nowhere near the window ratio");
    assert.equal(inert.report.firedAxis, undefined);
  });

  it("run_input_ratio fires when spend plus this turn's estimate reaches the ratio, not before", async () => {
    const target = groups(history());
    const compiler = createAttentionCompiler(
      { trigger: { kind: "run_input_ratio", ratio: 0.5 } },
      { model: wide, runInputBudget: 100_000 },
    );
    const estimate = await estimateOf(target);
    const threshold = 50_000;

    const below = await compileAttention({ compiler, groups: target, turn: 2, runInputTokens: threshold - estimate - 1 });
    assert.equal(below.report.firedAxis, undefined, "one token short of the fold point stays inert");
    const at = await compileAttention({ compiler, groups: target, turn: 2, runInputTokens: threshold - estimate });
    assert.equal(at.report.firedAxis, "run_input_ratio", "the projection is spend + this turn's estimate");
  });

  it("falls back to the input cap when the run limits declare no budget, and folds all rows when they do", () => {
    const inputCap = createAttentionCompiler({ maxInputTokens: 1_000, trigger: { kind: "run_input_ratio", ratio: 0.5 } }, { model });
    const decision = evaluateAttentionTrigger(inputCap.trigger, attentionTriggerState(inputCap, { estimatedInputTokens: 600, turn: 1 }));
    assert.deepEqual(
      { shouldFold: decision.shouldFold, firedAxis: decision.firedAxis, targetTokens: decision.targetTokens },
      { shouldFold: true, firedAxis: "run_input_ratio", targetTokens: 500 },
      "no run budget: the axis is the per-request ratio comparison",
    );
    assert.equal(decision.failsClosed, true);

    const budgeted = createAttentionCompiler(
      { maxInputTokens: 1_000, trigger: { kind: "run_input_ratio", ratio: 0.5 } },
      { model, runInputBudget: 100_000 },
    );
    const belowBudget = evaluateAttentionTrigger(budgeted.trigger, attentionTriggerState(budgeted, { estimatedInputTokens: 600, turn: 1 }));
    assert.equal(belowBudget.shouldFold, false, "a real budget replaces the input cap, not adds to it");

    const overBudget = evaluateAttentionTrigger(
      budgeted.trigger,
      attentionTriggerState(budgeted, { estimatedInputTokens: 600, runInputTokens: 49_500, turn: 1 }),
    );
    assert.equal(overBudget.shouldFold, true);
    assert.equal(overBudget.targetTokens, undefined, "cumulative axes have no per-request target");
    assert.equal(overBudget.failsClosed, false, "folding cannot un-book spend, so it never fails closed");
  });

  it("evaluates an array as any-of, attributing the first axis that fires", async () => {
    const axes = createAttentionCompiler(
      {
        maxInputTokens: 1_000,
        trigger: [
          { kind: "input_ratio", ratio: 0.4 },
          { kind: "token_floor", tokens: 100 },
        ],
      },
      { model },
    ).trigger;
    const bothFire = evaluateAttentionTrigger(axes, state());
    assert.deepEqual(
      { firedAxis: bothFire.firedAxis, targetTokens: bothFire.targetTokens },
      { firedAxis: "input_ratio", targetTokens: 400 },
      "configured order decides attribution and the fold target",
    );

    const floorFirst = createAttentionCompiler(
      {
        maxInputTokens: 1_000,
        trigger: [
          { kind: "token_floor", tokens: 100 },
          { kind: "input_ratio", ratio: 0.4 },
        ],
      },
      { model },
    ).trigger;
    assert.equal(evaluateAttentionTrigger(floorFirst, state()).firedAxis, "token_floor");

    // A floor smaller than the request stops the stages as soon as it is reached, instead of
    // stripping every eligible row: the calibrated floor sits one token under the estimate.
    const target = groups(history());
    const estimate = await estimateOf(target);
    const floored = createAttentionCompiler(
      { maxInputTokens: 1_000_000, keepLast: 0, trigger: { kind: "token_floor", tokens: estimate - 1 } },
      { model },
    );
    const { report } = await compileAttention({ compiler: floored, groups: target, turn: 5 });
    assert.equal(report.firedAxis, "token_floor");
    assert.equal(report.stubbedToolResults, 1, "one stub is enough to get under the floor");
    assert.equal(report.truncated, true, "rows left eligible are reported");
  });

  it("hands a frozen state to predicate axes and evaluates them at most twice per turn", async () => {
    const target = groups(history());
    const estimate = await estimateOf(target);
    const seen: AttentionTriggerState[] = [];
    let calls = 0;
    const compiler = createAttentionCompiler(
      {
        maxInputTokens: 1_000_000,
        keepLast: 0,
        trigger: (current: AttentionTriggerState) => {
          calls += 1;
          seen.push(current);
          return current.estimatedInputTokens > estimate - 1;
        },
      },
      { model },
    );
    const { report } = await compileAttention({ compiler, groups: target, turn: 7 });
    assert.equal(report.firedAxis, "predicate");
    assert.ok(report.stubbedToolResults >= 1);
    assert.equal(calls, 2, "one call decides the turn, one confirms the stages settled it");
    assert.ok(
      seen.every((current) => Object.isFrozen(current)),
      "the host function cannot mutate the state",
    );
    assert.deepEqual(seen[0], { estimatedInputTokens: estimate, inputCapTokens: 1_000_000, runInputTokens: 0, turn: 7 });

    // A predicate that still fires after every eligible row is the host's own "compact now":
    // unlike a cumulative run-budget axis, it fails closed.
    const stubborn = createAttentionCompiler({ maxInputTokens: 1_000_000, keepLast: 0, trigger: () => true }, { model });
    await assert.rejects(
      compileAttention({ compiler: stubborn, groups: groups(history()), turn: 7 }),
      (error: unknown) => isAttentionBudgetError(error) && /predicate gate/.test((error as Error).message),
    );

    // Fail loudly instead of quietly treating an async predicate's Promise as "not fired".
    const async_ = createAttentionCompiler({ maxInputTokens: 1_000_000, trigger: (() => Promise.resolve(true)) as never }, { model });
    await assert.rejects(
      compileAttention({ compiler: async_, groups: groups(history()), turn: 1 }),
      /attentionCompiler\.trigger predicate must return a boolean/,
    );
  });

  it("keeps the legacy triggerRatio behavior byte-identical when no trigger is configured", async () => {
    const { target, options } = await calibratedLegacy(0.5);
    const legacy = createAttentionCompiler({ ...options, triggerRatio: 0.5 }, { model });
    const explicit = createAttentionCompiler({ ...options, trigger: { kind: "input_ratio", ratio: 0.5 } }, { model });
    assert.deepEqual(legacy.trigger, explicit.trigger);
    assert.deepEqual(legacy.trigger, [{ kind: "input_ratio", ratio: 0.5 }]);

    const first = await compileAttention({ compiler: legacy, groups: target, turn: 9 });
    const second = await compileAttention({ compiler: explicit, groups: target, turn: 9 });
    assert.deepEqual(first.report, second.report);
    assert.equal(first.report.firedAxis, "input_ratio");
    assert.ok(first.mutated);
  });

  it("fails closed at config time with the option name, and refuses a trigger run overlay", () => {
    const cap = { maxInputTokens: 1_000 };
    assert.throws(
      () => createAttentionCompiler({ ...cap, trigger: { kind: "nope" } as never }, { model }),
      /unknown attentionCompiler\.trigger kind: nope/,
    );
    assert.throws(
      () => createAttentionCompiler({ ...cap, trigger: [{ kind: "token_floor", tokens: 1 }, { kind: "bogus" } as never] }, { model }),
      /unknown attentionCompiler\.trigger\[1\] kind/,
    );
    assert.throws(
      () => createAttentionCompiler({ ...cap, trigger: { kind: "input_ratio", ratio: 1 } }, { model }),
      /attentionCompiler\.trigger\.ratio must be a number in \(0, 1\)/,
    );
    assert.throws(
      () => createAttentionCompiler({ ...cap, trigger: { kind: "token_floor", tokens: 0 } }, { model }),
      /attentionCompiler\.trigger\.tokens must be a positive safe integer/,
    );
    assert.throws(() => createAttentionCompiler({ ...cap, trigger: [] }, { model }), /non-empty array/);
    assert.throws(
      () => createAttentionCompiler(cap, { model, runInputBudget: 0 }),
      /attentionCompiler\.runInputBudget must be a positive safe integer/,
    );
    assert.throws(
      () => resolveRunAttentionCompiler({ maxInputTokens: 400 }, { trigger: { kind: "token_floor", tokens: 1 } }, model),
      /must not set maxInputTokens, reserveTokens, trigger, or durable/,
    );
    assert.throws(
      () => createAttentionCompiler({ ...cap, durable: "yes" as never }, { model }),
      /attentionCompiler\.durable must be a boolean/,
    );
  });
});
