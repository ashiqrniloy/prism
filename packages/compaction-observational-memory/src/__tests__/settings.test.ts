import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaticSettingsProvider } from "@arnilo/prism";
import {
  type ObservationalMemorySettingsInput,
  defaultObservationalMemorySettings,
  HARD_MAX_WORKER_TURNS,
  resolveObservationalMemorySettings,
} from "../index.js";

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

  it("observational_memory_settings_resolve_nested_thresholds_and_worker_models", async () => {
    const resolved = await resolveObservationalMemorySettings(undefined, {
      observation: { messageTokens: 11, model: workerModel },
      reflection: { observationTokens: 22, model: workerModel },
      context: {
        compactAfterTokens: 33,
        recentMessages: 3,
        observationsPoolMaxTokens: 44,
        observationsPoolTargetTokens: 55,
      },
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

  it("observational_memory_settings_reject_removed_flat_keys_in_overrides_and_settings_provider", async () => {
    const removed: readonly [key: string, replacement: string][] = [
      ["observeAfterTokens", "observation.messageTokens"],
      ["reflectAfterTokens", "reflection.observationTokens"],
      ["compactAfterTokens", "context.compactAfterTokens"],
      ["keepRecentEntries", "context.recentMessages"],
      ["recentMessageMaxTokens", "context.recentMessageMaxTokens"],
      ["observationsPoolMaxTokens", "context.observationsPoolMaxTokens"],
      ["observationsPoolTargetTokens", "context.observationsPoolTargetTokens"],
      ["workerModel", "observation.model"],
      ["thinkingLevel", "observation.thinkingLevel"],
      ["requireExplicitModel", "observation.requireExplicitModel"],
    ];
    for (const [key, replacement] of removed) {
      await assert.rejects(
        // untyped legacy input (settings-provider JSON or plain JS options)
        resolveObservationalMemorySettings(undefined, { [key]: 1 } as never),
        (err) =>
          err instanceof TypeError &&
          String(err.message).includes(`"${key}" was removed in 0.1.5`) &&
          String(err.message).includes(replacement),
      );
      const settings = createStaticSettingsProvider({ "observational-memory": { [key]: 1 } });
      await assert.rejects(
        resolveObservationalMemorySettings(settings),
        (err) =>
          err instanceof TypeError &&
          String(err.message).includes(`"${key}" was removed in 0.1.5`) &&
          String(err.message).includes(replacement),
      );
    }
  });

  it("compile_time_removed_flat_keys_are_type_errors", () => {
    // Every removed pre-0.0.19 flat key must be a compile-time error naming the nested replacement.
    // @ts-expect-error removed in 0.1.5; use observation.messageTokens
    const a: ObservationalMemorySettingsInput = { observeAfterTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use reflection.observationTokens
    const b: ObservationalMemorySettingsInput = { reflectAfterTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use context.compactAfterTokens
    const c: ObservationalMemorySettingsInput = { compactAfterTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use context.recentMessages
    const d: ObservationalMemorySettingsInput = { keepRecentEntries: 1 };
    // @ts-expect-error removed in 0.1.5; use context.recentMessageMaxTokens
    const e: ObservationalMemorySettingsInput = { recentMessageMaxTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use context.observationsPoolMaxTokens
    const f: ObservationalMemorySettingsInput = { observationsPoolMaxTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use context.observationsPoolTargetTokens
    const g: ObservationalMemorySettingsInput = { observationsPoolTargetTokens: 1 };
    // @ts-expect-error removed in 0.1.5; use observation.model / reflection.model / dropper.model
    const h: ObservationalMemorySettingsInput = { workerModel };
    // @ts-expect-error removed in 0.1.5; use observation.thinkingLevel / reflection.thinkingLevel / dropper.thinkingLevel
    const i: ObservationalMemorySettingsInput = { thinkingLevel: "low" };
    // @ts-expect-error removed in 0.1.5; use observation.requireExplicitModel / reflection.requireExplicitModel / dropper.requireExplicitModel
    const j: ObservationalMemorySettingsInput = { requireExplicitModel: true };
    assert.equal([a, b, c, d, e, f, g, h, i, j].length, 10);
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
