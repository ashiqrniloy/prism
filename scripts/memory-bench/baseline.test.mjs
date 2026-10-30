import { test } from "bun:test";
import assert from "node:assert/strict";
import { authoritativeReports, BASELINE_JUDGES, buildBaselineManifest, leverDecision, summarizeBaseline } from "./baseline.mjs";
import { permanentFailure } from "./campaign.mjs";
import { judgeFamily } from "./judge.mjs";
import { robustnessCriteriaHash } from "./robustness.mjs";

test("baseline_gaps_pair_unique_ids_and_matching_clusters", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`,
    ability: "summarization",
    cluster: `c${i % 3}`,
    correct: false,
    graded: 0.2,
  }));
  const report = (config, results) => ({ suite: "beam-100k", provider: "p", model: "m", config, results });
  const a = report("lexical-topk", rows);
  const b = report(
    "fabric-x-tools",
    rows.map((r) => ({ ...r, correct: true, graded: 0.7 })),
  );
  const result = summarizeBaseline([a, b]).gaps[0];
  assert.equal(result.gap, 1);
  assert.equal(result.clusters, 3);
  assert.equal(result.wins, 8);
  assert.equal(result.losses, 0);
  assert.deepEqual(result.ci95, [1, 1]);
  assert.ok(Math.abs(result.abilities.summarization.graded.diff - 0.5) < 1e-9);
  assert.equal(result.status, "paired-descriptive");
  assert.equal(result.pHolm, 0.75, "family includes overall, ability binary and graded tests");
  assert.equal(summarizeBaseline([a, { ...b, results: b.results.slice(1) }]).gaps[0].status, "incomplete");
  assert.equal(summarizeBaseline([a, { ...b, results: [...b.results, b.results[0]] }]).gaps[0].status, "incomplete");
  assert.equal(summarizeBaseline([a, { ...b, results: b.results.map((r) => ({ ...r, cluster: "wrong" })) }]).gaps[0].status, "incomplete");
  assert.match(summarizeBaseline([a, { ...b, analysisVersion: "different" }]).gaps[0].reason, /mismatched analysisVersion/);
  const missingGraded = { ...b, results: b.results.map(({ graded, ...row }) => row) };
  assert.equal(summarizeBaseline([a, missingGraded]).gaps[0].abilities.summarization.graded.status, "incomplete");
});

test("baseline_manifest_pins_criteria_and_product_hash", async () => {
  const gate = { text: "owner gate 1: run the development baseline (paid)" };
  const manifest = await buildBaselineManifest({ gate });
  assert.equal(manifest.criteriaHash, robustnessCriteriaHash());
  assert.equal(manifest.analysis.analysisVersion, "202-paired-cluster-v1");
  assert.match(manifest.analysis.analysisHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.analysis.acceptance.margin, 0.03);
  assert.match(manifest.productHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.harnessHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.ownerGate.text, gate.text);
  assert.equal(manifest.status, "gate-recorded");
  assert.equal(manifest.billing.mode, "paid");
  assert.equal(manifest.jobs.length, manifest.suites.length * manifest.models.length * manifest.arms.length);
  assert.ok(manifest.jobs.every((job) => job.subset === "dev" && job.maxInputTokens > 0 && job.estimate.inputTokens > 0));
  // The panel is independent of every answer model and spans two families.
  assert.equal(new Set(BASELINE_JUDGES.map(judgeFamily)).size, 2);
  for (const job of manifest.jobs) {
    assert.ok(!BASELINE_JUDGES.includes(`${job.provider}/${job.model}`));
  }
  assert.ok(manifest.compute.usdEquivalent > 0);
  assert.ok(manifest.compute.tokens > 0);
  assert.ok(manifest.jobs.every((job) => job.maxOutputTokens === 8192 && job.concurrency === 1));
  const paid = manifest.jobs.filter((job) => !job.freeProductOnly);
  assert.equal(paid.length, 25);
  assert.deepEqual([...new Set(paid.map((job) => `${job.provider}/${job.model}`))], ["commandcode/meta/muse-spark-1.3-contributor"]);
  assert.ok(paid.every((job) => job.boundedWire));
  const again = await buildBaselineManifest({ gate });
  assert.equal(again.manifestHash, manifest.manifestHash, "hash covers criteria, product and reservations only");
});

test("baseline_retains_compatible_cells_and_refuses_changed_model_or_generation", async () => {
  const { validateBaselineCheckpoint } = await import("./baseline.mjs");
  const { runPathFingerprint } = await import("./run.mjs");
  const job = {
    suite: "beam-100k",
    subset: "dev",
    config: "full",
    provider: "p",
    model: "m",
    judges: "j/a,k/b",
    freeOnly: true,
    maxOutputTokens: 8192,
    questions: 1,
  };
  const report = {
    ...job,
    criteriaHash: robustnessCriteriaHash(),
    status: "completed",
    generation: { temperature: 0, maxTokens: 8192 },
    judgePanel: ["j/a", "k/b"],
    results: [{ id: "q", correct: true }],
    selectedQuestionIds: ["q"],
    inputCap: 1000,
    usageComplete: false,
  };
  report.runPathFingerprint = await runPathFingerprint(report, { ids: ["q"], inputCap: 1000 });
  assert.equal((await validateBaselineCheckpoint(job, report)).kind, "completed");
  await assert.rejects(validateBaselineCheckpoint({ ...job, model: "other" }, report), /checkpoint/);
  await assert.rejects(validateBaselineCheckpoint({ ...job, maxOutputTokens: 4096 }, report), /checkpoint/);
  await assert.rejects(validateBaselineCheckpoint(job, { ...report, runPathFingerprint: "stale" }), /checkpoint/);
  const interrupted = { ...report, status: "failed", failure: { cause: { failureClass: "quota" } } };
  assert.equal((await validateBaselineCheckpoint(job, interrupted)).kind, "partial");
});

test("baseline_aggregation_uses_only_manifest_cells_and_completed_journal_attempts", async () => {
  const { baselineReportSources } = await import("./baseline.mjs");
  const manifest = { jobs: [{ id: "retained", retainedCompletion: { path: "old.json" } }, { id: "new" }, { id: "partial" }] };
  const journal = {
    attempts: [
      { jobId: "new", status: "completed", output: "new.json" },
      { jobId: "partial", status: "failed", output: "failed.json" },
      { jobId: "unrelated", status: "completed", output: "unrelated.json" },
    ],
  };
  assert.deepEqual(
    baselineReportSources(manifest, journal).map((s) => s.path),
    ["old.json", "new.json"],
  );
});

test("lever_rule_closes_task_below_threshold", () => {
  assert.equal(leverDecision(3, 100).needed, false);
  assert.equal(leverDecision(3, 100).share, 0.03);
  assert.equal(leverDecision(5, 100).needed, true, "exactly 5% opens the lever");
  assert.equal(leverDecision(0, 0).needed, false, "no failures opens nothing");
  const reports = [
    {
      suite: "beam-100k",
      provider: "hyper",
      model: "glm-5.3",
      config: "fabric-x-tools",
      results: [
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `a${i}`,
          ability: "x",
          cluster: "c1",
          correct: i < 17,
          stage: i < 17 ? "correct" : "candidate_gap",
        })),
        ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, ability: "y", cluster: "c2", correct: i < 20, stage: "correct" })),
      ],
    },
  ];
  const ranked = summarizeBaseline(reports).levers;
  const task5 = ranked.find((lever) => lever.task === 5);
  assert.equal(task5.status, "needed");
  assert.equal(task5.candidateFailures, 3);
  assert.equal(task5.bestShare, 3 / 3);
  assert.equal(ranked.find((lever) => lever.task === 6).status, "unmeasurable");
});

test("aggregate_keeps_one_authoritative_attempt_per_cell", () => {
  const row = (id, correct) => ({ id, ability: "single-session", cluster: id, correct, stage: correct ? "correct" : "answer_gap" });
  const cell = (status, rows) => ({
    report: { status, suite: "beam-100k", provider: "openrouter/nvidia", model: "nemotron:free", config: "full", results: rows },
    mtimeMs: 0,
  });
  const entries = [
    { ...cell("failed", []), mtimeMs: 300 },
    { ...cell("running", []), mtimeMs: 400 },
    {
      report: {
        status: "completed",
        suite: "beam-100k",
        provider: "openrouter/nvidia",
        model: "nemotron:free",
        config: "full",
        results: [row("q1", true)],
      },
      mtimeMs: 100,
    },
    {
      report: {
        status: "completed",
        suite: "beam-100k",
        provider: "openrouter/nvidia",
        model: "nemotron:free",
        config: "full",
        results: [row("q1", true), row("q2", false)],
      },
      mtimeMs: 200,
    },
  ];
  const reports = authoritativeReports(entries);
  assert.equal(reports.length, 1, "one cell, one report");
  assert.equal(reports[0].results.length, 2, "the widest completed attempt wins");
  const summary = summarizeBaseline(reports);
  assert.equal(summary.cells.length, 1);
  assert.equal(summary.cells[0].n, 2);
  assert.equal(summary.cells[0].stages.answer_gap, 1);
});

test("aggregate_ranks_a_failed_attempt_without_a_completed_one_nothing", () => {
  const entries = [{ report: { status: "failed", suite: "locomo", provider: "p", model: "m", config: "full", results: [] }, mtimeMs: 1 }];
  assert.equal(authoritativeReports(entries).length, 0);
  assert.equal(summarizeBaseline([]).status, "not-executed");
});

test("baseline_evidence_reports_cost_latency_and_ability_rows", async () => {
  const row = (id, ability, correct) => ({ id, ability, cluster: id, correct, stage: correct ? "correct" : "answer_gap" });
  const summary = summarizeBaseline([
    {
      status: "completed",
      suite: "locomo",
      provider: "opencode-go",
      model: "beam-free",
      config: "full-truncated",
      attemptId: "job@4",
      inputTokens: 1000,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      outputTokens: 50,
      cost: { measured: 0.5 },
      timing: { phases: { answer: { n: 2, wallMs: { p50: 1000, mean: 2000, p95: 3000 } } } },
      results: [row("q1", "single-session", true), row("q2", "temporal", false)],
    },
  ]);
  const [cell] = summary.cells;
  assert.equal(cell.costUsd, 0.5);
  assert.equal(cell.latencyMs, 1000);
  assert.equal(cell.latencyMeanMs, 2000);
  assert.equal(cell.latencyP95Ms, 3000);
  assert.equal(cell.cacheWriteTokens, 2);
  assert.deepEqual(
    cell.abilityRows.map((entry) => [entry.ability, entry.accuracy]),
    [
      ["single-session", 1],
      ["temporal", 0],
    ],
  );
});

test("a_4xx_input_refusal_is_not_retried_as_a_quota_failure", () => {
  const failed = (message) => ({ status: "failed", failure: { message } });
  assert.equal(permanentFailure(failed("MemoryBenchAnswerError:400 maximum context length is 200000 tokens")), "context-exceeds-model");
  assert.equal(
    permanentFailure(failed("MemoryBenchAnswerError:400 invalid_request_error: tools[0] unsupported")),
    "unsupported-by-provider",
  );
  assert.equal(permanentFailure(failed("MemoryBenchAnswerError:400 model_not_found")), "model-unavailable");
  assert.equal(permanentFailure(failed("MemoryBenchJudgeError:429 You've hit your hourly rate limit")), null, "quota stays retryable");
  assert.equal(permanentFailure(failed("MemoryBenchAnswerError:502 upstream")), null, "transient transport stays retryable");
  assert.equal(permanentFailure({ status: "completed" }), null);
  assert.equal(permanentFailure({ status: "token-ceiling" }), null);
});

test("baseline_excludes_unproven_full_history_and_marks_equivalent_repeats", () => {
  const report = (config, truncated, proven = true) => ({
    suite: "beam-100k",
    provider: "mock",
    model: "m",
    config,
    comparatorContext: { modelConfig: { provider: "mock", model: "m" } },
    results: [
      {
        id: "q",
        ability: "x",
        correct: true,
        truncated,
        ...(proven ? { contextEligibility: { eligible: true, completeHistory: !truncated, contextHash: "same" } } : {}),
      },
    ],
  });
  const product = report("fabric-x", false, false);
  for (const full of [report("full", true), report("full", false, false)]) {
    assert.equal(summarizeBaseline([product, full]).gaps.length, 0);
  }
  const rejected = report("full", true);
  rejected.results[0] = { id: "q", ability: "x", outcome: "comparator_ineligible", contextEligibility: { eligible: false } };
  const rejectedCell = summarizeBaseline([product, rejected]).cells.find((cell) => cell.arm === "full");
  assert.equal(rejectedCell.ineligibleQuestions, 1);
  assert.equal(rejectedCell.accuracy, null);
  const summary = summarizeBaseline([product, report("full", false), report("full-truncated", false)]);
  assert.equal(summary.cells.find((cell) => cell.arm === "full-truncated").repeatOf, "full");
  assert.equal(summary.gaps.length, 1, "equivalent comparator repeat is not an independent treatment");
});

test("baseline_p50_uses_percentile_not_mean", () => {
  const base = { suite: "locomo", provider: "p", model: "m", config: "full", results: [{ id: "q", ability: "a", correct: true }] };
  const [cell] = summarizeBaseline([{ ...base, timing: { phases: { answer: { n: 1, wallMs: { p50: 10, mean: 30, p95: 90 } } } } }]).cells;
  assert.equal(cell.latencyMs, 10);
  assert.equal(cell.latencyMeanMs, 30);
  assert.equal(cell.latencyP95Ms, 90);
  assert.equal(summarizeBaseline([{ ...base, timing: { questions: { wallMs: { mean: 30 } } } }]).cells[0].latencyMs, null);
});

test("baseline_registered_measurements_ignore_evaluation_cost_and_wall_time", () => {
  const report = (config, inputWarm, p95) => ({
    config,
    suite: "locomo",
    provider: "p",
    model: "m",
    usageComplete: true,
    cost: { measured: 999 },
    roleUsage: { product: { inputWarm }, evaluation: { measured: 999 } },
    timing: { questions: { wallMs: { p95: 999999 } }, phases: { answer: { n: 1, wallMs: { p50: p95, mean: p95, p95 } } } },
    results: [
      { id: "q", ability: "a", correct: true, phaseTiming: { answer: p95 }, contextEligibility: { eligible: true, completeHistory: true } },
    ],
  });
  const summary = summarizeBaseline([report("fabric-x", 1, 15), report("full", 2, 10)]);
  assert.equal(summary.productMeasurements[0].cost.ratio, 0.5);
  assert.equal(summary.productMeasurements[0].cost.met, true);
  assert.equal(summary.productMeasurements[0].latency.ratio, 1.5);
  assert.equal(summary.productMeasurements[0].latency.met, true);
});

const failureCell = (config, results) => ({ suite: "locomo", provider: "p", model: "m", config, results });
const failureRow = (id, stage = "candidate_gap", extra = {}) => ({ id, correct: false, stage, ...extra });

test("comparator_failure_cannot_open_product_lever", () => {
  const summary = summarizeBaseline([failureCell("full", [failureRow("q")]), failureCell("lexical-topk", [failureRow("q")])]);
  assert.ok(summary.levers.every((lever) => !lever.needed));
  assert.ok(summary.levers.every((lever) => lever.decisions.length === 0));
});

test("shared_product_failures_are_not_unique_recoveries", () => {
  const row = failureRow("q");
  const summary = summarizeBaseline([failureCell("fabric-x", [row, row]), failureCell("fabric-x-tools", [row])]);
  const lever = summary.levers.find((entry) => entry.task === 5);
  assert.equal(lever.candidateFailures, 1);
  assert.equal(lever.failureOccurrences, 2);
  assert.equal(lever.sharedFailures, 1);
  assert.ok(
    lever.decisions.every(
      (entry) => entry.total === 1 && entry.counts === 1 && entry.suite === "locomo" && entry.model === "p/m" && entry.arm,
    ),
  );
  assert.equal(summary.cells.find((cell) => cell.arm === "fabric-x").n, 1);
});

test("unknown_evidence_cannot_close_unmeasured_lever", () => {
  const summary = summarizeBaseline([
    failureCell("fabric-x-tools", [
      failureRow("q", "candidate_gap", { outcome: "run_limit" }),
      failureRow("u", "gold_unknown"),
      failureRow("t", "answer_gap", { outcome: "error" }),
    ]),
  ]);
  assert.equal(summary.cells[0].failures, 3);
  assert.equal(summary.cells[0].outcomes.judged_incorrect, 1);
  assert.equal(summary.cells[0].outcomes.run_limit, 1);
  assert.equal(summary.cells[0].outcomes.transport_setup_error, 1);
  assert.equal(summary.cells[0].attribution.unknown, 1);
  assert.equal(summary.cells[0].attribution.operational, 2);
  assert.equal(summary.cells[0].attribution.coverage, 0);
  assert.equal(summary.levers.find((entry) => entry.task === 5).status, "insufficient-evidence");
  assert.equal(summary.levers.find((entry) => entry.task === 6).status, "unmeasurable");
});

test("lever_denominator_keeps_operational_and_unknown_product_failures", () => {
  const rows = [
    failureRow("candidate"),
    ...Array.from({ length: 20 }, (_, i) => failureRow(`limit${i}`, "answer_gap", { outcome: "run_limit" })),
  ];
  const lever = summarizeBaseline([failureCell("fabric-x", rows)]).levers.find((entry) => entry.task === 5);
  assert.equal(lever.bestShare, 1 / 21);
  assert.equal(lever.needed, false);
  assert.equal(lever.status, "insufficient-evidence");
});

test("conflicting_duplicate_outcomes_remain_unknown", () => {
  const summary = summarizeBaseline([failureCell("fabric-x", [failureRow("q"), { id: "q", correct: true, stage: "correct" }])]);
  assert.equal(summary.cells[0].n, 1);
  assert.equal(summary.cells[0].attribution.unknown, 1);
  assert.equal(summary.levers.find((entry) => entry.task === 5).candidateFailures, 0);
});

test("absent_fine_evidence_does_not_close_a_fine_selection_lever", () => {
  const report = failureCell("fabric-x", [failureRow("q", "answer_gap")]);
  assert.equal(summarizeBaseline([report]).levers.find((entry) => entry.task === 13).status, "insufficient-evidence");
});

test("measured_stage_below_five_percent_can_close_its_lever", () => {
  const evidenceCounts = {
    goldRounds: 1,
    candidateGold: 1,
    selectedGold: 1,
    fineRounds: 0,
    fineSelected: 0,
    unknownSourceReferences: 0,
    labelSource: "source_chat_ids",
  };
  const rows = Array.from({ length: 21 }, (_, index) =>
    failureRow(`q${index}`, "answer_gap", {
      evidenceCounts: { ...evidenceCounts, candidateGold: index === 0 ? 0 : 1 },
    }),
  );
  const lever = summarizeBaseline([failureCell("fabric-x", rows)]).levers.find((entry) => entry.task === 5);
  assert.equal(lever.bestShare, 1 / 21);
  assert.equal(lever.status, "not needed");
  assert.equal(lever.decisions[0].attribution.provenance.source_chat_ids, 21);
});

test("saved_outcomes_override_inconsistent_scores", () => {
  const [cell] = summarizeBaseline([failureCell("fabric-x", [{ id: "q", correct: true, stage: "correct", outcome: "run_limit" }])]).cells;
  assert.equal(cell.failures, 1);
  assert.equal(cell.accuracy, 0);
  assert.equal(cell.stages.run_limit, 1);
  const [invalid] = summarizeBaseline([failureCell("full", [{ id: "q", correct: true, outcome: "comparator_ineligible" }])]).cells;
  assert.equal(invalid.accuracy, null);
  assert.equal(invalid.ineligibleQuestions, 1);
});

test("baseline_ability_rows_report_graded_mean_next_to_binary_accuracy", () => {
  const row = (id, graded) => ({
    id,
    ability: "summarization",
    cluster: id,
    correct: false,
    stage: "answer_gap",
    ...(graded === undefined ? {} : { graded }),
  });
  const report = {
    suite: "beam-100k",
    provider: "p",
    model: "m",
    config: "lexical-topk",
    results: [row("a", 0.5), row("b", 1), row("c")],
  };
  const [ability] = summarizeBaseline([report]).cells[0].abilityRows;
  assert.equal(ability.accuracy, 0, "binary stays computed unchanged");
  assert.equal(ability.gradedN, 2);
  assert.equal(ability.gradedMean, 0.75, "mean over scored rows only");
  assert.equal(ability.primaryMetric, "graded");
  assert.equal(ability.screeningStatus, "not lever-discriminating at this sample");
  assert.equal(summarizeBaseline([{ ...report, config: "fabric-x-tools" }]).levers[0].screeningLimits[0].ability, "summarization");
  const [plain] = summarizeBaseline([{ ...report, results: [row("a")] }]).cells[0].abilityRows;
  assert.equal(plain.gradedMean, undefined, "abilities without a graded score carry no graded fields");
});

test("commandcode_judges_are_paid_without_allowing_paid_free_answer_replacements", async () => {
  const manifest = await buildBaselineManifest({
    gate: { text: "Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)" },
  });
  assert.deepEqual(BASELINE_JUDGES, ["commandcode/minimax/minimax-m3.1-flash", "commandcode/z-ai/glm-5.3-flash"]);
  for (const job of manifest.jobs) {
    assert.equal(job.freeOnly, false);
    assert.equal(job.boundedWire, true);
    assert.equal(job.freeProductOnly, job.provider === "openrouter");
  }
});

test("muse13_screen_has_25_cells_and_cannot_claim_the_full_multimodel_baseline", async () => {
  const { baselineCoverage } = await import("./baseline.mjs");
  const manifest = await buildBaselineManifest({ gate: { text: "Let's do the 25 cell pass with Muse 1.3. Stop the current run" } });
  assert.equal(manifest.scope, "single-model-development-screen");
  assert.equal(manifest.jobs.length, 25);
  assert.equal(manifest.models.length, 1);
  assert.ok(manifest.jobs.every((j) => `${j.provider}/${j.model}` === "commandcode/meta/muse-spark-1.3-contributor"));
  assert.equal(manifest.suites.length, 5);
  assert.equal(manifest.arms.length, 5);
  assert.equal(baselineCoverage(manifest, 24).screenComplete, false);
  assert.equal(baselineCoverage(manifest, 25).screenComplete, true);
  assert.equal(baselineCoverage(manifest, 25).baselineComplete, false);
  assert.equal(baselineCoverage({ jobs: Array(75) }, 75).baselineComplete, true);
});
