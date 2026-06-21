import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaticSettingsProvider } from "prism";
import { defaultObservationalMemorySettings, resolveObservationalMemorySettings } from "../index.js";

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
});
