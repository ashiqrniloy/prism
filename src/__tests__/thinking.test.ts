import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  THINKING_LEVELS,
  applyThinkingLevel,
  isThinkingLevel,
  mergeProviderRequestOptions,
  normalizeThinkingLevel,
  thinkingCompatFor,
  thinkingFamilyForModel,
} from "../index.js";

describe("thinking helpers", () => {
  it("thinking_levels_and_normalize_cover_shared_effort_values", () => {
    assert.deepEqual([...THINKING_LEVELS], ["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    assert.equal(isThinkingLevel("low"), true);
    assert.equal(isThinkingLevel("LOUD"), false);
    assert.equal(normalizeThinkingLevel(" High "), "high");
    assert.equal(normalizeThinkingLevel("custom-budget"), "custom-budget");
    assert.equal(normalizeThinkingLevel("   "), undefined);
  });

  it("thinking_compat_for_maps_shared_families_to_official_compat_fields", () => {
    assert.deepEqual(thinkingCompatFor("openai_reasoning", "low"), { reasoning: { effort: "low" } });
    assert.deepEqual(thinkingCompatFor("reasoning_effort", "high"), { reasoning_effort: "high" });
    assert.deepEqual(thinkingCompatFor("thinking_type", "medium"), { thinking: { type: "enabled" } });
    assert.deepEqual(thinkingCompatFor("thinking_type", "none"), { thinking: { type: "disabled" } });
    assert.deepEqual(thinkingCompatFor("noop", "high"), {});
  });

  it("apply_thinking_level_merges_compat_and_preserves_openai_reasoning_summary", () => {
    const base = {
      cacheRetention: "short" as const,
      compat: { reasoning: { summary: "auto" }, keep: true },
    };
    const openai = applyThinkingLevel(base, "minimal", "openai_reasoning");
    assert.equal(openai.cacheRetention, "short");
    assert.deepEqual(openai.compat?.reasoning, { summary: "auto", effort: "minimal" });
    assert.equal(openai.compat?.keep, true);

    const effort = applyThinkingLevel({ compat: { reasoning_effort: "medium", tool_stream: true } }, "high", "reasoning_effort");
    assert.equal(effort.compat?.reasoning_effort, "high");
    assert.equal(effort.compat?.tool_stream, true);

    const noop = applyThinkingLevel({ compat: { keep: true } }, "low", "noop");
    assert.deepEqual(noop.compat, { keep: true });
  });

  it("model_compat_medium_plus_run_compat_high_prefers_per_turn_override", () => {
    const modelCompat = { reasoning_effort: "medium", thinking: { type: "enabled" } };
    const perTurn = applyThinkingLevel({ compat: modelCompat }, "high", "reasoning_effort");
    const merged = mergeProviderRequestOptions({ compat: modelCompat }, { compat: perTurn.compat });
    assert.equal(merged?.compat?.reasoning_effort, "high");
    assert.deepEqual(merged?.compat?.thinking, { type: "enabled" });
  });

  it("thinking_family_for_model_uses_compat_and_safe_provider_heuristics", () => {
    assert.equal(thinkingFamilyForModel({ provider: "openai" }), "openai_reasoning");
    assert.equal(thinkingFamilyForModel({ provider: "openai-responses-demo" }), "openai_reasoning");
    assert.equal(thinkingFamilyForModel({ provider: "neuralwatt" }), "reasoning_effort");
    assert.equal(
      thinkingFamilyForModel({ provider: "host", compat: { reasoning: { effort: "low" } } }),
      "openai_reasoning",
    );
    assert.equal(
      thinkingFamilyForModel({ provider: "host", compat: { thinking: { type: "enabled" } } }),
      "thinking_type",
    );
    assert.equal(
      thinkingFamilyForModel({ provider: "host", capabilities: { reasoning: true } }),
      "reasoning_effort",
    );
    assert.equal(thinkingFamilyForModel({ provider: "mock" }), "noop");
  });
});
