import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryModelGateVerdict, memoryModelManifestPin } from "./robustness.mjs";
import {
  assertM2Gate,
  assertM2OfflineRows,
  assertM2Paired,
  assertM2Partition,
  buildM2Evidence,
  buildM2Manifest,
  isProductTestPath,
  M2_JUDGES,
  M2_PROBES,
  M2_SUITE_QUESTIONS,
  m2Jobs,
  m2OfflineRows,
} from "./wm-gate.mjs";
import { longSessionWmStats } from "./work-outcome/long-session.mjs";
import { parseLongSessionLiveArgs } from "./work-outcome/long-session-live.mjs";

const probes = JSON.parse(readFileSync(M2_PROBES, "utf8"));

/** A scored suite report: `correct(i)` per question. */
function suiteReport(ids, { correct = () => true, status = "partial" } = {}) {
  return {
    status,
    results: ids.map((id, index) => ({
      id,
      ability: index % 2 ? "a" : "b",
      outcome: "scored",
      correct: correct(index),
      evidenceAllRequired: true,
      phaseTiming: { answer: 1000 + index },
    })),
    workerUsage: { reflector: { calls: 2, inputTokens: 100, outputTokens: 10 } },
    wmCalls: { calls: 2, items: 3, capStops: 1, capNoItem: 1, stopReasons: { end_turn: 1, max_output_tokens: 1 } },
    inputTokens: 1000,
    cacheReadTokens: 800,
  };
}

/** A family job report for one arm: `value(persona, pair)` gives success and re-derivations. */
function familyReport(arm, { success = () => true, rederivations = () => 0, personas = ["rp1", "rp4", "rp6", "rp9"], repeat } = {}) {
  return {
    status: "completed",
    ...(repeat ? { repeat } : {}),
    inputTokens: 100,
    report: {
      rows: {
        [arm]: personas.flatMap((persona) =>
          ["p1", "p2"].map((pair) => ({ persona, pair, success: success(persona, pair), rederivations: rederivations(persona, pair) })),
        ),
      },
      usage: personas.map((persona) => ({
        persona,
        arm,
        worker: { calls: 3, inputTokens: 900, outputTokens: 100 },
        main: { calls: 9, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 },
        eligibleTokens: 10_000,
        ...(arm === "WM" ? { wmCalls: { calls: 2, items: 4, capStops: 0, capNoItem: 0, stopReasons: { end_turn: 2 } } } : {}),
        session: { compactions: 2, passes: 2, items: [2, 2], budgetUnmet: 1, ratios: [0.25] },
      })),
      summary: { [arm]: { successRate: 1, rederivationsPerRelatedTask: 0 } },
    },
  };
}

function allReports({ wmSuccess = () => true, wmCorrect = () => true, s1 = () => 1 } = {}) {
  const reports = new Map();
  const ids = Array.from({ length: M2_SUITE_QUESTIONS }, (_, index) => `q${index}`);
  for (const model of ["deepseek", "muse"]) {
    reports.set(`218-m2.${model}.WM.re-plan`, familyReport("WM", { success: wmSuccess }));
    reports.set(`218-m2.${model}.STM-only.re-plan`, familyReport("STM-only", { success: () => false }));
    reports.set(`218-m2.${model}.OM-before.re-plan`, familyReport("OM-before", { success: () => false }));
    for (const suite of ["longmemeval-m", "beam-1m"]) {
      reports.set(`218-m2.${model}.WM.${suite}`, suiteReport(ids, { correct: wmCorrect }));
      reports.set(`218-m2.${model}.STM-only.${suite}`, suiteReport(ids));
    }
  }
  for (let repeat = 1; repeat <= 3; repeat++) {
    reports.set(`218-m2.mimo.OM-before.long-session.r${repeat}`, familyReport("OM-before", { rederivations: () => 2, repeat }));
    reports.set(`218-m2.mimo.WM.long-session.r${repeat}`, familyReport("WM", { rederivations: s1, repeat }));
    reports.set(`218-m2.mimo.STM-only.long-session.r${repeat}`, familyReport("STM-only", { rederivations: s1, repeat }));
  }
  return reports;
}

test("gate_m2_arms_paired_on_identical_items", async () => {
  const jobs = m2Jobs();
  // re-plan: 2 models x 3 arms; S1: MiMo x 3 arms x 3 repeats; M5: 2 models x 2 suites x {WM, STM-only};
  // long-session cost rows: 2 models x 3 arms.
  assert.equal(jobs.length, 2 * 3 + 3 * 3 + 2 * 2 * 2 + 2 * 3);
  assertM2Paired(jobs);
  assert.ok(jobs.every((job) => job.subset === "dev" && job.provider === "opencode-go"));
  assert.deepEqual([...new Set(jobs.map((job) => job.model))].sort(), [
    "deepseek-v4.1-flash",
    "mimo-v2.6-flash",
    "muse-spark-1.3-contributor",
  ]);
  // MiMo runs only the long-session family, three repeats per arm.
  const mimo = jobs.filter((job) => job.model_key === "mimo");
  assert.ok(mimo.every((job) => job.suite === "long-session" && job.sitting === 2));
  assert.deepEqual([...new Set(mimo.map((job) => job.repeat))], [1, 2, 3]);
  // The suites: WM takes the task framing as its scope, STM-only the deterministic policy, both the same judges.
  const suites = jobs.filter((job) => job.kind === "robustness");
  assert.ok(suites.every((job) => job.maxQuestions === M2_SUITE_QUESTIONS && job.judges === M2_JUDGES.join(",")));
  assert.ok(suites.filter((job) => job.arm === "WM").every((job) => job.wmScope === true && !job.ablate));
  assert.ok(
    suites.filter((job) => job.arm === "STM-only").every((job) => !job.wmScope && job.ablate[0] === "session.wm.policy=deterministic"),
  );
  assert.ok(!suites.some((job) => job.arm === "OM-before"));
  // Judges never answer.
  assert.ok(!jobs.some((job) => M2_JUDGES.includes(`${job.provider}/${job.model}`)));
  // OM-before runs from the pinned worktree, the others from this tree.
  assert.ok(jobs.every((job) => (job.arm === "OM-before") === Boolean(job.cwd)));
  // A pair that differs in more than the arm is refused, and so is an arm without its switches.
  const tampered = jobs.map((job) => (job.id === "218-m2.muse.STM-only.beam-1m" ? { ...job, judges: "opencode-go/qwen3.8-flash" } : job));
  assert.throws(() => assertM2Paired(tampered), /differ in more than the arm/);
  const unscoped = jobs.map((job) => (job.id === "218-m2.muse.WM.beam-1m" ? { ...job, wmScope: undefined } : job));
  assert.throws(() => assertM2Paired(unscoped), /switches/);
  // Development partition only, in the manifest, the CLI and the live family child.
  assert.throws(() => assertM2Partition("heldout-a"), /dev partition only/);
  const live = [
    "--job",
    "j",
    "--model",
    "opencode-go/mimo-v2.6-flash",
    "--arm",
    "WM",
    "--max-input-tokens",
    "10",
    "--output",
    "o.json",
    "--state-dir",
    "s",
  ];
  const parsed = parseLongSessionLiveArgs([...live, "--gate", "M-2", "--family", "re-plan", "--repeat", "2"]);
  assert.deepEqual([parsed.gate, parsed.family, parsed.repeat, parsed.partition], ["M-2", "re-plan", 2, "dev"]);
  // The family jobs run at the manifest's output limit (gate M-1's child ran at 4,096 for every call).
  assert.ok(jobs.filter((job) => job.kind === "long-session").every((job) => job.maxOutputTokens === 8192));
  assert.equal(parseLongSessionLiveArgs([...live, "--gate", "M-2", "--max-output-tokens", "8192"]).maxOutputTokens, 8192);
  assert.equal(parsed.maxOutputTokens, 4096);
  assert.throws(() => parseLongSessionLiveArgs([...live, "--gate", "M-1", "--family", "re-plan"]), /runs no re-plan family/);
  assert.throws(() => parseLongSessionLiveArgs([...live, "--gate", "M-2", "--partition", "heldout-a"]), /dev partition only/);
  // Scoring pairs identical items only: with one persona missing from WM, those pairs are unpaired, never imputed.
  const reports = allReports();
  const short = familyReport("WM", { personas: ["rp1", "rp4", "rp6"] });
  reports.set("218-m2.deepseek.WM.re-plan", short);
  const evidence = buildM2Evidence({ reports, manifest: { jobs, baselines: { omBefore: {} } }, probes, iterations: 50 });
  const m1 = evidence.rows.M1.tests["vs-stm-only"].models.find((row) => row.model === "deepseek");
  assert.equal(m1.n, 6);
  assert.deepEqual(m1.unpaired, { base: 2, candidate: 0 });
  // The product fingerprint leaves out test files only.
  assert.ok(isProductTestPath("src/__tests__/a.test.ts") && isProductTestPath("src/__tests__", true) && isProductTestPath("src/x.test.ts"));
  assert.ok(!isProductTestPath("src/agent.ts") && !isProductTestPath("src/testing.ts"));
});

test("m2_offline_rows_pass_before_paid_run", async () => {
  // Task 5's probes give M2-M4 their values; the paid run refuses to start unless every WM probe reads works.
  assertM2OfflineRows(probes);
  const rows = m2OfflineRows(probes);
  assert.equal(rows.M2.tests.loss.value, 0);
  assert.ok(rows.M3.tests.ratio.value <= rows.M3.tests.ratio.target + 0.1);
  assert.equal(rows.M4.tests.prefix.value, "byte-identical");
  const broken = {
    ...probes,
    probes: probes.probes.map((probe) => (probe.id === "wm.protected" ? { ...probe, verdict: "broken" } : probe)),
  };
  assert.throws(() => assertM2OfflineRows(broken), /wm.protected does not read works/);
  const lossy = {
    ...probes,
    probes: probes.probes.map((probe) => (probe.id === "wm.protected" ? { ...probe, counts: { ...probe.counts, lost: 1 } } : probe)),
  };
  assert.throws(() => assertM2OfflineRows(lossy), /row M2 reads miss/);
  // The manifest pins the probe file, and the gate refuses an unapproved or rebound record.
  const manifest = await buildM2Manifest();
  assert.ok(manifest.probes.sha256);
  const gate = {
    kind: "memory-model-owner-gate",
    plan: 218,
    gate: "M-2",
    approved: true,
    approvedBy: "owner",
    text: "start",
    manifestHash: manifest.manifestHash,
    memoryModelCriteriaHash: manifest.memoryModelCriteriaHash,
    criteriaHash: manifest.criteriaHash,
    partitions: ["dev"],
    budget: { provider: "opencode-go", billing: "subscription" },
    models: {
      answers: { deepseek: "opencode-go/deepseek-v4.1-flash", muse: "opencode-go/muse-spark-1.3-contributor" },
      s1: "opencode-go/mimo-v2.6-flash",
      judges: [...M2_JUDGES],
    },
  };
  assertM2Gate(gate, manifest);
  assert.throws(() => assertM2Gate({ ...gate, approved: false }, manifest), /not approved/);
  assert.throws(() => assertM2Gate({ ...gate, manifestHash: "x" }, manifest), /manifest differs/);
  assert.throws(
    () => assertM2Gate({ ...gate, models: { ...gate.models, judges: ["openrouter/free"] } }, manifest),
    /outside the gate M-2 models/,
  );
  assert.throws(() => assertM2Gate({ ...gate, closed: { at: "2026-11-12", by: "owner" } }, manifest), /closed/);
});

test("m2_verdicts_computed_from_memory_model_criteria_only", () => {
  const jobs = m2Jobs();
  const manifest = { jobs, baselines: { omBefore: {} } };
  const pin = buildM2Evidence({ reports: new Map(), manifest, probes, iterations: 10 });
  // No run reports: M1 and M5 are missing, never a pass; M2-M4 come from the probes.
  const pending = memoryModelGateVerdict("M-2", { ...pin, ...pinOf() });
  const status = Object.fromEntries(pending.rows.map((row) => [row.row, row.status]));
  assert.deepEqual(status, { M1: "missing", M2: "pass", M3: "pass", M4: "pass", M5: "missing" });
  // WM wins every re-plan task and ties the QA sample: M1 passes, M5 is non-inferior (its interval is wide).
  const full = buildM2Evidence({ reports: allReports(), manifest, probes, iterations: 200 });
  const verdict = memoryModelGateVerdict("M-2", { ...full, ...pinOf() });
  const rows = Object.fromEntries(verdict.rows.map((row) => [row.row, row.status]));
  assert.equal(rows.M1, "pass");
  assert.equal(rows.M5, "pass");
  assert.equal(full.rows.M5.tests["vs-stm-only"].underpowered, true);
  // WM's output cap is counted per model; the S1 re-measure is reported against plan 217's row.
  assert.deepEqual(full.wmOutputCap.deepseek.capNoItem, 2);
  assert.equal(full.s1["WM - OM-before"].repeats, 3);
  assert.equal(full.s1["WM - OM-before"].estimate, 1);
  assert.match(full.s1.result, /not below zero/);
  // A worse WM on the QA sample is a miss, and so is MiMo re-deriving more with both new arms.
  const worse = buildM2Evidence({ reports: allReports({ wmCorrect: () => false, s1: () => 4 }), manifest, probes, iterations: 200 });
  assert.equal(memoryModelGateVerdict("M-2", { ...worse, ...pinOf() }).rows.find((row) => row.row === "M5").status, "miss");
  assert.match(worse.s1.result, /^miss/);
  assert.ok(worse.s1.perPersona.rp1);
  // The family's session stats read WM passes and compactions from the log.
  const stats = longSessionWmStats([
    { kind: "compaction" },
    {
      data: {
        op: "append",
        value: { type: "memory.session.wm.recorded", items: [1, 2], compression: { processedTokens: 100, itemTokens: 20 } },
      },
    },
    { data: { op: "append", value: { type: "memory.session.wm.recorded", items: [], budgetUnmet: {} } } },
  ]);
  assert.deepEqual(stats, { compactions: 1, passes: 2, items: [2, 0], budgetUnmet: 1, ratios: [0.2] });
});

/**
 * The evidence pins whatever the current criteria hash is. Plan 218.1 Task 1: the committed M-2 manifest is the paused
 * sitting's (it pins amendment 5's hash) until plan 218.1 Task 3 rebuilds it, so the pin is computed, not read.
 */
function pinOf() {
  const { memoryModelCriteriaHash, criteriaHash } = memoryModelManifestPin();
  return { memoryModelCriteriaHash, criteriaHash };
}
