import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  ontologySafetyCriteriaHash,
  ontologyVerdict,
  runConceptPoisoning,
  runCrossScope,
  runForgetCascade,
  runHumanEditBypass,
  runTeamConceptTrust,
} from "./ontology.mjs";
import {
  runDeletion,
  runFalseRefusal,
  runLeakage,
  runPii,
  runPoisoning,
  runSafetySuite,
  safetyCriteriaHash,
  safetyVerdict,
} from "./run.mjs";

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

describe("plan 208 Task 4 ontology probes", () => {
  it("forget_cascade_leaves_no_trace_in_concepts_recall_or_tail", async () => {
    const result = await runForgetCascade();
    assert.equal(result.modelCalls, 0);
    for (const [name, pass] of Object.entries(result.checks)) assert.equal(pass, true, name);
    assert.equal(result.leaks, 0);
  }, 60_000);

  it("concept_never_crosses_project_or_cites_wider_scope", async () => {
    const result = await runCrossScope();
    for (const [name, pass] of Object.entries(result.checks)) assert.equal(pass, true, name);
    assert.equal(result.foreignExposures, 0);
    assert.equal(result.userConceptCitesProjectNote, 0);
  }, 60_000);

  it("poison_canary_never_in_delivered_claim", async () => {
    const result = await runConceptPoisoning();
    for (const [name, pass] of Object.entries(result.checks)) assert.equal(pass, true, name);
    assert.equal(result.deliveredPoisonClaims, 0);
    assert.equal(result.inconclusive, 0);
    // The pattern scan cannot see a paraphrased lure: recorded as a residual outside the gate, for the live panel.
    const residual = result.scenarios.evasiveResidual;
    assert.equal(residual.patternScanCaughtIt, false);
    assert.equal(residual.gated, false);
    assert.equal(residual.panelRequired, true);
  }, 60_000);

  it("team_and_human_edited_concepts_with_instructions_quarantined", async () => {
    const team = await runTeamConceptTrust();
    for (const [name, pass] of Object.entries(team.checks)) assert.equal(pass, true, `team ${name}`);
    assert.equal(team.deliveredPoisonClaims, 0);
    const human = await runHumanEditBypass();
    for (const [name, pass] of Object.entries(human.checks)) assert.equal(pass, true, `human ${name}`);
    assert.equal(Object.keys(human.variants).length, 3);
    assert.equal(human.deliveredPoisonClaims, 0);
  }, 60_000);

  it("ontology_verdict_fails_closed_and_leaves_the_202_verdict_alone", async () => {
    const failing = {
      forgetCascade: { checks: { x: true }, leaks: 1 },
      crossScope: { checks: { x: true }, foreignExposures: 0, userConceptCitesProjectNote: 0 },
      poisoning: { checks: { x: true }, deliveredPoisonClaims: 0 },
      teamTrust: { checks: { x: true }, deliveredPoisonClaims: 0 },
      humanEdit: { checks: { x: true }, deliveredPoisonClaims: 0 },
    };
    const verdict = ontologyVerdict(failing, true);
    assert.equal(verdict.pass, false, "one forgotten-content leak fails O4");
    assert.equal(verdict.o4, "fail");
    assert.equal(ontologyVerdict({ ...failing, forgetCascade: { checks: { x: true }, leaks: 0 } }, undefined).o4, "pending-gate-202");
    assert.equal(ontologyVerdict({ ...failing, forgetCascade: { checks: { x: true }, leaks: 0 } }, true).o4, "pass");
    assert.equal(ontologyVerdict({ ...failing, forgetCascade: { checks: { x: true }, leaks: 0 } }, false).o4, "fail");
    assert.equal(ontologySafetyCriteriaHash().length, 64);

    // Without --ontology the suite reports exactly what plan 202 Task 14 reported before, and no ontology block.
    const plain = await runSafetySuite({ full: false });
    assert.equal(plain.ontology, undefined);
    assert.equal(plain.o4, undefined);
    assert.equal(plain.criteriaHash, safetyCriteriaHash());
  }, 60_000);

  it("ontology_report_carries_no_text", async () => {
    const report = await runSafetySuite({ full: false, ontology: true });
    const json = JSON.stringify(report);
    for (const marker of [
      "CASCADE-CLAIM-4711",
      "CASCADE-NOTE-9001",
      "XSCOPE-A-CANARY",
      "POISON-CANARY-7",
      "POISON-CANARY-EVASIVE",
      "TEAM-CONTROL",
      "HUMAN-CONTROL",
      "Ignore all previous",
    ]) {
      assert.equal(json.includes(marker), false, marker);
    }
    assert.equal(report.modelCalls, 0);
    assert.equal(report.ontology.verdict.pass, true);
    assert.equal(report.o4.o4, "pending-gate-202");
  }, 120_000);
});
