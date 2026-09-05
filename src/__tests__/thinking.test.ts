import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelConfig } from "../contracts.js";
import {
  applyThinkingLevel,
  applyThinkingLevelForModel,
  isSupportedThinkingLevel,
  isThinkingLevel,
  mergeProviderRequestOptions,
  normalizeThinkingLevel,
  parseThinkingLevel,
  snapThinkingLevel,
  THINKING_LEVELS,
  thinkingCompatFor,
  thinkingFamilyForModel,
  thinkingLevelsForModel,
} from "../index.js";

type ModelLike = Pick<ModelConfig, "provider" | "compat" | "capabilities">;

const model = (partial: Partial<ModelLike>): ModelLike => ({ provider: "host", ...partial });

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
    assert.deepEqual(thinkingCompatFor("google", "low"), { thinkingLevel: "low" });
    assert.deepEqual(thinkingCompatFor("output_config_effort", "high"), { output_config: { effort: "high" } });
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
    assert.equal(thinkingFamilyForModel({ provider: "host", compat: { reasoning: { effort: "low" } } }), "openai_reasoning");
    assert.equal(thinkingFamilyForModel({ provider: "host", compat: { thinking: { type: "enabled" } } }), "thinking_type");
    assert.equal(thinkingFamilyForModel({ provider: "host", compat: { thinkingConfig: { includeThoughts: true } } }), "google");
    assert.equal(thinkingFamilyForModel({ provider: "host", compat: { thinkingConfig: true } }), "google");
    assert.equal(thinkingFamilyForModel({ provider: "host", capabilities: { reasoning: true } }), "reasoning_effort");
    assert.equal(thinkingFamilyForModel({ provider: "mock" }), "noop");
    // stamp-first: beats every heuristic
    assert.equal(
      thinkingFamilyForModel({ provider: "openai", compat: { thinkingFamily: "output_config_effort" } }),
      "output_config_effort",
    );
    assert.equal(thinkingFamilyForModel({ provider: "mock", compat: { thinkingFamily: "not-a-family" } }), "noop");
  });

  it("parse_thinking_level_trichotomy_known_opaque_invalid", () => {
    assert.equal(parseThinkingLevel("Max"), "max");
    assert.equal(parseThinkingLevel(" High "), "high");
    assert.deepEqual(parseThinkingLevel("turbo"), { opaque: "turbo" });
    assert.deepEqual(parseThinkingLevel("MEDIUM-OPTION"), { opaque: "medium-option" });
    assert.equal(parseThinkingLevel(""), undefined);
    assert.equal(parseThinkingLevel("   "), undefined);
    assert.equal(parseThinkingLevel(undefined), undefined);
    assert.equal(parseThinkingLevel(null), undefined);
    assert.equal(parseThinkingLevel(42), undefined);
  });

  it("is_supported_thinking_level_checks_declared_set_and_passes_undeclared", () => {
    const kimiK3 = model({ capabilities: { reasoning: true, thinkingLevels: ["low", "high", "max"] } });
    assert.equal(isSupportedThinkingLevel(kimiK3, "high"), true);
    assert.equal(isSupportedThinkingLevel(kimiK3, "medium"), false);
    assert.equal(isSupportedThinkingLevel(kimiK3, "xhigh"), false);
    assert.equal(isSupportedThinkingLevel(kimiK3, "turbo"), false);
    const undeclared = model({ capabilities: { reasoning: true } });
    assert.equal(isSupportedThinkingLevel(undeclared, "xhigh"), true);
    assert.equal(thinkingLevelsForModel(kimiK3), kimiK3.capabilities?.thinkingLevels);
    assert.equal(thinkingLevelsForModel(undeclared), undefined);
  });

  it("snap_thinking_level_nearest_with_tie_up_and_below_min_to_min", () => {
    const narrow = model({ capabilities: { reasoning: true, thinkingLevels: ["low", "medium", "high"] } });
    assert.equal(snapThinkingLevel(narrow, "high"), "high");
    assert.equal(snapThinkingLevel(narrow, "none"), "low"); // below min → min
    assert.equal(snapThinkingLevel(narrow, "minimal"), "low");
    assert.equal(snapThinkingLevel(narrow, "xhigh"), "high"); // above max → max declared
    const kimiK3 = model({ capabilities: { thinkingLevels: ["low", "high", "max"] } });
    assert.equal(snapThinkingLevel(kimiK3, "medium"), "high"); // tie low/high → up
    assert.equal(snapThinkingLevel(kimiK3, "xhigh"), "max"); // tie high/max → up
    const passthrough = model({ capabilities: { reasoning: true } });
    assert.equal(snapThinkingLevel(passthrough, "xhigh"), "xhigh");
    assert.equal(snapThinkingLevel(passthrough, "turbo"), "turbo");
    assert.equal(snapThinkingLevel(kimiK3, "turbo"), "turbo"); // opaque on declared set → passthrough
  });

  it("apply_thinking_level_for_model_hits_google_wire_path_defect_1_regression", () => {
    const gemini = model({
      provider: "google",
      compat: { thinkingFamily: "google" },
      capabilities: { reasoning: true, thinkingLevels: ["minimal", "low", "medium", "high"] },
    });
    const result = applyThinkingLevelForModel(undefined, "medium", gemini);
    assert.deepEqual(result.compat?.thinkingLevel, "medium");
    // snap out-of-set level
    const snapped = applyThinkingLevelForModel(undefined, "xhigh", gemini);
    assert.deepEqual(snapped.compat?.thinkingLevel, "high");
  });

  it("apply_thinking_level_for_model_snaps_and_stamps_win", () => {
    const kimiK3 = model({
      provider: "kimi",
      compat: { thinkingFamily: "reasoning_effort" },
      capabilities: { reasoning: true, thinkingLevels: ["low", "high", "max"] },
    });
    assert.deepEqual(applyThinkingLevelForModel(undefined, "medium", kimiK3).compat?.reasoning_effort, "high");

    // stamp beats the openai provider heuristic
    const stamped = model({
      provider: "openai",
      compat: { thinkingFamily: "output_config_effort" },
      capabilities: { reasoning: true, thinkingLevels: ["low", "medium", "high"] },
    });
    const anthropic = applyThinkingLevelForModel(undefined, "medium", stamped);
    assert.deepEqual(anthropic.compat?.output_config, { effort: "medium" });
  });

  it("apply_thinking_level_for_model_undeclared_passthrough_and_non_reasoning_noop", () => {
    const reasoning = model({ provider: "host", capabilities: { reasoning: true } });
    assert.deepEqual(applyThinkingLevelForModel(undefined, "xhigh", reasoning).compat?.reasoning_effort, "xhigh");

    const plain = model({ provider: "mock" });
    const base = { cacheRetention: "short" as const, compat: { keep: true } };
    assert.deepEqual(applyThinkingLevelForModel(base, "high", plain), base);
    assert.deepEqual(applyThinkingLevelForModel(undefined, "high", plain), {});
    assert.deepEqual(applyThinkingLevelForModel(undefined, "", plain), {});
  });

  it("apply_thinking_level_for_model_keeps_existing_compat_per_turn_wins", () => {
    const gemini = model({
      provider: "google",
      compat: { thinkingFamily: "google" },
      capabilities: { reasoning: true, thinkingLevels: ["minimal", "low", "medium", "high"] },
    });
    const base = { compat: { thinkingConfig: { includeThoughts: true }, keep: true } };
    const result = applyThinkingLevelForModel(base, "low", gemini);
    assert.deepEqual(result.compat?.thinkingConfig, { includeThoughts: true });
    assert.deepEqual(result.compat?.thinkingLevel, "low");
    assert.equal(result.compat?.keep, true);
  });
});
