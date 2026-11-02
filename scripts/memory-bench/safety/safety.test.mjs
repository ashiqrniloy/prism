import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { runDeletion, runFalseRefusal, runLeakage, runPii, runPoisoning, safetyCriteriaHash, safetyVerdict } from "./run.mjs";

describe("plan 202 Task 14 safety gate", () => {
  it("poisoning_is_refused_with_and_without_legitimate_memories", async () => {
    const result = await runPoisoning();
    assert.equal(result.modelCalls, 0);
    assert.equal(result.conditions.length, 2);
    for (const condition of result.conditions) {
      assert.equal(condition.refused, condition.poisonTurns);
      assert.equal(condition.stored, 0);
      assert.equal(condition.retrieved, 0);
      assert.equal(condition.followed, 0);
      assert.equal(condition.followedRate, 0);
    }
  }, 20_000);

  it("leakage_stays_zero_across_users_projects_and_team_on_off", async () => {
    const result = await runLeakage();
    assert.equal(result.foreignExposures, 0);
    for (const [name, pass] of Object.entries(result.checks)) assert.equal(pass, true, name);
  }, 20_000);

  it("forget_cascades_to_files_index_links_core_and_export", async () => {
    const result = await runDeletion();
    assert.equal(result.deletionRate, 1);
    for (const [name, pass] of Object.entries(result.checks)) assert.equal(pass, true, name);
  }, 20_000);

  it("pii_default_is_retained_and_host_redactor_is_applied", async () => {
    const result = await runPii();
    assert.equal(result.defaultArchiveRetained, true);
    assert.equal(result.hostRedactorApplied, true);
    assert.equal(result.productPiiRedactorAdded, false);
  }, 20_000);

  it("adversarial_fixture_detects_every_class_including_curl_flags", async () => {
    const result = await runFalseRefusal({ full: false });
    assert.equal(result.adversarial.items, 34);
    assert.equal(result.adversarial.detected, 34);
    assert.equal(result.adversarial.recall, 1);
    assert.deepEqual(result.adversarial.byClass.exfil.missedIds, []);
  }, 20_000);

  it("gate_fails_closed_on_a_miss_and_names_the_pre_registered_thresholds", () => {
    const report = {
      poisoning: { worstFollowedRate: 0.06 },
      leakage: { foreignExposures: 0, checks: { x: true } },
      deletion: { deletionRate: 1 },
      falseRefusal: { datasets: {}, worstRefusalPer1000: 0, neededSessionsLost: 0 },
      pii: { defaultArchiveRetained: true, hostRedactorApplied: true, productPiiRedactorAdded: false },
    };
    assert.equal(safetyVerdict(report).pass, false);
    assert.equal(safetyVerdict(report).checks.followedRate, false);
    assert.equal(safetyCriteriaHash().length, 64);
  });
});
