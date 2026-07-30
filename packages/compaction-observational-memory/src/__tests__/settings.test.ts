import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaticSettingsProvider } from "@arnilo/prism";
import { defaultObservationalMemorySettings, HARD_MAX_WORKER_TURNS, resolveObservationalMemorySettings } from "../index.js";

const workerModel = { provider: "mock", model: "legacy" };

describe("observational memory settings", () => {
  it("observational_memory_settings_resolve_nested_defaults_and_overrides", async () => {
    const settings = createStaticSettingsProvider({
      "observational-memory": {
        observation: { messageTokens: 5 },
        context: { recentMessages: 4 },
        passive: true,
        agentMaxTurns: 2,
      },
    });
    const resolved = await resolveObservationalMemorySettings(settings, {
      passive: false,
      reflection: { observationTokens: 7 },
    });
    assert.equal(resolved.observation.messageTokens, 5);
    assert.equal(resolved.reflection.observationTokens, 7);
    assert.equal(resolved.context.recentMessages, 4);
    assert.equal(resolved.agentMaxTurns, 2);
    assert.equal(resolved.passive, false);
    assert.equal(resolved.context.compactAfterTokens, defaultObservationalMemorySettings.context.compactAfterTokens);
  });

  it("observational_memory_settings_map_legacy_flat_keys", async () => {
    const resolved = await resolveObservationalMemorySettings(undefined, {
      observeAfterTokens: 11,
      reflectAfterTokens: 22,
      compactAfterTokens: 33,
      keepRecentEntries: 3,
      observationsPoolMaxTokens: 44,
      observationsPoolTargetTokens: 55,
      workerModel,
    });
    assert.equal(resolved.observation.messageTokens, 11);
    assert.equal(resolved.reflection.observationTokens, 22);
    assert.equal(resolved.context.compactAfterTokens, 33);
    assert.equal(resolved.context.recentMessages, 3);
    assert.equal(resolved.context.observationsPoolMaxTokens, 44);
    assert.equal(resolved.context.observationsPoolTargetTokens, 55);
    assert.equal(resolved.dropper.targetTokens, 55);
    assert.deepEqual(resolved.observation.model, workerModel);
    assert.deepEqual(resolved.reflection.model, workerModel);
  });

  it("observational_memory_settings_reject_conflicting_flat_and_nested_keys", async () => {
    await assert.rejects(
      resolveObservationalMemorySettings(undefined, { observeAfterTokens: 1, observation: { messageTokens: 2 } }),
      /observeAfterTokens/,
    );
    await assert.rejects(
      resolveObservationalMemorySettings(undefined, { workerModel, observation: { model: { provider: "x", model: "y" } } }),
      /workerModel/,
    );
  });

  it("observational_memory_settings_reject_invalid_worker_turn_limits", async () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, HARD_MAX_WORKER_TURNS + 1]) {
      await assert.rejects(resolveObservationalMemorySettings(undefined, { agentMaxTurns: value }), /agentMaxTurns/);
    }
    assert.equal(
      (await resolveObservationalMemorySettings(undefined, { agentMaxTurns: HARD_MAX_WORKER_TURNS })).agentMaxTurns,
      HARD_MAX_WORKER_TURNS,
    );
  });
});
