/**
 * Plan 240 Task 4 (owner, 2026-11-22): 0.14.0 ships session memory installed off (the host turns it on), STM as the
 * compaction when on, and working memory off unless configured, on the deterministic policy.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { resolveMemorySystemComponents, resolveMemorySystemConfig } from "../../index.js";

describe("memory-system release defaults (plan 240 Task 4)", () => {
  it("memory_system_installs_off_and_enabled_compacts_with_stm_without_wm", () => {
    const installed = resolveMemorySystemConfig({});
    assert.equal(installed.enabled, false, "installing the package turns no session on");
    const on = resolveMemorySystemConfig({ enabled: true });
    assert.equal(on.enabled, true);
    assert.equal(on.context.compaction, true, "session memory is the compaction system when on");
    assert.deepEqual(resolveMemorySystemComponents({ enabled: true }), {
      stm: true,
      wm: false,
      rehearsal: false,
      ltm: false,
      sleep: false,
    });
    // The package resolves its components first and passes them in (setup.ts); a direct call defaults to every tier.
    assert.equal(
      resolveMemorySystemConfig({ enabled: true }, resolveMemorySystemComponents({ enabled: true })).wm.enabled,
      false,
      "no WM pass runs",
    );
  });

  it("wm_runs_only_when_configured", () => {
    assert.equal(resolveMemorySystemComponents({ scope: { text: "Ship the release." } }).wm, false, "a scope alone does not turn WM on");
    assert.equal(resolveMemorySystemComponents({ wm: {} }).wm, true);
    assert.equal(resolveMemorySystemConfig({ wm: {} }, resolveMemorySystemComponents({ wm: {} })).wm.enabled, true);
    assert.equal(resolveMemorySystemComponents({ wm: false }).wm, false);
  });

  it("wm_policy_defaults_to_deterministic", () => {
    assert.equal(resolveMemorySystemConfig({ wm: {} }).wm.policy, "deterministic");
    assert.equal(resolveMemorySystemConfig({ wm: { policy: "model" } }).wm.policy, "model");
  });
});
