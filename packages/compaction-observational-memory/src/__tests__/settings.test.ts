import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaticSettingsProvider } from "@arnilo/prism";
import { defaultObservationalMemorySettings, HARD_MAX_WORKER_TURNS, resolveObservationalMemorySettings } from "../index.js";

describe("observational memory settings", () => {
  it("observational_memory_settings_resolve_defaults_and_overrides", async () => {
    const settings = createStaticSettingsProvider({ "observational-memory": { observeAfterTokens: 5, passive: true, agentMaxTurns: 2 } });
    const resolved = await resolveObservationalMemorySettings(settings, { passive: false, reflectAfterTokens: 7 });
    assert.equal(resolved.observeAfterTokens, 5);
    assert.equal(resolved.reflectAfterTokens, 7);
    assert.equal(resolved.agentMaxTurns, 2);
    assert.equal(resolved.passive, false);
    assert.equal(resolved.compactAfterTokens, defaultObservationalMemorySettings.compactAfterTokens);
  });

  it("observational_memory_settings_reject_invalid_worker_turn_limits", async () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, HARD_MAX_WORKER_TURNS + 1]) {
      await assert.rejects(resolveObservationalMemorySettings(undefined, { agentMaxTurns: value }), /agentMaxTurns/);
    }
    assert.equal((await resolveObservationalMemorySettings(undefined, { agentMaxTurns: HARD_MAX_WORKER_TURNS })).agentMaxTurns, HARD_MAX_WORKER_TURNS);
  });
});
