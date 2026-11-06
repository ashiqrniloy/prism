import { beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { THREE_TIER_CRITERIA } from "../robustness.mjs";
import { drawWorkOutcomePartitions, partitionFile } from "./draw.mjs";
import {
  assertWorkOutcomeCriteriaPin,
  assertWorkReportHasNoText,
  o8Row,
  verifyWorkOutcomeCriteria,
  W_METRICS,
  WORK_OUTCOME_ARMS,
  WORK_OUTCOME_CRITERIA,
  WORK_OUTCOME_PARTITIONS,
  workOutcomeCriteriaHash,
  workOutcomeManifestPin,
} from "./metrics.mjs";
import { createWorkPersona, personaIds, WORK_OUTCOME_FAMILIES, WORK_OUTCOME_PERSONA_COUNTS, WORK_OUTCOME_POISON } from "./personas.mjs";
import { runWorkOutcome } from "./run.mjs";

let report;
beforeAll(async () => {
  report = await runWorkOutcome({ offline: true, personaLimit: 1, concurrency: 6 });
}, 300_000);

test("work_outcome_offline_computes_every_metric", () => {
  assert.equal(report.mode, "offline");
  assert.deepEqual(report.arms, [...WORK_OUTCOME_ARMS]);
  for (const arm of WORK_OUTCOME_ARMS) {
    const pooled = report.summary[arm].pooled;
    for (const metric of [...W_METRICS, "W4tokens"]) {
      assert.ok(pooled[metric].n > 0, `${arm} ${metric} has rows`);
      assert.equal(typeof pooled[metric].mean, "number", `${arm} ${metric} computes`);
    }
    for (const family of WORK_OUTCOME_FAMILIES) assert.equal(report.summary[arm].byFamily[family].sessions, 6);
    for (const key of ["poisonCanary", "crossProjectLeakage", "staleUse"]) assert.equal(typeof report.safety[arm][key], "number");
    assert.ok(
      report.rows[arm].every((row) => row.status === "succeeded"),
      `${arm} sessions complete`,
    );
    assert.equal(report.summary[arm].pooled.simulatorLeak, 0, `${arm}: the scripted user never volunteers a hidden answer`);
  }
  // The request-driven mock is sensitive to memory: without it the corrected mistake recurs and facts are re-asked.
  assert.equal(report.summary["memory-off"].pooled.W1.mean, 1);
  assert.equal(report.summary["memory-off"].pooled.W3.mean, 1);
  assert.equal(report.summary["P+W"].pooled.W1.mean, 0);
  assert.ok(report.summary["P+W"].pooled.W4.mean < report.summary["memory-off"].pooled.W4.mean);
  // W5: the W arms write cited lessons and captured rules; the panel labels every sampled claim.
  for (const arm of ["P+W", "P+W+O", "coding+W"]) {
    assert.ok(report.w5[arm].lessons > 0 && report.w5[arm].rules > 0, `${arm} has lessons and rules`);
    assert.equal(report.w5[arm].sampled, report.w5[arm].judged + report.w5[arm].uncited);
    assert.equal(typeof report.w5[arm].supportedShare, "number");
  }
  assert.equal(report.w5.P.sampled, 0, "P captures no rules and writes no lessons");
  // Every pre-registered row evaluates, each check with a verdict.
  for (const name of Object.keys(WORK_OUTCOME_CRITERIA.rows)) {
    const row = report.criteria[name];
    assert.ok(row.checks.length > 0, name);
    for (const check of row.checks) assert.notEqual(check.pass, null, `${name} ${check.metric}`);
  }
  assert.equal(report.safety["P+W"].poisonCanary, 0);
  assert.ok(report.cost.wallMs > 0 && report.cost.mainRequests > 0 && report.cost.inputTokens > 0);
  assert.equal(report.workOutcomeCriteriaHash, workOutcomeCriteriaHash());
});

test("persona_draw_label_blind_and_frozen", () => {
  for (const family of WORK_OUTCOME_FAMILIES) {
    const committed = WORK_OUTCOME_PARTITIONS[family];
    assert.deepEqual(partitionFile(family), committed, `${family} partition file re-derives`);
    // Ids only: order of input and anything but the id cannot move the draw.
    const ids = personaIds(family);
    assert.deepEqual(drawWorkOutcomePartitions(family, [...ids].reverse()).abilities, committed.abilities);
    const all = Object.values(committed.abilities).flatMap((partition) => Object.values(partition).flat());
    assert.deepEqual([...all].sort(), [...ids].sort(), "disjoint partitions cover every persona");
    assert.equal(new Set(all).size, all.length);
    assert.equal(committed.idsHash, WORK_OUTCOME_CRITERIA.pins.partitionIdsHash[family]);
    assert.throws(() => drawWorkOutcomePartitions(family, ids.slice(1)), /WorkOutcomeDraw/);
  }
  assert.equal(WORK_OUTCOME_PERSONA_COUNTS.coding, 12);
  assert.ok(WORK_OUTCOME_PERSONA_COUNTS.assistant >= 8);
  for (const family of WORK_OUTCOME_FAMILIES)
    for (let index = 0; index < WORK_OUTCOME_PERSONA_COUNTS[family]; index++) {
      const persona = createWorkPersona(family, index);
      assert.ok(persona.schedule.length >= 6);
      assert.ok(
        persona.schedule.some((session) => session.w1Opportunity),
        "a corrected mistake recurs",
      );
      assert.ok(
        persona.schedule.some((session) => session.w2Checks.length),
        "conventions are tested later",
      );
      assert.ok(
        persona.schedule.some((session) => session.w3Keys.length),
        "a fact is needed again",
      );
      assert.ok(
        persona.schedule.some((session) => session.returning),
        "a returning-project start",
      );
      if (family === "assistant") assert.ok(persona.labels.changedFact, "a fact changes");
      assert.ok(
        Object.values(persona.fixtures).every((files) => files["README.md"].includes(WORK_OUTCOME_POISON)),
        "canary planted",
      );
    }
});

test("manifest_refuses_work_outcome_criteria_drift", async () => {
  const pin = workOutcomeManifestPin();
  assert.equal(pin.workOutcomeCriteriaHash, verifyWorkOutcomeCriteria());
  assertWorkOutcomeCriteriaPin({ ...pin, jobs: [] });
  assert.throws(() => assertWorkOutcomeCriteriaPin({}), /does not pin/);
  assert.throws(() => assertWorkOutcomeCriteriaPin({ ...pin, workOutcomeCriteriaHash: "0".repeat(64) }), /pins a different/);
  assert.throws(() => assertWorkOutcomeCriteriaPin({ ...pin, threeTierCriteriaHash: "0".repeat(64) }), /three-tier/);
  assert.throws(() => assertWorkOutcomeCriteriaPin({ ...pin, partitionIdsHash: { coding: "0".repeat(64) } }), /coding partitions/);
  // Drift inside the file: a threshold, a partition pin or a pinned upstream hash.
  assert.notEqual(workOutcomeCriteriaHash({ ...WORK_OUTCOME_CRITERIA, frozen: "2000-01-01" }), pin.workOutcomeCriteriaHash);
  const moved = structuredClone(WORK_OUTCOME_CRITERIA);
  moved.pins.partitionIdsHash.assistant = "0".repeat(64);
  assert.throws(() => verifyWorkOutcomeCriteria(moved), /assistant partition ids changed/);
  const upstream = structuredClone(WORK_OUTCOME_CRITERIA);
  upstream.pins.threeTierCriteriaHash = "0".repeat(64);
  assert.throws(() => verifyWorkOutcomeCriteria(upstream), /three-tier/);
  const arm = structuredClone(WORK_OUTCOME_CRITERIA);
  arm.rows.work.arms.vs = "P-prime";
  assert.throws(() => verifyWorkOutcomeCriteria(arm), /unknown arm/);
  // Reports pin the hash; a live run cannot read a held-out partition here.
  assert.equal(report.workOutcomeCriteriaHash, pin.workOutcomeCriteriaHash);
  await assert.rejects(
    runWorkOutcome({
      offline: false,
      partition: "heldout-a",
      providers: [],
      model: {},
      simulatorModel: {},
      simulatorProviders: [],
      judges: [],
    }),
    /plan 210 Task 9/,
  );
});

test("ontology_work_row_matches_three_tier_o8", () => {
  const row = WORK_OUTCOME_CRITERIA.rows["ontology-work"];
  const o8 = o8Row();
  for (const field of Object.keys(o8)) assert.deepEqual(row[field], o8[field], field);
  assert.deepEqual(o8.arms, { candidate: "P+W+O", vs: "P+W" });
  assert.equal(THREE_TIER_CRITERIA.pins.workOutcomeRow, "ontology-work");
  const edited = structuredClone(WORK_OUTCOME_CRITERIA);
  edited.rows["ontology-work"].nonInferior.W1 = 3;
  assert.throws(() => verifyWorkOutcomeCriteria(edited), /differs from O8/);
});

test("reports_carry_no_text", () => {
  const personas = report.families.flatMap((family) =>
    report.personas
      .filter((entry) => entry.family === family)
      .map((entry) => entry.id)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .map((id) => createWorkPersona(family, personaIds(family).indexOf(id))),
  );
  assert.ok(personas.length === 2);
  assertWorkReportHasNoText(report, personas);
  const body = JSON.stringify(report);
  for (const persona of personas) {
    assert.ok(!body.includes(persona.labels.action.right));
    for (const session of persona.schedule) for (const value of Object.values(session.expected)) assert.ok(!body.includes(`"${value}"`));
  }
  assert.throws(() => assertWorkReportHasNoText({ ...report, leak: personas[0].schedule[0].opening }, personas), /persona or fixture text/);
  assert.throws(() => assertWorkReportHasNoText({ ...report, leak: WORK_OUTCOME_POISON }, personas), /persona or fixture text/);
});
