import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryModelReport } from "./acceptance-report.mjs";
import {
  assertMemoryModelPin,
  frozenMemoryModelHash,
  MEMORY_MODEL_CRITERIA,
  MEMORY_MODEL_ROW_IDS,
  memoryModelCriteriaHash,
  memoryModelGateVerdict,
  memoryModelManifestPin,
  memoryModelVerdict,
  robustnessCriteriaHash,
  verifyMemoryModelBaselines,
  verifyMemoryModelCriteria,
} from "./robustness.mjs";

const REPO = new URL("../../", import.meta.url);
const repoJson = (path) => JSON.parse(readFileSync(new URL(path, REPO), "utf8"));
const RECORD = "docs/_evidence/memory-bench/memory-model/criteria.json";
const edited = (edit) => {
  const copy = structuredClone(MEMORY_MODEL_CRITERIA);
  edit(copy);
  return copy;
};
const ci = (ciLow, ciHigh = ciLow + 4) => ({
  models: [
    { model: "large", ciLow, ciHigh },
    { model: "small", ciLow, ciHigh },
  ],
});

test("memory_model_criteria_hash_pinned_and_frozen", () => {
  const record = repoJson(RECORD);
  const hash = verifyMemoryModelCriteria();
  assert.equal(record.memoryModelCriteriaHash, hash);
  assert.equal(frozenMemoryModelHash(), hash);
  // Any row edit changes the hash, and the recorded hash then refuses the file.
  const changed = edited((c) => (c.rows.S3.tests[0].kind = "gain"));
  assert.notEqual(memoryModelCriteriaHash(changed), hash);
  assert.throws(() => frozenMemoryModelHash(record, changed), /changed without a new recorded hash/);
  const pin = memoryModelManifestPin();
  assert.deepEqual(pin, { criteriaHash: robustnessCriteriaHash(), memoryModelCriteriaHash: hash });
  assertMemoryModelPin({ ...pin, gate: "M-1" });
  assert.throws(() => assertMemoryModelPin({ criteriaHash: pin.criteriaHash }), /does not pin/);
  assert.throws(() => assertMemoryModelPin({ ...pin, memoryModelCriteriaHash: "0".repeat(64) }), /pins a different/);
  assert.throws(() => assertMemoryModelPin({ ...pin, criteriaHash: "0".repeat(64) }), /different robustness criteria/);
  // The hash rule and the margins are part of the frozen file.
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.statistics.nonInferiorPoints = 3))), /2 points/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => c.partitions.development.push("heldout-a"))), /development partitions only/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.partitions.acceptance.remediationRounds = 2))), /one remediation round/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.gates.rule = "any time"))), /owner's word/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => delete c.gates["M-4"].record)), /gate M-4 names no owner-gate record/);
});

test("every_row_names_metric_direction_arms_threshold_and_gate", () => {
  assert.deepEqual(Object.keys(MEMORY_MODEL_CRITERIA.rows).sort(), [...MEMORY_MODEL_ROW_IDS].sort());
  assert.equal(MEMORY_MODEL_ROW_IDS.length, 31);
  for (const [id, row] of Object.entries(MEMORY_MODEL_CRITERIA.rows)) {
    for (const field of ["gate", "metric", "unit", "direction"]) assert.ok(row[field], `${id} ${field}`);
    assert.ok(row.arms.candidate, `${id} candidate`);
    assert.ok(Object.keys(row.scope).length, `${id} scope`);
    assert.ok(row.tests.length, `${id} threshold`);
    assert.ok(MEMORY_MODEL_CRITERIA.gates[row.gate].rows.includes(id), `${id} gate lists it`);
  }
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => delete c.rows.T4)), /rows must be exactly/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.S1.metric = " "))), /row S1 has no metric/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.L2.direction = undefined))), /row L2 has no direction/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.M2.tests = []))), /row M2 has no threshold/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.Z3.gate = "M-4"))), /names gate M-4, which does not list it/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.R5.tests[0].vs = "OM-before"))), /not one of its arms/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.T3.tests[0].kind = "vibes"))), /unknown kind/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.T4.scope.fixtures = ["nowhere"]))), /unindexed fixture/);
  // R1's threshold is the smallest powered write count for 0.2 (power.mjs).
  assert.deepEqual([MEMORY_MODEL_CRITERIA.rows.R1.tests[0].value, MEMORY_MODEL_CRITERIA.rows.R1.tests[0].minWrites], [0.2, 32]);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.R1.tests[0].minWrites = 20))), /cannot detect/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.rows.R1.tests[0].minWrites = 40))), /not the smallest/);
});

test("wiki_rows_reference_three_tier_criteria_by_hash", () => {
  const { wiki, pins } = MEMORY_MODEL_CRITERIA;
  assert.equal(wiki.criteriaHash, pins.threeTierCriteriaHash);
  assert.equal(wiki.armMapping["P+O"], "ltm+wiki");
  for (const id of Object.keys(MEMORY_MODEL_CRITERIA.rows)) assert.ok(!id.startsWith("O"), `${id} copies a wiki row`);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.wiki.criteriaHash = "0".repeat(64)))), /by its current hash/);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => (c.wiki.criteria = { O1: {} }))), /never copied/);
  assert.throws(
    () => verifyMemoryModelCriteria(edited((c) => (c.pins.threeTierCriteriaHash = "0".repeat(64)))),
    /three-tier criteria changed/,
  );
  assert.throws(() => memoryModelGateVerdict("K-1", null), /--plan 208 --gate K-1/);
});

test("gate_a_manifest_pins_four_criteria_hashes", () => {
  const pin = memoryModelManifestPin({ gate: "A" });
  assert.deepEqual(Object.keys(pin.criteriaPins).sort(), [
    "memory-model-criteria.json",
    "robustness-criteria.json",
    "three-tier-criteria.json",
    "work-outcome-criteria.json",
  ]);
  assertMemoryModelPin({ ...pin, gate: "A" });
  for (const file of Object.keys(pin.criteriaPins)) {
    const missing = structuredClone(pin.criteriaPins);
    delete missing[file];
    assert.throws(() => assertMemoryModelPin({ ...pin, gate: "A", criteriaPins: missing }), new RegExp(`does not pin ${file}`));
    assert.throws(
      () => assertMemoryModelPin({ ...pin, gate: "A", criteriaPins: { ...pin.criteriaPins, [file]: "0".repeat(64) } }),
      new RegExp(`pins a different ${file}`),
    );
  }
  assert.throws(
    () => verifyMemoryModelCriteria(edited((c) => delete c.acceptance.pinsCriteria["work-outcome-criteria.json"])),
    /must pin exactly/,
  );
  // Gate A reads heldout-a (or heldout-b once); development gates never read a held-out partition.
  assert.equal(memoryModelGateVerdict("A", null).partition, "heldout-a");
  assert.throws(() => memoryModelGateVerdict("A", null, { partition: "dev" }), /may not read dev/);
  assert.throws(() => memoryModelGateVerdict("M-2", null, { partition: "heldout-a" }), /may not read heldout-a/);
});

test("baselines_om_before_and_p_resolve_to_recorded_revisions", () => {
  const slimmed = repoJson("docs/_evidence/memory-bench/210/slimmed/record.json");
  assert.equal(MEMORY_MODEL_CRITERIA.baselines.P.productHash, slimmed.productHash);
  assert.throws(
    () => verifyMemoryModelCriteria(MEMORY_MODEL_CRITERIA, { slimmed: { ...slimmed, productHash: "0".repeat(64) } }),
    /plan 210's recorded slimmed product/,
  );
  const record = repoJson("docs/_evidence/memory-bench/memory-model/baselines.json");
  const plan = readFileSync(
    new URL("plans/216-Phase-11-Part-O17-Memory-System-Foundation-Criteria-Ontology-Extraction-One-Package-And-Partial-Use.md", REPO),
    "utf8",
  );
  const task4Started = /^- \[x\] Task 4:/m.test(plan) || /Task 4[^\n]*Notes \(executed/.test(plan) || record.omBefore.revision !== null;
  const resolve = (revision) => spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: REPO.pathname }).status === 0;
  const result = verifyMemoryModelBaselines(record, { task4Started, resolve });
  assert.equal(result.P, slimmed.productHash);
  // Once Task 4 starts, an unpinned or unresolvable OM-before is refused.
  const unpinned = { ...record, omBefore: { ...record.omBefore, revision: null } };
  assert.throws(() => verifyMemoryModelBaselines(unpinned, { task4Started: true, resolve }), /pinned once plan 216 Task 4 starts/);
  const bogus = { ...record, omBefore: { ...record.omBefore, revision: "f".repeat(40), productHash: "a".repeat(64) } };
  assert.throws(() => verifyMemoryModelBaselines(bogus, { task4Started: true, resolve }), /does not resolve/);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO.pathname, encoding: "utf8" }).stdout.trim();
  const pinned = { ...record, omBefore: { ...record.omBefore, revision: head, productHash: "a".repeat(64) } };
  assert.equal(verifyMemoryModelBaselines(pinned, { task4Started: true, resolve }).omBefore, head);
  assert.throws(() => verifyMemoryModelBaselines({ ...record, P: { productHash: "0".repeat(64) } }), /slimmed product/);
});

test("every_qa_row_reports_evidence_coverage_beside_accuracy", () => {
  assert.deepEqual(MEMORY_MODEL_CRITERIA.qaRows, ["S3", "M5", "R5", "R6", "T7", "L4", "Z1"]);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => c.qaRows.pop())), /QA rows must be/);
  const passing = {
    S3: { tests: { "vs-om-before": ci(-1) } },
    M5: { tests: { "vs-stm-only": ci(-1) } },
    R5: { tests: { "vs-p": ci(-1) } },
    R6: { tests: { "vs-p": ci(1) } },
    T7: {
      tests: {
        abilities: {
          metrics: {
            "multi-session": ci(1),
            temporal: ci(-1),
            "event-ordering": ci(0),
            "knowledge-update": ci(-1.5),
            "single-hop": ci(-1),
          },
        },
      },
    },
    L4: { tests: { qa: ci(-0.5) } },
    Z1: { tests: { "cross-session": { metrics: { W1: ci(1), W2: ci(-1), W3: ci(0), W4: ci(-1), "multi-session-qa": ci(-1) } } } },
  };
  for (const [row, evidence] of Object.entries(passing)) {
    assert.equal(memoryModelVerdict(row, evidence).status, "missing", `${row} without coverage`);
    assert.equal(memoryModelVerdict(row, { ...evidence, coverage: { "multi-session": 0.61 } }).status, "pass", `${row} with coverage`);
  }
  // A non-QA row needs no coverage.
  assert.equal(memoryModelVerdict("M2", { tests: { loss: { value: 0 } } }).status, "pass");
});

test("retrieval_set_rules_pinned_before_sets_exist", () => {
  const sets = MEMORY_MODEL_CRITERIA.retrievalSets;
  assert.deepEqual(Object.keys(sets.rules).sort(), ["abstention", "non-english", "paraphrase", "parity"]);
  assert.deepEqual(Object.values(sets.hashes), [null, null, null, null]);
  assert.equal(sets.thresholds, null);
  assert.match(sets.thresholdFit.rule, /maximum F1/);
  assert.equal(sets.thresholdFit.falseAbstentionWeight, 2);
  assert.throws(() => verifyMemoryModelCriteria(edited((c) => delete c.retrievalSets.rules.parity)), /parity has no construction rule/);
  assert.throws(
    () => verifyMemoryModelCriteria(edited((c) => (c.retrievalSets.thresholdFit.falseAbstentionWeight = 1))),
    /threshold-fit rule/,
  );
  // Plan 219.1 adds only hashes, and only by an amendment.
  assert.throws(
    () => verifyMemoryModelCriteria(edited((c) => (c.retrievalSets.hashes.paraphrase = "a".repeat(64)))),
    /only by an amendment/,
  );
  const amended = edited((c) => {
    c.amendments = [{ previousHash: memoryModelCriteriaHash(), date: "2026-11-20", reason: "plan 219.1 Task 2 set hashes", plan: "219.1" }];
    c.retrievalSets.hashes.paraphrase = "a".repeat(64);
  });
  assert.match(verifyMemoryModelCriteria(amended), /^[0-9a-f]{64}$/);
  assert.deepEqual(amended.rows, MEMORY_MODEL_CRITERIA.rows);
});

test("memory_model_verdicts_follow_the_frozen_rules", () => {
  // Gains need some model's CI low above 0 and no model negative; non-inferiority holds on every model.
  assert.equal(memoryModelVerdict("S1", { tests: { "vs-om-before": ci(0.5) } }).status, "pass");
  assert.equal(memoryModelVerdict("S1", { tests: { "vs-om-before": ci(0) } }).status, "miss");
  const mixed = {
    models: [
      { ciLow: 1, ciHigh: 5 },
      { ciLow: -6, ciHigh: -1 },
    ],
  };
  assert.equal(memoryModelVerdict("S1", { tests: { "vs-om-before": mixed } }).status, "miss");
  assert.equal(memoryModelVerdict("S1", {}).status, "missing");
  // M1: non-inferior to STM-only and a gain over OM-before, both required.
  assert.equal(memoryModelVerdict("M1", { tests: { "vs-stm-only": ci(-1.9), "vs-om-before": ci(0.1) } }).status, "pass");
  assert.equal(memoryModelVerdict("M1", { tests: { "vs-stm-only": ci(-2.1), "vs-om-before": ci(0.1) } }).status, "miss");
  // S4 passes at 1.25x, or above it with a written justification.
  assert.equal(memoryModelVerdict("S4", { tests: { "token-ratio": { value: 1.3 } } }).status, "miss");
  assert.equal(memoryModelVerdict("S4", { tests: { "token-ratio": { value: 1.3, justification: "chunk store" } } }).status, "pass");
  // M3 compares with the evidence's target; R1 needs the powered write count.
  assert.equal(memoryModelVerdict("M3", { tests: { ratio: { value: 0.45, target: 0.35 } } }).status, "pass");
  assert.equal(memoryModelVerdict("M3", { tests: { ratio: { value: 0.46, target: 0.35 } } }).status, "miss");
  assert.equal(memoryModelVerdict("R1", { tests: { "verified-share": { value: 0.25, writes: 31 } } }).status, "missing");
  assert.equal(memoryModelVerdict("R1", { tests: { "verified-share": { value: 0.25, writes: 42 } } }).status, "pass");
  // Panel rows wait for a calibrated panel.
  assert.equal(memoryModelVerdict("R3", { tests: { supported: { value: 0.95 } } }).status, "missing");
  assert.equal(memoryModelVerdict("R3", { tests: { supported: { value: 0.95, panelCalibrated: true } } }).status, "pass");
  // T1: pooled gain, no ability below -2 points.
  const t1 = (estimate) => ({
    pooled: ci(0.5),
    abilities: [
      { ability: "temporal", estimate },
      { ability: "multi-session", estimate: 3 },
    ],
  });
  assert.equal(memoryModelVerdict("T1", { tests: { "vs-full-r": t1(-1.9), "vs-p": t1(0) } }).status, "pass");
  assert.equal(memoryModelVerdict("T1", { tests: { "vs-full-r": t1(-2.1), "vs-p": t1(0) } }).status, "miss");
  // Exact rows, budgets and suite passes.
  assert.equal(memoryModelVerdict("T4", { tests: { parity: { value: "identical" } } }).status, "pass");
  assert.equal(
    memoryModelVerdict("L2", { tests: { recurrence: ci(1), "false-trigger": { value: 0.06 }, extinction: { value: "extinguished" } } })
      .status,
    "miss",
  );
  assert.equal(
    memoryModelVerdict("Z4", { tests: { calls: { value: 10, budget: 12 }, tokens: { value: 9000, budget: 10000 } } }).status,
    "pass",
  );
  assert.equal(memoryModelVerdict("R4", { tests: { offline: { pass: true }, live: { pass: false } } }).status, "miss");
  // R2: a regression vetoes even with a gain elsewhere.
  assert.equal(memoryModelVerdict("R2", { tests: { "w1-w3": { metrics: { W1: ci(1), W2: ci(-3), W3: ci(0) } } } }).status, "miss");
});

test("memory_model_report_reads_only_pinned_evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-model-"));
  const write = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const pin = memoryModelManifestPin();
  const rows = {
    S1: { tests: { "vs-om-before": ci(1) } },
    S2: { tests: { "byte-equal": { value: 1 }, "other-tool-runs": { value: 0 } } },
    S3: { tests: { "vs-om-before": ci(-1) }, coverage: { "multi-session": 0.5 } },
    S4: { tests: { "token-ratio": { value: 1.1 } } },
  };
  const good = write("good.json", { ...pin, gate: "M-1", partition: "dev", rows });
  const report = await memoryModelReport({ gate: "M-1", partition: "dev", evidencePath: good });
  assert.equal(report.status, "pass");
  assert.equal(report.memoryModelCriteriaHash, pin.memoryModelCriteriaHash);
  const unpinned = write("unpinned.json", { gate: "M-1", partition: "dev", rows });
  await assert.rejects(memoryModelReport({ gate: "M-1", evidencePath: unpinned }), /does not pin/);
  const heldOut = write("heldout.json", { ...pin, gate: "M-1", partition: "heldout-a", rows });
  await assert.rejects(memoryModelReport({ gate: "M-1", evidencePath: heldOut }), /may not read heldout-a/);
  const otherGate = write("other.json", { ...pin, gate: "M-2", partition: "dev", rows });
  await assert.rejects(memoryModelReport({ gate: "M-1", evidencePath: otherGate }), /for gate M-2/);
  await assert.rejects(memoryModelReport({ gate: "M-1", evidencePath: join(dir, "absent.json") }), /does not exist/);
  await assert.rejects(memoryModelReport({}), /needs --gate/);
  assert.equal((await memoryModelReport({ gate: "M-5" })).status, "pending");
});
