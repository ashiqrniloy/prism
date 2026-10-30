#!/usr/bin/env bun
/**
 * Plan 202 Task 4: the development baseline manifest, its budget, and the pre-registered lever
 * decision. The manifest is the paid gate: it pins the criteria and product hashes, sizes every
 * attempt by in-flight reservation, and refuses to execute until the owner confirms the estimate.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HARNESS_PATHS, PREFIX_PRODUCT_PATHS, sourceFingerprint } from "./acceptance.mjs";
import { loadJournal, manifestFingerprint, stableHash } from "./journal.mjs";
import { pairedAnalysisProtocol } from "./paired-sizing.mjs";
import rates from "./rates.json" with { type: "json" };
import { stageFromCounts } from "./replay.mjs";
import { ROBUSTNESS_CRITERIA, robustnessCriteriaHash, robustnessDraw } from "./robustness.mjs";
import { runPathFingerprint } from "./run.mjs";
import { clusterBootstrap, holm, PAIRED_ANALYSIS_VERSION, pairedAnalysis } from "./stats.mjs";
import { cacheAdjustedCost, productMeasurementVerdict, resolveRate } from "./usage.mjs";

export const BASELINE_EVIDENCE = "docs/_evidence/memory-bench/202/baseline";
export const BASELINE_LOGS = ".cache/memory-bench/202/muse13-screen";
export const BASELINE_JOURNAL = ".cache/memory-bench/202-muse13-screen/journal.json";
export const BASELINE_SUMMARY = ".cache/memory-bench/202-muse13-screen/summary.json";
export const MUSE_MODEL = "commandcode/meta/muse-spark-1.3-contributor";
export const BASELINE_SUITES = ["beam-100k", "locomo", "memoryagentbench-cr", "longmemeval-m", "beam-1m"];
/** The product shapes being compared on every development partition. */
export const BASELINE_ARMS = [
  { id: "preset-r1", config: "fabric-x-tools" },
  { id: "passive-only", config: "fabric-x" },
  { id: "full", config: "full" },
  { id: "full-truncated", config: "full-truncated" },
  { id: "lexical-topk", config: "lexical-topk" },
];
export const BASELINE_MODELS = [{ provider: "commandcode", model: "meta/muse-spark-1.3-contributor" }];
/** Owner-selected MiniMax and GLM judges; neither answers an arm. */
export const BASELINE_JUDGES = ["commandcode/minimax/minimax-m3.1-flash", "commandcode/z-ai/glm-5.3-flash"];
export const BASELINE_BILLING = {
  mode: "paid",
  providers: ["commandcode"],
  paidModels: [...BASELINE_MODELS.map((m) => `${m.provider}/${m.model}`), ...BASELINE_JUDGES],
  answerAuthorization: "Let's do the 25 cell pass with Muse 1.3. Stop the current run",
  judgeAuthorization: [
    "Use Minimax m3.1 flash as the judge from command code. Try the free route first. If that is not available, go with the paid route",
    "Use GLM 5.3 flash from command code as the other judge",
  ],
  authorization: "go forward with this model. And then continue with the task 4 WIP",
};
export const LEVER_THRESHOLD = 0.05;
/** Stages the answer-phase attribution actually emits today; anything else is unmeasurable. */
export const EMITTED_STAGES = new Set([
  "correct",
  "gold_unknown",
  "candidate_gap",
  "selection_gap",
  "fine_selection_gap",
  "partial_evidence",
  "answer_gap",
  "abstention_error",
  "unknown_gap",
]);

// Per-question usage of the same arms on held-out v3 (188.10 reports, one model). They are planning
// inputs, not results: Task 4 replaces each with the measured value in its own report.
const USAGE_PER_QUESTION = {
  full: { inputTokens: 112_955, cacheReadTokens: 3, outputTokens: 315 },
  "full-truncated": { inputTokens: 112_955, cacheReadTokens: 3, outputTokens: 315 },
  "preset-r1": { inputTokens: 29_668, cacheReadTokens: 9_655, outputTokens: 1_882 },
  "passive-only": { inputTokens: 6_378, cacheReadTokens: 81, outputTokens: 848 },
  "lexical-topk": { inputTokens: 4_000, cacheReadTokens: 0, outputTokens: 315 },
};
const JUDGE_TOKENS = { inputTokens: 4_000, outputTokens: 100 };
const CAPS = {
  full: 16_000_000,
  "full-truncated": 10_000_000,
  "preset-r1": 10_000_000,
  "passive-only": 10_000_000,
  "lexical-topk": 6_000_000,
};
/** In-flight admission holds 250k per live judge call; reserve headroom, not the point estimate. */
const REQUEST_HEADROOM_TOKENS = 5_000_000;
/** Per-job wall-time cap; LongMemEval-M's ~500-session write dominates and is measured, not priced. */
const WALL_TIME_CAP_HOURS = { "beam-100k": 6, locomo: 4, "memoryagentbench-cr": 6, "longmemeval-m": 144, "beam-1m": 48 };

/** Every lever a stage can decide; a stage the baseline does not emit is recorded as unmeasurable. */
export const LEVERS = [
  { task: 5, stages: ["candidate_gap"] },
  { task: 6, stages: ["temporal_gap"] },
  { task: 7, stages: ["supersession_gap"] },
  { task: 8, stages: ["partial_evidence"] },
  { task: 9, stages: ["answer_gap", "abstention_error"] },
  { task: 10, stages: ["tool_protocol_gap"] },
  { task: 13, stages: ["fine_selection_gap"] },
  { task: 16, stages: ["capacity_gap"] },
  { task: 17, stages: ["extraction_gap"] },
];

function devQuestions(suite) {
  const draw = robustnessDraw(suite);
  return Object.values(draw.abilities.dev ?? {}).reduce((sum, ids) => sum + ids.length, 0);
}

function perQuestionCost(arm, modelRef) {
  const rate = resolveRate(rates, modelRef);
  const usage = USAGE_PER_QUESTION[arm.id];
  const judgeRates = BASELINE_JUDGES.map((ref) => resolveRate(rates, ref));
  const measured = cacheAdjustedCost(usage, rate);
  const judge = judgeRates.reduce((sum, rate) => sum + cacheAdjustedCost(JUDGE_TOKENS, rate), 0);
  return { rate, measured, judge, warm: cacheAdjustedCost({ ...usage, cacheReadTokens: usage.inputTokens }, rate) };
}

/**
 * A gate manifest: no paid call happens here. `maxInputTokens` is the attempt reservation, sized
 * from the estimate plus the one-request bound and the arm overshoot that journal.mjs checks between
 * questions, never from a per-run total that a retry could exceed.
 */
export async function buildBaselineManifest({ gate, approvedAt = "2026-10-27", root = ".", billing = BASELINE_BILLING } = {}) {
  if (!gate?.text) throw new Error("BaselineGate: owner gate text is required verbatim");
  const productHash = await sourceFingerprint(PREFIX_PRODUCT_PATHS, root);
  const harnessHash = await sourceFingerprint(HARNESS_PATHS, root);
  const jobs = [];
  let totalUsd = 0;
  let totalTokens = 0;
  for (const suite of BASELINE_SUITES) {
    const questions = devQuestions(suite);
    for (const model of BASELINE_MODELS) {
      const ref = `${model.provider}/${model.model}`;
      for (const arm of BASELINE_ARMS) {
        const usage = USAGE_PER_QUESTION[arm.id];
        const cost = perQuestionCost(arm, ref);
        const inputTokens = questions * (usage.inputTokens + BASELINE_JUDGES.length * JUDGE_TOKENS.inputTokens);
        const outputTokens = questions * (usage.outputTokens + BASELINE_JUDGES.length * JUDGE_TOKENS.outputTokens);
        const usd = questions * ((cost.measured ?? 0) + (cost.judge ?? 0));
        if (cost.measured === null) throw new Error(`BaselineBudget: no priced rate for ${ref}`);
        totalUsd += usd;
        totalTokens += inputTokens + outputTokens;
        jobs.push({
          id: `202-baseline.${suite}.${arm.id}.${model.provider}.${model.model}`,
          suite,
          subset: "dev",
          ability: null,
          arm: arm.id,
          config: arm.config,
          provider: model.provider,
          model: model.model,
          judges: BASELINE_JUDGES.join(","),
          judgeText: true,
          questions,
          wallTimeCapHours: WALL_TIME_CAP_HOURS[suite],
          maxInputTokens: Math.min(CAPS[arm.id], Math.ceil((inputTokens + REQUEST_HEADROOM_TOKENS) / 500_000) * 500_000),
          // Serial free-route execution keeps quota and in-flight reservations bounded.
          concurrency: 1,
          freeOnly: false,
          freeProductOnly: !BASELINE_BILLING.paidModels.includes(ref),
          boundedWire: true,
          maxOutputTokens: 8192,
          labelInjections: "off",
          estimate: { inputTokens, outputTokens, usd },
        });
      }
    }
  }
  const manifest = {
    schemaVersion: 1,
    kind: "202-baseline",
    scope: "single-model-development-screen",
    scopeAuthorization: "Let's do the 25 cell pass with Muse 1.3. Stop the current run",
    deferredScope:
      "Original multi-model baseline deferred; completing this 25-cell screen does not complete broad Task 4 or support cross-model claims",
    plan: 202,
    task: 4,
    generatedAt: new Date().toISOString(),
    status: "gate-recorded",
    ownerGate: { gate: 1, approved: true, approvedAt, approvedBy: "owner", text: gate.text },
    billing,
    criteriaHash: robustnessCriteriaHash(),
    productHash,
    harnessHash,
    analysis: await pairedAnalysisProtocol(root),
    suites: BASELINE_SUITES,
    arms: BASELINE_ARMS,
    models: BASELINE_MODELS,
    judges: BASELINE_JUDGES,
    judgeProtocol: "plain-text-v1",
    repeats: 1,
    ceiling: 2_000_000_000,
    thresholds: { lever: LEVER_THRESHOLD },
    assumptions: {
      source: "188.10 held-out v3 per-question usage, one model; Task 4 replaces it with measured usage",
      usagePerQuestion: USAGE_PER_QUESTION,
      judgeTokens: JUDGE_TOKENS,
      writeWallTime:
        "Task 1: 90 ms per local note and ~500 sessions per LongMemEval-M question; write wall time is reported, never estimated as zero",
    },
    compute: {
      mode: billing.mode,
      provider: billing.provider,
      usdEquivalent: Math.ceil(totalUsd * 100) / 100,
      tokens: totalTokens,
      ratesAsOf: rates.asOf,
      ratesStatus: rates.status,
      // Beyond-window full-context arms dominate, exactly as the Task 4 criterion expects.
      dominant: "full and full-truncated on longmemeval-m and beam-1m",
      wallTimeCapHoursBySuite: WALL_TIME_CAP_HOURS,
      note: "Owner-selected Muse 1.3 Contributor answerer and MiniMax/GLM judges only; 25-cell development screen, no fallback or cross-model claim. Token totals size quotas and reservations; wall time is measured, never assumed zero.",
    },
    jobs,
  };
  manifest.manifestHash = stableHash({
    criteria: manifest.criteriaHash,
    product: productHash,
    analysis: manifest.analysis,
    jobs: manifest.jobs.map((job) => [job.id, job.maxInputTokens]),
  });
  return manifest;
}

/** Reuse is per cell: orchestration changes cannot silently change its answer/scoring protocol. */
export async function validateBaselineCheckpoint(job, report) {
  const refuse = () => {
    throw new Error("Baseline checkpoint does not match the selected cell");
  };
  if (job.subset !== "dev" || report.criteriaHash !== robustnessCriteriaHash()) refuse();
  for (const key of ["suite", "subset", "config", "provider", "model", "freeOnly"])
    if ((report[key] ?? false) !== (job[key] ?? false)) refuse();
  if (Boolean(report.boundedWire) !== Boolean(job.boundedWire) || Boolean(report.freeProductOnly) !== Boolean(job.freeProductOnly))
    refuse();
  if (job.inputCap != null && job.inputCap !== report.inputCap) refuse();
  if (
    report.generation?.temperature !== 0 ||
    report.generation?.maxTokens !== job.maxOutputTokens ||
    report.judgePanel?.join(",") !== job.judges
  )
    refuse();
  if (job.judgeText && report.judgeProtocol !== "plain-text-v1") refuse();
  const ids = report.selectedQuestionIds ?? [];
  if (
    ids.length !== job.questions ||
    new Set(ids).size !== ids.length ||
    new Set((report.results ?? []).map((row) => row.id)).size !== (report.results ?? []).length ||
    (report.results ?? []).some((row) => !ids.includes(row.id))
  )
    refuse();
  if ((await runPathFingerprint(report, { ids, inputCap: report.inputCap })) !== report.runPathFingerprint) refuse();
  if (report.status === "completed" && report.results.length === job.questions)
    return { kind: "completed", fingerprint: report.runPathFingerprint };
  if (report.failure?.cause?.failureClass === "quota") return { kind: "partial", fingerprint: report.runPathFingerprint };
  refuse();
}

/** Completing a one-model screen cannot imply completion of the deferred multi-model baseline. */
export function baselineCoverage(manifest, completedCells) {
  const complete = completedCells === manifest.jobs.length;
  const screen = manifest.scope === "single-model-development-screen";
  return {
    coverage: { completedCells, requiredCells: manifest.jobs.length },
    screenComplete: screen && complete,
    baselineComplete: !screen && complete,
  };
}

/** A directory can contain historical campaigns; only this manifest's journal is authoritative. */
export function baselineReportSources(manifest, journal) {
  return manifest.jobs.flatMap((job) => {
    const latest = journal?.attempts.filter((a) => a.jobId === job.id).at(-1);
    const path = latest?.status === "completed" ? latest.output : job.retainedCompletion?.path;
    return path ? [{ job, path }] : [];
  });
}

export async function loadBaselineReports(manifest) {
  const journal = manifest.journalPath && existsSync(manifest.journalPath) ? await loadJournal(manifest.journalPath) : null;
  if (journal && journal.manifestHash !== manifestFingerprint(manifest)) throw new Error("Baseline aggregate journal identity changed");
  const reports = [];
  for (const { job, path } of baselineReportSources(manifest, journal)) {
    const bytes = await readFile(path);
    if (job.retainedCompletion?.path === path && createHash("sha256").update(bytes).digest("hex") !== job.retainedCompletion.sha256)
      throw new Error("Baseline retained report bytes changed");
    const report = JSON.parse(bytes);
    await validateBaselineCheckpoint(job, report);
    if (report.criteriaHash !== manifest.criteriaHash) throw new Error("Baseline report criteria changed");
    reports.push(report);
  }
  return { reports, journal };
}

/** The pre-registered rule: a lever runs only when its stage carries >= 5% of failures in a cell. */
export function leverDecision(counts, total, threshold = LEVER_THRESHOLD) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("LeverRule: nonnegative failure count required");
  if (!Number.isSafeInteger(counts) || counts < 0) throw new Error("LeverRule: nonnegative stage count required");
  const share = total === 0 ? 0 : counts / total;
  return { counts, total, share, needed: total > 0 && share >= threshold };
}

/** Outcomes outrank historical diagnoses; old stage-only rows remain explicitly heuristic. */
export function failureAttribution(row) {
  const stage = stageFromCounts({ ...(row.evidenceCounts ?? {}), correct: row.correct, outcome: row.outcome, ability: row.ability });
  const outcomeStage = ["run_limit", "transport_setup_error", "comparator_ineligible"].includes(stage);
  const inferred = outcomeStage || row.evidenceCounts || row.correct === true ? stage : (row.stage ?? "unknown_gap");
  const known = ["candidate_gap", "selection_gap", "fine_selection_gap", "partial_evidence", "answer_gap", "abstention_error"].includes(
    inferred,
  );
  return {
    stage: inferred,
    known,
    operational: ["run_limit", "transport_setup_error", "store_error"].includes(inferred),
    provenance: outcomeStage ? "outcome" : (row.evidenceCounts?.labelSource ?? "historical_heuristic"),
  };
}

/** Group scored rows by suite x model x arm, then attribute every failure to its stage. */
export function baselineCells(reports) {
  const cells = new Map();
  for (const report of reports) {
    if (report.config === "oracle" || report.diagnosticOnly) continue;
    for (const savedRow of report.results ?? []) {
      const row = ["run_limit", "error"].includes(savedRow.outcome)
        ? { ...savedRow, correct: false }
        : savedRow.outcome === "comparator_ineligible"
          ? { ...savedRow, correct: undefined }
          : savedRow;
      const key = `${report.suite}|${report.provider}/${report.model}|${report.config}`;
      const cell = cells.get(key) ?? {
        suite: report.suite,
        model: `${report.provider}/${report.model}`,
        arm: report.config,
        rows: [],
        seenIds: new Set(),
        ineligibleQuestions: 0,
        unscoredQuestions: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costUsd: null,
        productCostUsd: null,
        productColdCostUsd: null,
        productWarmCostUsd: null,
        evaluationCostUsd: null,
        latencyMeanMs: null,
        ingestion: null,
        evaluation: null,
        latencyMs: null,
        latencyP95Ms: null,
        attemptId: report.attemptId ?? null,
      };
      // Repeated ids do not create extra failures or extra denominator weight.
      if (cell.seenIds.has(row.id)) {
        const index = cell.rows.findIndex((existing) => existing.id === row.id);
        const previous = cell.rows[index];
        if (previous && (previous.correct !== row.correct || failureAttribution(previous).stage !== failureAttribution(row).stage))
          cell.rows[index] = { id: row.id, ability: row.ability, correct: false, stage: "unknown_gap" };
        continue;
      }
      cell.seenIds.add(row.id);
      if (row.correct === undefined) cell.unscoredQuestions++;
      else cell.rows.push(row);
      if (row.outcome === "comparator_ineligible" || row.contextEligibility?.eligible === false) cell.ineligibleQuestions++;
      cells.set(key, cell);
    }
    // One report is one cell (repeats share the id space); usage belongs to the cell, not the row.
    const key = `${report.suite}|${report.provider}/${report.model}|${report.config}`;
    const cell = cells.get(key);
    if (cell) {
      cell.inputTokens += report.inputTokens ?? 0;
      cell.cacheReadTokens += report.cacheReadTokens ?? 0;
      cell.cacheWriteTokens += report.cacheWriteTokens ?? 0;
      cell.outputTokens += report.outputTokens ?? 0;
      cell.costUsd = report.cost?.measured ?? null;
      cell.productCostUsd = report.roleUsage?.product?.measured ?? null;
      cell.productColdCostUsd = report.roleUsage?.product?.cold ?? null;
      cell.productWarmCostUsd = report.roleUsage?.product?.warm ?? null;
      cell.evaluationCostUsd = report.roleUsage?.evaluation?.measured ?? null;
      cell.latencyMs = report.timing?.phases?.answer?.wallMs?.p50 ?? null;
      cell.latencyMeanMs = report.timing?.phases?.answer?.wallMs?.mean ?? null;
      cell.latencyP95Ms = report.timing?.phases?.answer?.wallMs?.p95 ?? null;
      cell.ingestion = report.timing?.phases?.ingestion ?? null;
      cell.evaluation = report.timing?.phases?.evaluation ?? null;
    }
  }
  const contextGroups = new Map();
  for (const report of reports) {
    if (!["full", "full-truncated"].includes(report.config)) continue;
    if (
      !report.results?.length ||
      report.results.some((row) => !row.contextEligibility?.contextHash || row.contextEligibility.eligible === false)
    )
      continue;
    const key = stableHash({
      suite: report.suite,
      provider: report.provider,
      model: report.model,
      modelConfig: report.comparatorContext?.modelConfig ?? null,
      contexts: report.results.map((row) => [row.id, row.contextEligibility.contextHash]).sort(([a], [b]) => a.localeCompare(b)),
    });
    const group = contextGroups.get(key) ?? { arms: [], cellKey: `${report.suite}|${report.provider}/${report.model}|full-truncated` };
    group.arms.push(report.config);
    contextGroups.set(key, group);
  }
  const equivalent = new Map();
  for (const group of contextGroups.values()) {
    if (group.arms.includes("full") && group.arms.includes("full-truncated")) equivalent.set(group.cellKey, "full");
  }
  return [...cells.values()].map((cell) => {
    const outcomes = {
      judged_correct: 0,
      judged_incorrect: 0,
      run_limit: 0,
      transport_setup_error: 0,
      comparator_ineligible: cell.ineligibleQuestions,
    };
    for (const row of cell.rows) {
      const stage = failureAttribution(row).stage;
      const outcome = ["run_limit", "transport_setup_error", "comparator_ineligible"].includes(stage)
        ? stage
        : row.correct === true
          ? "judged_correct"
          : "judged_incorrect";
      // Ineligible questions are already counted, including unscored comparator rows.
      if (outcome !== "comparator_ineligible") outcomes[outcome]++;
    }
    const failures = cell.rows.filter((row) => row.correct !== true);
    const stages = {};
    const failureIdsByStage = {};
    const measuredStages = new Set();
    const attribution = { attributed: 0, unknown: 0, operational: 0, invalidComparator: 0, provenance: {} };
    for (const row of failures) {
      const evidence = failureAttribution(row);
      const counts = row.evidenceCounts;
      if (!evidence.operational && counts?.unknownSourceReferences === 0) {
        if (counts.goldRounds > 0 && [counts.candidateGold, counts.selectedGold].every(Number.isSafeInteger))
          for (const stage of ["candidate_gap", "selection_gap", "answer_gap"]) measuredStages.add(stage);
        if (counts.fineRounds > 0 && Number.isSafeInteger(counts.fineSelected))
          for (const stage of ["fine_selection_gap", "partial_evidence"]) measuredStages.add(stage);
        if (row.ability === "abstention") measuredStages.add("abstention_error");
      }
      stages[evidence.stage] = (stages[evidence.stage] ?? 0) + 1;
      (failureIdsByStage[evidence.stage] ??= []).push(row.id);
      attribution.attributed += Number(evidence.known);
      attribution.operational += Number(evidence.operational);
      attribution.invalidComparator += Number(evidence.stage === "comparator_ineligible");
      attribution.unknown += Number(!evidence.known && !evidence.operational && evidence.stage !== "comparator_ineligible");
      attribution.provenance[evidence.provenance] = (attribution.provenance[evidence.provenance] ?? 0) + 1;
    }
    attribution.coverage = failures.length ? attribution.attributed / failures.length : null;
    const failuresByAbility = {};
    const byAbility = {};
    for (const row of cell.rows) {
      const ability = row.ability ?? "overall";
      const bucket = (byAbility[ability] ??= { n: 0, correct: 0, gradedN: 0, gradedSum: 0 });
      bucket.n++;
      bucket.correct += Number(row.correct === true);
      if (typeof row.graded === "number") {
        bucket.gradedN++;
        bucket.gradedSum += row.graded;
      }
      if (row.correct !== true) failuresByAbility[ability] = (failuresByAbility[ability] ?? 0) + 1;
    }
    for (const bucket of Object.values(byAbility)) {
      bucket.accuracy = bucket.n ? bucket.correct / bucket.n : null;
      bucket.gradedMean = bucket.gradedN ? bucket.gradedSum / bucket.gradedN : null;
      delete bucket.gradedSum;
    }
    const abilityRows = Object.entries(byAbility)
      .map(([ability, bucket]) => ({
        ability,
        n: bucket.n,
        correct: bucket.correct,
        accuracy: bucket.accuracy,
        ...(bucket.gradedN ? { gradedN: bucket.gradedN, gradedMean: bucket.gradedMean } : {}),
        ...(cell.suite.startsWith("beam-") && ["summarization", "event_ordering"].includes(ability)
          ? {
              primaryMetric: "graded",
              screeningStatus:
                new Set(cell.rows.filter((row) => row.ability === ability).map((row) => row.cluster)).size < 6
                  ? "not lever-discriminating at this sample"
                  : "requires prospective sizing",
            }
          : {}),
      }))
      .sort((a, b) => a.ability.localeCompare(b.ability));
    return {
      ...cell,
      rows: undefined,
      seenIds: undefined,
      ...(cell.arm === "full"
        ? {
            completeHistoryEligible: cell.rows.filter(
              (row) =>
                row.truncated !== true && row.contextEligibility?.completeHistory === true && row.contextEligibility?.eligible === true,
            ).length,
          }
        : {}),
      repeatOf: equivalent.get(`${cell.suite}|${cell.model}|${cell.arm}`) ?? null,
      staged: cell.rows.every((row) => typeof row.stage === "string"),
      n: cell.rows.length,
      correct: cell.rows.filter((row) => row.correct === true).length,
      accuracy: cell.rows.length ? cell.rows.filter((row) => row.correct === true).length / cell.rows.length : null,
      ci95: cell.rows.some((row) => row.cluster) ? clusterBootstrap(cell.rows).ci95 : null,
      stages,
      outcomes,
      failureIdsByStage,
      measuredStages: [...measuredStages],
      attribution,
      failuresByAbility,
      byAbility,
      abilityRows,
      failures: failures.length,
    };
  });
}

/** The unchanged 5% rule applies within each eligible product suite x model x arm cell. */
export function rankLevers(reports, threshold = LEVER_THRESHOLD) {
  const productReports = reports.filter((report) => !report.diagnosticOnly && ["fabric-x-tools", "fabric-x"].includes(report.config));
  const cells = baselineCells(productReports);
  return LEVERS.map((lever) => {
    const decisions = cells.map((cell) => ({
      suite: cell.suite,
      model: cell.model,
      arm: cell.arm,
      ...leverDecision(
        lever.stages.reduce((sum, stage) => sum + (cell.stages[stage] ?? 0), 0),
        cell.failures,
        threshold,
      ),
      attribution: cell.attribution,
      measured: lever.stages.every((stage) => cell.measuredStages.includes(stage)),
    }));
    const occurrences = new Map();
    for (const cell of cells) {
      for (const id of lever.stages.flatMap((stage) => cell.failureIdsByStage[stage] ?? [])) {
        const key = JSON.stringify([cell.suite, cell.model, id]);
        const arms = occurrences.get(key) ?? new Set();
        arms.add(cell.arm);
        occurrences.set(key, arms);
      }
    }
    const best = decisions.reduce((a, b) => (b.share > a.share ? b : a), { share: 0 });
    const measurable = lever.stages.every((stage) => EMITTED_STAGES.has(stage));
    const needed = measurable && decisions.some((decision) => decision.needed);
    const complete =
      decisions.length > 0 && decisions.every((decision) => decision.total > 0 && decision.attribution.coverage === 1 && decision.measured);
    return {
      task: lever.task,
      stages: lever.stages,
      candidateFailures: occurrences.size,
      failureOccurrences: [...occurrences.values()].reduce((sum, arms) => sum + arms.size, 0),
      sharedFailures: [...occurrences.values()].filter((arms) => arms.size > 1).length,
      bestShare: best.share,
      bestCell: best.arm ? { suite: best.suite, model: best.model, arm: best.arm } : null,
      decisions,
      screeningLimits: cells.flatMap((cell) =>
        cell.abilityRows
          .filter((row) => row.screeningStatus)
          .map((row) => ({
            suite: cell.suite,
            model: cell.model,
            arm: cell.arm,
            ability: row.ability,
            status: row.screeningStatus,
          })),
      ),
      status: !measurable ? "unmeasurable" : needed ? "needed" : complete ? "not needed" : "insufficient-evidence",
      needed,
    };
  }).sort((a, b) => b.candidateFailures - a.candidateFailures || a.task - b.task);
}

/** Paired differences are descriptive screens; incomplete pairings never produce a gap. */
export function comparatorGaps(cells, reports) {
  const byCell = new Map();
  for (const cell of cells) {
    const key = `${cell.suite}|${cell.model}`;
    const group = byCell.get(key) ?? new Map();
    if (
      cell.repeatOf ||
      (cell.arm === "full" && (cell.completeHistoryEligible !== cell.n || cell.unscoredQuestions > 0 || cell.ineligibleQuestions > 0))
    )
      continue;
    group.set(cell.arm, cell);
    byCell.set(key, group);
  }
  const gaps = [];
  for (const [key, group] of byCell) {
    const [suite, model] = key.split("|");
    // Cells carry the report's config name; the job id carries the arm label.
    for (const arm of ["fabric-x-tools", "fabric-x"]) {
      for (const comparator of ["full", "full-truncated", "lexical-topk"]) {
        const a = group.get(arm);
        const b = group.get(comparator);
        if (typeof a?.accuracy !== "number" || typeof b?.accuracy !== "number") continue;
        const entry = { suite, model, arm, comparator, armAccuracy: a.accuracy, comparatorAccuracy: b.accuracy };
        const source = (config) =>
          reports.filter((report) => report.suite === suite && `${report.provider}/${report.model}` === model && report.config === config);
        try {
          const [left] = source(comparator),
            [right] = source(arm);
          if (source(comparator).length !== 1 || source(arm).length !== 1)
            throw new Error("Comparison requires one authoritative report per arm");
          for (const field of [
            "analysisVersion",
            "dataset",
            "normalization",
            "judge",
            "judgePanel",
            "judgeProtocol",
            "judgeTemplateVersion",
            "gradedTemplateVersion",
            "measurementVersion",
            "subset",
          ]) {
            if (stableHash(left[field] ?? null) !== stableHash(right[field] ?? null))
              throw new Error(`Comparison refuses mismatched ${field}`);
          }
          const scored = (rows) =>
            rows.map((row) => {
              if (row.outcome === "comparator_ineligible" || row.contextEligibility?.eligible === false)
                throw new Error("Comparison contains ineligible questions");
              if (["run_limit", "error"].includes(row.outcome)) return { ...row, correct: false, graded: 0 };
              if (typeof row.correct !== "boolean") throw new Error("Comparison requires scored questions");
              return row;
            });
          const l = scored(left.results),
            r = scored(right.results);
          const paired = pairedAnalysis(l, r);
          const abilities = {};
          for (const ability of new Set(l.map((row) => row.ability))) {
            const la = l.filter((row) => row.ability === ability),
              ra = r.filter((row) => row.ability === ability);
            abilities[ability] = { binary: pairedAnalysis(la, ra) };
            if (suite.startsWith("beam-") && ["summarization", "event_ordering"].includes(ability)) {
              if ([...la, ...ra].every((row) => Number.isFinite(row.graded)))
                abilities[ability].graded = pairedAnalysis(la, ra, { metric: (row) => row.graded });
              else abilities[ability].graded = { status: "incomplete", reason: "registered primary graded scores missing" };
            }
          }
          gaps.push({
            ...entry,
            ...paired,
            gap: paired.diff,
            abilities,
            status: "paired-descriptive",
            analysisVersion: left.analysisVersion ?? "historical-unpinned",
          });
        } catch (error) {
          gaps.push({ ...entry, status: "incomplete", reason: error.message, gap: null });
        }
      }
    }
  }
  const family = gaps.flatMap((gap) =>
    gap.status === "paired-descriptive"
      ? [gap, ...Object.values(gap.abilities).flatMap((ability) => Object.values(ability).filter((metric) => Number.isFinite(metric.p)))]
      : [],
  );
  holm(family.map((row) => row.p)).forEach((p, i) => {
    family[i].pHolm = p;
  });
  return gaps;
}

export function summarizeBaseline(reports) {
  reports = reports.filter((report) => report.config !== "oracle" && !report.diagnosticOnly);
  const cells = baselineCells(reports);
  const sorted = cells.sort((a, b) => a.suite.localeCompare(b.suite) || a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm));
  return {
    schemaVersion: 1,
    kind: "202-baseline-summary",
    status: reports.length ? "executed" : "not-executed",
    criteriaHash: robustnessCriteriaHash(),
    analysisVersion: PAIRED_ANALYSIS_VERSION,
    inference:
      "descriptive only; item-weighted paired differences, whole-conversation bootstrap 95% CIs; marginal CI overlap is not a test",
    multiplicity:
      "Holm across every emitted overall, ability-binary and ability-graded test in this summary; CIs are pointwise, no acceptance verdict",
    reports: reports.length,
    cells: sorted,
    gaps: comparatorGaps(sorted, reports),
    productMeasurements: reports
      .filter((report) => ["fabric-x-tools", "fabric-x"].includes(report.config))
      .flatMap((candidate) =>
        reports
          .filter(
            (report) =>
              report.suite === candidate.suite &&
              report.provider === candidate.provider &&
              report.model === candidate.model &&
              report.config === "full",
          )
          .map((comparator) => ({
            suite: candidate.suite,
            model: `${candidate.provider}/${candidate.model}`,
            arm: candidate.config,
            comparator: comparator.config,
            ...productMeasurementVerdict(candidate, comparator, {
              costRatio: ROBUSTNESS_CRITERIA.bfc.cost.ratio,
              latencyRatio: ROBUSTNESS_CRITERIA.bfc.latency.p95PerTurnAddedLatencyRatio,
            }),
          })),
      ),
    levers: rankLevers(reports),
  };
}

/**
 * One cell is one suite x model x arm, so several attempts (a quota failure, then a re-run) must
 * collapse to the attempt that actually measured the arm. A completed report wins; among completed
 * reports the widest id set wins, then the newest file. Failed and in-flight reports never score.
 */
export function authoritativeReports(entries) {
  const byCell = new Map();
  for (const entry of entries) {
    if (entry.report?.status !== "completed") continue;
    const report = entry.report;
    const key = `${report.suite}|${report.provider}/${report.model}|${report.config}`;
    const previous = byCell.get(key);
    const n = (report.results ?? []).length;
    if (!previous || n > previous.n || (n === previous.n && entry.mtimeMs > previous.mtimeMs))
      byCell.set(key, { report, n, mtimeMs: entry.mtimeMs });
  }
  return [...byCell.values()].map((entry) => entry.report);
}

/** Rebuild and write the gate pack without running anything. */
export async function writeBaselineManifest({ gate } = {}) {
  const manifest = await buildBaselineManifest({
    gate: gate ?? {
      text:
        process.env.PRISM_202_GATE ??
        "Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)",
    },
  });
  await writeBaselineEvidence(manifest, summarizeBaseline([]));
  return manifest;
}

const money = (value) => (value == null ? "n/a" : value.toFixed(4));
const durations = (stats) =>
  ["p50", "p95", "mean"].map((name) => (stats?.[name] == null ? "n/a" : (stats[name] / 1000).toFixed(1))).join("/");

export async function writeBaselineEvidence(manifest, summary) {
  await mkdir(BASELINE_EVIDENCE, { recursive: true });
  await writeFile(`${BASELINE_EVIDENCE}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(`${BASELINE_EVIDENCE}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    "# Plan 202 Task 4 baseline",
    "",
    `Status: ${manifest.status}${summary.status === "executed" ? "" : " — no paid arm has run; this file is the gate pack, not a result."}`,
    ...(summary.coverage
      ? [
          "",
          `Coverage: ${summary.coverage.completedCells}/${summary.coverage.requiredCells} selected cells completed. Screen complete: ${summary.screenComplete === true}. Full baseline complete: ${summary.baselineComplete === true}.`,
        ]
      : []),
    "",
    `Gate 1: ${manifest.ownerGate.text}`,
    "",
    `Compute: ${manifest.compute.mode ?? manifest.billing?.mode} via ${manifest.compute.provider ?? manifest.billing?.providers?.join(", ")}; ${manifest.compute.tokens} tokens; $${manifest.compute.usdEquivalent} list-price equivalent. ${manifest.compute.note ?? manifest.compute.limitation}`,
    ...(summary.usageLimitations?.length
      ? [
          "",
          "Some retained cells have incomplete usage. Their original reservations remain charged; measured token totals are lower bounds. See summary.json and the journal.",
        ]
      : []),
    "",
    "Complete-history comparator gaps require explicit eligibility for every question. Equivalent rendered contexts are repeats, not independent treatments.",
    ...summary.cells.flatMap((cell) => [
      ...(cell.arm === "full"
        ? [
            `${cell.suite} / ${cell.model} / full: ${cell.completeHistoryEligible}/${cell.n} scored questions prove complete history; ${cell.ineligibleQuestions} ineligible, ${cell.unscoredQuestions} unscored.`,
          ]
        : []),
      ...(cell.repeatOf ? [`${cell.suite} / ${cell.model} / ${cell.arm}: repeat of ${cell.repeatOf}.`] : []),
    ]),
    "",
    "| Suite | Model | Arm | n | Accuracy | 95% CI | Campaign cost USD | Product measured/cold/warm USD | Evaluation USD | Answer p50/p95/mean (s) | Ingestion p50/p95/mean (s) | Evaluation p50/p95/mean (s) | Failures by stage |",
    "| --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |",
    ...summary.cells.map(
      (cell) =>
        `| ${cell.suite} | ${cell.model} | ${cell.arm} | ${cell.n} | ${cell.accuracy === null ? "n/a" : cell.accuracy.toFixed(3)} | ${cell.ci95 ? `${cell.ci95[0].toFixed(3)}–${cell.ci95[1].toFixed(3)}` : "n/a"} | ${money(cell.costUsd)} | ${[cell.productCostUsd, cell.productColdCostUsd, cell.productWarmCostUsd].map(money).join("/")} | ${money(cell.evaluationCostUsd)} | ${durations({ p50: cell.latencyMs, p95: cell.latencyP95Ms, mean: cell.latencyMeanMs })} | ${durations(cell.ingestion?.wallMs)} | ${durations(cell.evaluation?.wallMs)} | ${Object.entries(
          cell.stages,
        )
          .map(([stage, n]) => `${stage} ${n}`)
          .join(", ")} |`,
    ),
    "",
    ...(summary.cells.some((cell) => (cell.abilityRows ?? []).length > 1)
      ? [
          "| Suite | Model | Arm | Ability | n | Binary accuracy | Graded primary (n) | Failures |",
          "| --- | --- | --- | --- | ---: | ---: | --- | ---: |",
          ...summary.cells.flatMap((cell) =>
            (cell.abilityRows ?? []).map(
              (row) =>
                `| ${cell.suite} | ${cell.model} | ${cell.arm} | ${row.ability} | ${row.n} | ${row.accuracy === null ? "n/a" : row.accuracy.toFixed(3)} | ${row.gradedMean === undefined ? "n/a" : `${row.gradedMean.toFixed(3)} (${row.gradedN})`} | ${cell.failuresByAbility?.[row.ability] ?? 0} |`,
            ),
          ),
        ]
      : []),
    "",
    ...(summary.gaps.length
      ? [
          "",
          summary.inference,
          summary.multiplicity,
          "| Suite | Model | Arm | Comparator | Paired gap / 95% CI | Wins / losses | Independent clusters | Holm p / status |",
          "| --- | --- | --- | --- | --- | --- | ---: | --- |",
          ...summary.gaps.map(
            (gap) =>
              `| ${gap.suite} | ${gap.model} | ${gap.arm} | ${gap.comparator} | ${gap.gap === null ? gap.reason : `${gap.gap.toFixed(3)} / ${gap.ci95.map((n) => n.toFixed(3)).join("..")}`} | ${gap.wins ?? "n/a"} / ${gap.losses ?? "n/a"} | ${gap.clusters ?? "n/a"} | ${gap.pHolm ?? "n/a"} / ${gap.status} |`,
          ),
        ]
      : []),
    "",
    ...(summary.gaps.some((gap) => gap.abilities)
      ? [
          "| Suite | Model | Arm / comparator | Ability | Score | Paired difference / 95% CI | Wins / losses | Clusters | Holm p |",
          "| --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
          ...summary.gaps.flatMap((gap) =>
            Object.entries(gap.abilities ?? {}).flatMap(([ability, scores]) =>
              Object.entries(scores).map(
                ([score, value]) =>
                  `| ${gap.suite} | ${gap.model} | ${gap.arm} / ${gap.comparator} | ${ability} | ${score} | ${value.diff === undefined ? value.reason : `${value.diff.toFixed(3)} / ${value.ci95.map((n) => n.toFixed(3)).join("..")}`} | ${value.wins ?? "n/a"} / ${value.losses ?? "n/a"} | ${value.clusters ?? "n/a"} | ${value.pHolm ?? "n/a"} |`,
              ),
            ),
          ),
          "",
        ]
      : []),
    "Stages identify candidate levers, not promised recoveries. Only product arms are eligible; failures shared across arms are counted once per suite/model/question. The JSON screeningLimits disclose rubric abilities that cannot support a lever-effect decision; stage-based needed is only a descriptive candidate flag.",
    "",
    "| Lever task | Target stages | Unique candidate questions | Arm occurrences | Shared across arms | Best share | Decision |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...summary.levers.map(
      (lever) =>
        `| ${lever.task} | ${lever.stages.join(", ")} | ${lever.candidateFailures} | ${lever.failureOccurrences} | ${lever.sharedFailures} | ${(lever.bestShare * 100).toFixed(1)}% | ${lever.status} |`,
    ),
    "",
    "| Task | Suite | Model | Eligible arm | Candidate failures / all failures | Share | Attributed / unknown / operational / invalid | Coverage | Provenance |",
    "| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |",
    ...summary.levers.flatMap((lever) =>
      lever.decisions.map(
        (decision) =>
          `| ${lever.task} | ${decision.suite} | ${decision.model} | ${decision.arm} | ${decision.counts}/${decision.total} | ${(decision.share * 100).toFixed(1)}% | ${decision.attribution.attributed}/${decision.attribution.unknown}/${decision.attribution.operational}/${decision.attribution.invalidComparator} | ${decision.attribution.coverage === null ? "n/a" : `${(decision.attribution.coverage * 100).toFixed(1)}%`} | ${JSON.stringify(decision.attribution.provenance)} |`,
      ),
    ),
  ];
  await writeFile(`${BASELINE_EVIDENCE}/README.md`, `${lines.join("\n")}\n`);
}

if (import.meta.main) {
  try {
    const command = process.argv[2] ?? "--manifest";
    if (command === "--aggregate") {
      const dir = process.argv[3] ?? BASELINE_EVIDENCE;
      const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
      if (manifest.journalPath) {
        const { reports, journal } = await loadBaselineReports(manifest);
        const summary = summarizeBaseline(reports);
        Object.assign(summary, baselineCoverage(manifest, reports.length));
        summary.campaignStatus = journal?.status ?? "not-started";
        summary.usageLimitations = reports
          .filter((r) => r.usageComplete === false)
          .map((r) => ({
            suite: r.suite,
            provider: r.provider,
            model: r.model,
            arm: r.config,
            reason: "incomplete usage; reservation retained",
          }));
        await writeBaselineEvidence(
          { ...manifest, status: summary.baselineComplete || summary.screenComplete ? "completed" : summary.campaignStatus },
          summary,
        );
        console.log(`baseline: ${reports.length}/${manifest.jobs.length} verified cells; ${summary.campaignStatus}`);
        process.exit(0);
      }
      const { readdir, stat } = await import("node:fs/promises");
      const entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.startsWith("report-") && entry.name.endsWith(".json"))
        .map((entry) => resolve(entry.parentPath ?? dir, entry.name));
      const loaded = [];
      for (const file of entries) {
        try {
          const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
          loaded.push({ report: JSON.parse(text), mtimeMs: info.mtimeMs });
        } catch {
          // An in-flight write is not evidence; it is picked up on the next aggregate.
        }
      }
      const reports = authoritativeReports(loaded);
      const summary = summarizeBaseline(reports);
      summary.attemptsSeen = loaded.length;
      summary.attemptsIgnored = loaded.length - reports.length;
      await writeBaselineEvidence(manifest, summary);
      console.log(
        `baseline: ${summary.cells.length} cells from ${reports.length} completed attempts (${summary.attemptsIgnored} ignored), ${summary.levers.filter((lever) => lever.needed).length} levers needed`,
      );
      process.exit(0);
    }
    if (command !== "--manifest") throw new Error("usage: baseline.mjs --manifest | --aggregate <dir>");
    const manifest = await buildBaselineManifest({
      gate: {
        text:
          process.env.PRISM_202_GATE ??
          "Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)",
      },
      budgetConfirmed: process.env.PRISM_202_BUDGET_CONFIRMED === "1",
    });
    await writeBaselineEvidence(manifest, summarizeBaseline([]));
    console.log(
      `${manifest.status}; ${manifest.jobs.length} jobs; ${manifest.compute.tokens} tokens; $${manifest.compute.usdEquivalent} list-price equivalent (subscription)`,
    );
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
