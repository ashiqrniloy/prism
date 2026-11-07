#!/usr/bin/env bun
/** Post-campaign acceptance aggregation. Reads only ids/scores/statuses from paid evidence. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import {
  ACCEPTANCE_1888_EVIDENCE,
  ACCEPTANCE_1888_JOURNAL,
  ACCEPTANCE_1888_MANIFEST,
  ACCEPTANCE_1889_EVIDENCE,
  ACCEPTANCE_1889_JOURNAL,
  ACCEPTANCE_1889_MANIFEST,
  ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_18810_ARM_IDS,
  ACCEPTANCE_18810_COMPARISONS,
  ACCEPTANCE_18810_JOURNAL,
  ACCEPTANCE_18810_MANIFEST,
  ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_JOURNAL,
  ACCEPTANCE_MANIFEST,
  ARM_1888_IDS,
  ARM_1889_IDS,
  acceptance1888TaskState,
  acceptance18810Verdict,
  armRecord1888,
  assertAcceptance1888Manifest,
  assertAcceptance1889Manifest,
  assertAcceptance18810Manifest,
  assertAcceptanceManifest,
  findingVerdict1888,
  improvementVerdict,
  LIFECYCLE_ARMS,
  LIFECYCLE_SEEDS,
  primaryFamily1888,
  qualityVerdict,
  REQUIRED_LME_CONFIGS,
  statisticallyPowered,
  substitutionVerdict,
} from "./acceptance.mjs";
import { stableHash } from "./journal.mjs";
import { summarizeLifecycle } from "./lifecycle/suite.mjs";
import { METRIC_VERSION } from "./metrics.mjs";
import { stageFromCounts } from "./replay.mjs";
import { compare, holm } from "./stats.mjs";

async function reportsFor(jobId, directory = ACCEPTANCE_EVIDENCE, prefix = "final") {
  const files = (await readdir(directory)).filter((file) => file.startsWith(`${prefix}-${jobId}`) && file.endsWith(".json")).sort();
  const reports = [];
  for (const file of files) reports.push(JSON.parse(await readFile(`${directory}/${file}`, "utf8")));
  return reports;
}

// The config is the treatment, not part of the frozen comparison protocol.
function comparable(report) {
  return {
    ...report,
    protocolHash: stableHash({
      suite: report.suite,
      subset: report.subset,
      dataset: report.dataset,
      metricVersion: report.metricVersion,
      judgeProtocol: report.judgeProtocol,
    }),
  };
}

function overallGroups(a, b) {
  const rowsA = a.results.map((row) => ({ ...row, ability: "overall" }));
  const rowsB = b.results.map((row) => ({ ...row, ability: "overall" }));
  const left = { ...comparable(a), results: rowsA, metricVersion: METRIC_VERSION };
  const right = { ...comparable(b), results: rowsB, metricVersion: METRIC_VERSION };
  return compare(left, right);
}

function mergeLifecycle(reports, name) {
  const base = reports[0];
  const results = reports.flatMap((report) => report.results);
  const sessions = reports.flatMap((report) => report.sessions);
  const inputTokens = reports.reduce((sum, report) => sum + (report.inputTokens ?? 0), 0);
  const cacheReadTokens = reports.reduce((sum, report) => sum + (report.cacheReadTokens ?? 0), 0);
  const outputTokens = reports.reduce((sum, report) => sum + (report.outputTokens ?? 0), 0);
  const seeds = reports.map((report) => report.seed).sort((a, b) => a - b);
  const protocolHash = stableHash({
    arm: "lifecycle",
    seeds,
    metricVersion: base.metricVersion,
    dataset: base.dataset,
    projects: base.scenario?.projects,
    sessionsPerProject: base.scenario?.sessionsPerProject,
  });
  return {
    ...base,
    config: name,
    seed: seeds,
    results,
    sessions,
    metrics: (() => {
      const metrics = summarizeLifecycle(results.map((row) => ({ [row.ability]: row.value })));
      metrics.tokensPerSession = sessions.length ? inputTokens / sessions.length : null;
      return metrics;
    })(),
    clusters: new Set(results.map((row) => row.cluster)).size,
    clusterUnit: "persona",
    inputTokens,
    cacheReadTokens,
    outputTokens,
    usageComplete: reports.every((report) => report.usageComplete !== false),
    status: reports.every((report) => report.status === "completed") ? "completed" : "partial",
    protocolHash,
    personaReports: reports.length,
    limitations: base.limitations,
  };
}

function tokenCost(report) {
  return {
    inputTokens: report.inputTokens ?? 0,
    cacheReadTokens: report.cacheReadTokens ?? 0,
    uncachedInputTokens: (report.inputTokens ?? 0) - (report.cacheReadTokens ?? 0),
    outputTokens: report.outputTokens ?? 0,
    cacheReadRatio: report.inputTokens ? (report.cacheReadTokens ?? 0) / report.inputTokens : 0,
  };
}

async function main() {
  const manifest = assertAcceptanceManifest(JSON.parse(await readFile(ACCEPTANCE_MANIFEST, "utf8")));
  const journal = JSON.parse(await readFile(ACCEPTANCE_JOURNAL, "utf8"));
  const attempts = journal.attempts;
  const jobIds = manifest.jobs.map((job) => job.id);
  const reports = new Map();
  const missing = [];
  for (const jobId of jobIds) {
    const candidates = await reportsFor(jobId);
    const completed = candidates.find((report) => report.status === "completed");
    if (completed) reports.set(jobId, completed);
    else missing.push({ id: jobId, attempts: candidates.map((report) => ({ status: report.status, inputTokens: report.inputTokens })) });
  }
  // IDs use the raw config slug, including the plus sign.
  const lme = Object.fromEntries(REQUIRED_LME_CONFIGS.map((config) => [config, reports.get(`accept-lme-${config}`)]));
  const quality = [];
  if (lme.full) {
    for (const config of REQUIRED_LME_CONFIGS.filter((item) => item !== "full")) {
      if (!lme[config]) continue;
      const groups = { ...compare(comparable(lme.full), comparable(lme[config])), ...overallGroups(lme.full, lme[config]) };
      const adjusted = holm(Object.values(groups).map((group) => group.p));
      Object.values(groups).forEach((group, index) => {
        group.pHolm = adjusted[index];
      });
      quality.push({
        candidate: config,
        baseline: "full",
        groups,
        cost: { baseline: tokenCost(lme.full), candidate: tokenCost(lme[config]) },
      });
    }
  }
  const lifecycleReports = {};
  for (const arm of LIFECYCLE_ARMS) {
    const collected = [];
    for (const seed of LIFECYCLE_SEEDS) {
      const report = reports.get(`accept-lifecycle-${arm.name}-p${seed}`);
      if (report) collected.push(report);
    }
    if (collected.length) lifecycleReports[arm.name] = mergeLifecycle(collected, arm.name);
  }
  const safety = [];
  if (lifecycleReports.full) {
    for (const arm of LIFECYCLE_ARMS.filter((item) => item.name !== "full")) {
      if (!lifecycleReports[arm.name]) continue;
      const groups = compare(lifecycleReports.full, lifecycleReports[arm.name]);
      const adjusted = holm(Object.values(groups).map((group) => group.p));
      Object.values(groups).forEach((group, index) => {
        group.pHolm = adjusted[index];
      });
      safety.push({
        candidate: arm.name,
        baseline: "full",
        groups,
        personas: lifecycleReports[arm.name].personaReports,
        cost: { baseline: tokenCost(lifecycleReports.full), candidate: tokenCost(lifecycleReports[arm.name]) },
      });
    }
  }
  const mab = {};
  const mabFull = reports.get("accept-mab-cr-full");
  const mabFabric = reports.get("accept-mab-cr-fabric");
  if (mabFull && mabFabric) {
    mab.groups = { ...compare(comparable(mabFull), comparable(mabFabric)), ...overallGroups(mabFull, mabFabric) };
    const adjusted = holm(Object.values(mab.groups).map((group) => group.p));
    Object.values(mab.groups).forEach((group, index) => {
      group.pHolm = adjusted[index];
    });
    mab.cost = { baseline: tokenCost(mabFull), candidate: tokenCost(mabFabric) };
  }
  const fabricOverall = quality.find((entry) => entry.candidate === "fabric")?.groups.overall;
  const powered = Boolean(fabricOverall?.confirmatory && fabricOverall?.power >= 0.8);
  const fullContextNonInferior = Boolean(fabricOverall && fabricOverall.ci95[0] >= -0.03 && fabricOverall.confirmatory);
  const candidateImproves = Boolean(fabricOverall && fabricOverall.improvementDelta > 0 && fabricOverall.pHolm < 0.05);
  const verdict = qualityVerdict({ candidateImproves, fullContextNonInferior, powered });
  const summary = {
    schemaVersion: 1,
    metricVersion: METRIC_VERSION,
    manifestHash: stableHash({
      ceiling: manifest.ceiling,
      jobs: manifest.jobs.map((job) => [job.id, job.suite, job.config, job.seed ?? null, job.ablate]),
    }),
    sourceReports: Object.fromEntries(
      [...reports].map(([id, report]) => [id, { status: report.status, usageComplete: report.usageComplete !== false }]),
    ),
    missing,
    reliability: {
      requiredJobs: jobIds.length,
      completedJobs: reports.size,
      completionRate: reports.size / jobIds.length,
      attempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => ["failed", "setup-failure", "abandoned"].includes(attempt.status)).length,
      usageIncompleteAttempts: attempts.filter((attempt) => attempt.usageComplete === false).length,
    },
    quality,
    safety,
    memoryAgentBenchConflictResolution: mab,
    locomo: reports.has("accept-locomo-full")
      ? { status: reports.get("accept-locomo-full").status, cost: tokenCost(reports.get("accept-locomo-full")) }
      : null,
    lifecycle: Object.fromEntries(
      Object.entries(lifecycleReports).map(([name, report]) => [
        name,
        { personas: report.personaReports, status: report.status, metrics: report.metrics, cost: tokenCost(report) },
      ]),
    ),
    primary: {
      candidate: "fabric",
      baseline: "full",
      powered,
      fullContextNonInferior,
      candidateImproves,
      verdict,
      overall: fabricOverall
        ? {
            n: fabricOverall.n,
            diff: fabricOverall.diff,
            ci95: fabricOverall.ci95,
            p: fabricOverall.p,
            pHolm: fabricOverall.pHolm,
            rawMeans: fabricOverall.rawMeans,
            clusters: fabricOverall.clusters,
            confirmatory: fabricOverall.confirmatory,
          }
        : null,
    },
  };
  await writeFile(`${ACCEPTANCE_EVIDENCE}/acceptance-comparisons.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    "# 188.7 final acceptance comparisons",
    "",
    `Required jobs: ${jobIds.length}; completed: ${reports.size}; missing: ${missing.length}; attempts: ${attempts.length}.`,
    `Primary fabric vs full: verdict=${verdict}; powered=${powered}; full-context non-inferior=${fullContextNonInferior}.`,
    "",
    "| Family | Candidate | Metric | n | Clusters | Diff | 95% CI | p | p-Holm |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |",
    ...quality.flatMap((entry) =>
      Object.entries(entry.groups).map(
        ([metric, group]) =>
          `| Q | ${entry.candidate} | ${metric} | ${group.n} | ${group.clusters} | ${group.diff.toFixed(4)} | [${group.ci95.map((v) => v.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} | ${group.pHolm.toExponential(3)} |`,
      ),
    ),
    ...safety.flatMap((entry) =>
      Object.entries(entry.groups).map(
        ([metric, group]) =>
          `| S | ${entry.candidate} | ${metric} | ${group.n} | ${group.clusters} | ${group.diff.toFixed(4)} | [${group.ci95.map((v) => v.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} | ${group.pHolm.toExponential(3)} |`,
      ),
    ),
    ...Object.entries(mab.groups ?? {}).map(
      ([metric, group]) =>
        `| Q | mab-fabric | ${metric} | ${group.n} | ${group.clusters} | ${group.diff.toFixed(4)} | [${group.ci95.map((v) => v.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} | ${group.pHolm.toExponential(3)} |`,
    ),
    "",
    "Cost is wire input/cache/output only. Currency is not available without authenticated rate semantics.",
    ...Object.entries(summary.lifecycle).map(
      ([name, report]) =>
        `- lifecycle ${name}: ${report.personas} personas, ${report.status}, ${report.cost.inputTokens} input, ${report.cost.cacheReadTokens} cache-read.`,
    ),
    ...Object.entries(summary.sourceReports)
      .filter(([, report]) => report.usageComplete === false)
      .map(([id]) => `- usage incomplete: ${id}`),
    ...missing.map((item) => `- missing completed report: ${item.id}`),
  ];
  await writeFile(`${ACCEPTANCE_EVIDENCE}/acceptance-comparisons.md`, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ summary, missing }, null, 2));
}

/* Plan 188.8: paired held-out before/after on the frozen v2 draw. */
function byAbility1888(report) {
  const grouped = new Map();
  for (const row of report.results) {
    const group = grouped.get(row.ability) ?? { n: 0, correct: 0, runLimit: 0 };
    group.n += 1;
    if (row.correct === true) group.correct += 1;
    if (row.outcome === "run_limit") group.runLimit += 1;
    grouped.set(row.ability, group);
  }
  return Object.fromEntries(
    [...grouped].map(([ability, group]) => [
      ability,
      { n: group.n, correct: group.correct, accuracy: group.correct / group.n, runLimitRate: group.runLimit / group.n },
    ]),
  );
}

function stageStratumLabel(stratum) {
  const accuracy = stratum?.accuracy;
  return stratum === null || accuracy === null || accuracy === undefined
    ? "n/a"
    : `${stratum.correct}/${stratum.n} (${Math.round(accuracy * 100)}%)`;
}

function paired1888(a, b) {
  return { ...compare(comparable(a), comparable(b)), ...overallGroups(a, b) };
}

async function delivery1888(name, results = []) {
  try {
    const report = JSON.parse(await readFile(`${ACCEPTANCE_1888_EVIDENCE}/delivery-diagnostics-${name}.json`, "utf8"));
    // Conditional accuracy: does the solver answer when the evidence is visible at all? Joins the
    // paid verdict by id; the diagnostic contributes ids, flags and counts only.
    const correctById = new Map(results.map((row) => [row.id, row.correct === true]));
    const strata = { visible: { n: 0, correct: 0 }, notVisible: { n: 0, correct: 0 } };
    // Stages are re-derived with the corrected classifier (partial_evidence), so this report never
    // repeats a stage a committed diagnostic recorded under the old one.
    const byStage = {};
    const byAbilityStage = {};
    const stagesAsRecorded = {};
    for (const row of report.rows ?? []) {
      stagesAsRecorded[row.stage] = (stagesAsRecorded[row.stage] ?? 0) + 1;
      const stage =
        row.stage === "store_error"
          ? "store_error"
          : stageFromCounts({
              goldRounds: row.goldRounds,
              candidateGold: row.candidateGold,
              selectedGold: row.selectedGold,
              fineRounds: row.fineRounds,
              fineSelected: row.selectedFine,
              correct: row.answerCorrect === true,
            });
      byStage[stage] = (byStage[stage] ?? 0) + 1;
      const abilityStage = (byAbilityStage[row.ability] ??= {});
      abilityStage[stage] = (abilityStage[stage] ?? 0) + 1;
      // A question with no fine gold has no "visible evidence" state to condition on.
      if (row.answerCorrect === undefined || !row.fineRounds) continue;
      const stratum = row.allNeededVisible ? strata.visible : strata.notVisible;
      stratum.n += 1;
      stratum.correct += Number(correctById.get(row.id) === true);
    }
    const rate = (stratum) => (stratum.n === 0 ? null : stratum.correct / stratum.n);
    return {
      protocol: report.protocol,
      subset: report.subset,
      renderer: report.injectionRenderer ?? null,
      byAbility: Object.fromEntries(
        Object.entries(report.summary?.byAbility ?? {}).map(([ability, value]) => [
          ability,
          {
            n: value.n,
            allNeededVisible: value.allNeededVisible,
            answerMessageVisible: value.answerMessageVisible,
            byStage: byAbilityStage[ability] ?? value.byStage,
          },
        ]),
      ),
      stages: byStage,
      stagesAsRecorded,
      conditionalAccuracy: {
        visible: { ...strata.visible, accuracy: rate(strata.visible) },
        notVisible: { ...strata.notVisible, accuracy: rate(strata.notVisible) },
      },
    };
  } catch {
    return null;
  }
}

async function main1888() {
  const manifest = assertAcceptance1888Manifest(JSON.parse(await readFile(ACCEPTANCE_1888_MANIFEST, "utf8")));
  const journal = JSON.parse(await readFile(ACCEPTANCE_1888_JOURNAL, "utf8"));
  const attempts = journal.attempts;
  const reports = new Map();
  const missing = [];
  for (const job of manifest.jobs) {
    const candidates = await reportsFor(job.id, ACCEPTANCE_1888_EVIDENCE);
    const completed = candidates.find((report) => report.status === "completed");
    if (completed) reports.set(job.id, completed);
    else
      missing.push({
        id: job.id,
        attempts: candidates.map((report) => ({ status: report.status, inputTokens: report.inputTokens })),
      });
  }
  const arm = (name) => reports.get(ARM_1888_IDS[name]);
  const record = (report) => (report ? { ...armRecord1888(report), byAbility: byAbility1888(report) } : null);
  const prefix = arm("prefix");
  const postfix = arm("postfix");
  const agentic = arm("agentic");
  const full = arm("full");
  const improvement = prefix && postfix ? paired1888(prefix, postfix) : null;
  const primary = improvement ? primaryFamily1888(improvement) : null;
  const overall = improvement?.overall ?? null;
  const powered = Boolean(prefix?.status === "completed" && postfix?.status === "completed" && statisticallyPowered(overall));
  const improvementResult = primary ? improvementVerdict({ groups: primary, powered }) : "inconclusive";
  const usageComplete = [prefix, postfix, agentic, full].every((report) => report?.usageComplete !== false);
  const substitutions = [];
  for (const [name, report] of [
    ["prefix", prefix],
    ["postfix", postfix],
    ["agentic", agentic],
  ]) {
    if (!report || !full) continue;
    const groups = paired1888(full, report);
    substitutions.push({
      arm: name,
      baseline: "full",
      groups,
      verdict: substitutionVerdict({
        overall: groups.overall,
        powered: Boolean(report.status === "completed" && full.status === "completed" && statisticallyPowered(groups.overall)),
      }),
    });
  }
  const agenticComparison = agentic && postfix ? paired1888(postfix, agentic) : null;
  const delivery = Object.fromEntries(
    await Promise.all(
      [
        ["heldout-prefix", "prefix"],
        ["heldout-postfix", "postfix"],
        ["heldout-agentic", "agentic"],
        ["development-postfix", "development"],
      ].map(async ([name, armName]) => [name, await delivery1888(name, arm(armName)?.results ?? [])]),
    ),
  );
  const summary = {
    schemaVersion: 1,
    kind: "188.8-heldout-acceptance",
    plan: "188.8",
    metricVersion: METRIC_VERSION,
    protocolVersion: manifest.protocolVersion,
    manifestHash: stableHash({
      ceiling: manifest.ceiling,
      jobs: manifest.jobs.map((job) => [job.id, job.config, job.subset, job.maxInputTokens, job.cwd ?? null]),
    }),
    primaryFamily: manifest.primaryAbilities,
    nonInferiorityMargin: manifest.nonInferiorityMargin,
    usageComplete,
    // Cost is never claimed without complete wire usage; quality verdicts do not depend on it.
    costClaim: usageComplete,
    ...acceptance1888TaskState({ missing }),
    reliability: {
      requiredJobs: manifest.jobs.length,
      completedJobs: reports.size,
      attempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => ["failed", "setup-failure", "abandoned"].includes(attempt.status)).length,
      usageIncompleteAttempts: attempts.filter((attempt) => attempt.usageComplete === false).length,
    },
    arms: Object.fromEntries(["prefix", "postfix", "agentic", "development", "full"].map((name) => [name, record(arm(name))])),
    improvement: {
      baseline: "prefix",
      candidate: "postfix",
      powered,
      primary,
      overall,
      verdict: improvementResult,
    },
    agenticVsPostfix: agenticComparison
      ? {
          baseline: "postfix",
          candidate: "agentic",
          groups: { ...agenticComparison },
          verdict: qualityVerdict({
            candidateImproves: Boolean(agenticComparison.overall?.improvementDelta > 0 && agenticComparison.overall?.pHolm < 0.05),
            fullContextNonInferior: Boolean(agenticComparison.overall?.confirmatory),
            powered: Boolean(agenticComparison.overall?.confirmatory),
          }),
        }
      : null,
    substitution: substitutions,
    verdicts: {
      improvement: improvementResult,
      substitution: substitutions.find((entry) => entry.arm === "postfix")?.verdict ?? "not-a-substitute",
      finding: findingVerdict1888({
        substitution: substitutions.find((entry) => entry.arm === "postfix")?.verdict ?? "not-a-substitute",
        powered,
      }),
    },
    delivery,
  };
  await writeFile(`${ACCEPTANCE_1888_EVIDENCE}/acceptance-comparisons.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const row = (label, groups) =>
    Object.entries(groups ?? {}).map(
      ([metric, group]) =>
        `| ${label} | ${metric} | ${group.n} | ${group.diff.toFixed(4)} | [${group.ci95.map((value) => value.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} | ${(group.pHolm ?? NaN).toExponential(3)} |`,
    );
  const lines = [
    "# 188.8 held-out acceptance comparisons",
    "",
    `Required arms: ${manifest.jobs.length}; completed: ${reports.size}; missing: ${missing.length}; attempts: ${attempts.length}.`,
    `Improvement verdict: ${summary.verdicts.improvement}; substitution verdict: ${summary.verdicts.substitution}; F13: ${summary.verdicts.finding}.`,
    "",
    "Question (1): does post-fix fabric improve on pre-fix fabric? Question (2): is any fabric arm a full-context substitute?",
    "They are reported separately; (1) passing alone is an opt-in improvement, never substitution.",
    "",
    "| Arm | Ability | n | Diff | 95% CI | p | p-Holm |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: |",
    ...row("postfix-prefix", primary),
    ...row("postfix-prefix", { overall }),
    ...row(
      "postfix-prefix-descriptive",
      Object.fromEntries(Object.entries(improvement ?? {}).filter(([ability]) => !(ability in (primary ?? {})) && ability !== "overall")),
    ),
    ...(agenticComparison ? row("agentic-postfix", agenticComparison) : []),
    ...substitutions.flatMap((entry) => row(`${entry.arm}-vs-full`, { overall: entry.groups.overall })),
    "",
    "Conditional accuracy: does the solver answer when all needed evidence is visible in the injected context? Stage counts use the corrected classifier (partial_evidence when only some fine rounds are visible).",
    "",
    "| Diagnostics arm | Renderer | Stages | All needed visible | Not all visible |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(delivery)
      .filter(([, value]) => value)
      .map(
        ([name, value]) =>
          `| ${name} | ${value.renderer} | ${Object.entries(value.stages ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([stage, count]) => `${stage} ${count}`)
            .join(
              ", ",
            )} | ${stageStratumLabel(value.conditionalAccuracy?.visible)} | ${stageStratumLabel(value.conditionalAccuracy?.notVisible)} |`,
      ),
    "",
    "Cost is wire input/cache/output only. Currency is not available without authenticated rate semantics.",
    ...Object.entries(summary.arms)
      .filter(([, value]) => value)
      .map(
        ([name, value]) =>
          `- ${name}: ${value.correct}/${value.answers}, ${value.status}, ${value.inputTokens} input, ${value.cacheReadTokens} cache-read, run-limit ${value.runLimitRate.toFixed(4)}.`,
      ),
    ...missing.map((item) => `- missing completed report: ${item.id}`),
  ];
  await writeFile(`${ACCEPTANCE_1888_EVIDENCE}/acceptance-comparisons.md`, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ verdicts: summary.verdicts, missing, taskComplete: summary.taskComplete }, null, 2));
}

if (import.meta.main) {
  if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "210") await main210();
  else if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "209") await main209();
  else if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "208") await main208();
  else if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "188.8") await main1888();
  else if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "188.9") await main1889();
  else if (process.argv.includes("--plan") && process.argv[process.argv.indexOf("--plan") + 1] === "188.10") await main18810();
  else await main();
}

/* Plan 188.9 Task 11: held-out acceptance for the screened-in arms (no `fabric-xc`). */
async function main1889() {
  const manifest = assertAcceptance1889Manifest(JSON.parse(await readFile(ACCEPTANCE_1889_MANIFEST, "utf8")));
  const journal = JSON.parse(await readFile(ACCEPTANCE_1889_JOURNAL, "utf8"));
  const attempts = journal.attempts;
  const reports = new Map();
  const missing = [];
  for (const job of manifest.jobs) {
    const candidates = await reportsFor(job.id, ACCEPTANCE_1889_EVIDENCE);
    const completed = candidates.find((report) => report.status === "completed");
    if (completed) reports.set(job.id, completed);
    else missing.push({ id: job.id, attempts: candidates.map((report) => ({ status: report.status, inputTokens: report.inputTokens })) });
  }
  const arm = (name) => reports.get(ARM_1889_IDS[name]);
  const full = JSON.parse(await readFile(manifest.fullReference.from, "utf8"));
  // A write-side report has no `correct` field: score what exists instead of refusing the report.
  const record = (report) => {
    if (!report) return null;
    const rows = report.results ?? [];
    return {
      status: report.status,
      usageComplete: report.usageComplete !== false,
      answers: rows.length,
      correct: rows.filter((row) => row.correct === true).length,
      runLimitRate: rows.length ? rows.filter((row) => row.outcome === "run_limit").length / rows.length : 0,
      inputTokens: report.inputTokens ?? 0,
      cacheReadTokens: report.cacheReadTokens ?? 0,
      outputTokens: report.outputTokens ?? 0,
      byAbility: byAbility1888(report),
      tokensPerQuestion: rows.length ? Math.round((report.inputTokens ?? 0) / rows.length) : null,
      timing: report.timing ?? null,
    };
  };
  const baseline = arm("baseline");
  const treatment = arm("x");
  const comparison = baseline && treatment ? paired1888(baseline, treatment) : null;
  const primary = comparison ? primaryFamily1888(comparison) : null;
  const overall = comparison?.overall ?? null;
  const powered = Boolean(baseline?.status === "completed" && treatment?.status === "completed" && statisticallyPowered(overall));
  const improvement = primary ? improvementVerdict({ groups: primary, powered }) : "inconclusive";
  const substitutionGroups = treatment && full ? paired1888(full, treatment) : null;
  const substitution = substitutionGroups
    ? substitutionVerdict({
        overall: substitutionGroups.overall,
        powered: Boolean(treatment.status === "completed" && statisticallyPowered(substitutionGroups.overall)),
      })
    : "not-a-substitute";
  const usageComplete = [baseline, treatment, full].every((report) => report?.usageComplete !== false);
  // Write-side cost is reported per stored session and per question, never folded into the read cost.
  const writeCost = writeCostOf(arm("write-x"));
  const delivery = {};
  for (const name of ["baseline", "x"]) {
    try {
      const report = JSON.parse(await readFile(`${ACCEPTANCE_1889_EVIDENCE}/delivery-${name}-heldout.json`, "utf8"));
      delivery[name] = await delivery1888From(report, arm(name)?.results ?? []);
    } catch {
      delivery[name] = null;
    }
  }
  const quality = qualityVerdict({
    candidateImproves: Boolean(overall?.diff > 0 && overall.pHolm < 0.05),
    fullContextNonInferior: substitution === "full-context-substitute",
    powered,
  });
  const summary = {
    schemaVersion: 1,
    kind: "188.9-heldout-acceptance",
    plan: "188.9",
    metricVersion: METRIC_VERSION,
    protocolVersion: manifest.protocolVersion,
    manifestHash: stableHash({
      ceiling: manifest.ceiling,
      jobs: manifest.jobs.map((job) => [job.id, job.config, job.subset, job.maxInputTokens, job.ablate ?? null]),
    }),
    primaryFamily: manifest.primaryAbilities,
    nonInferiorityMargin: manifest.nonInferiorityMargin,
    fullReference: manifest.fullReference,
    usageComplete,
    ...acceptance1888TaskState({ missing }),
    reliability: {
      requiredJobs: manifest.jobs.length,
      completedJobs: reports.size,
      attempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => ["failed", "setup-failure", "abandoned"].includes(attempt.status)).length,
      usageIncompleteAttempts: attempts.filter((attempt) => attempt.usageComplete === false).length,
    },
    arms: Object.fromEntries(["baseline", "x", "write-x"].map((name) => [name, record(arm(name))])),
    full: {
      reusedFrom: manifest.fullReference.from,
      // The reused report predates this plan's metric version; score it by the same boolean rule.
      correct: (full.results ?? []).filter((row) => row.correct === true).length,
      answers: (full.results ?? []).length,
      inputTokens: full.inputTokens ?? 0,
      byAbility: byAbility1888(full),
    },
    improvement: { baseline: "baseline", candidate: "x", powered, primary, overall, verdict: improvement },
    substitution: substitutionGroups ? { baseline: "full", candidate: "x", groups: substitutionGroups, verdict: substitution } : null,
    writeCost,
    delivery,
    verdicts: {
      improvement,
      substitution,
      finding: findingVerdict1888({ substitution, powered }),
      quality,
    },
  };
  await writeFile(`${ACCEPTANCE_1889_EVIDENCE}/acceptance-comparisons.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const row = (label, groups) =>
    Object.entries(groups ?? {}).map(
      ([metric, group]) =>
        `| ${label} | ${metric} | ${group.n} | ${group.diff.toFixed(4)} | [${group.ci95.map((value) => value.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} | ${(group.pHolm ?? NaN).toExponential(3)} |`,
    );
  const lines = [
    "# 188.9 held-out acceptance comparisons",
    "",
    `Required arms: ${manifest.jobs.length}; completed: ${reports.size}; missing: ${missing.length}; attempts: ${attempts.length}.`,
    `Improvement verdict: ${improvement}; substitution verdict: ${substitution}; F13: ${summary.verdicts.finding}.`,
    `Full-context reference: reused from ${manifest.fullReference.from} (${manifest.fullReference.reason}).`,
    "",
    "| Arm | Ability | n | Diff | 95% CI | p | p-Holm |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: |",
    ...row("x-baseline", primary),
    ...row("x-baseline", { overall }),
    ...row(
      "x-baseline-descriptive",
      Object.fromEntries(Object.entries(comparison ?? {}).filter(([ability]) => !(ability in (primary ?? {})) && ability !== "overall")),
    ),
    ...(substitutionGroups ? row("x-vs-full", { overall: substitutionGroups.overall }) : []),
    "",
    "| Arm | Correct | Input | Cache-read | Tokens/question | Run-limit |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...["baseline", "x"]
      .map((name) => [name, record(arm(name))])
      .filter(([, row]) => row)
      .map(
        ([name, row]) =>
          `| ${name} | ${row.correct}/${row.answers} | ${row.inputTokens} | ${row.cacheReadTokens} | ${row.tokensPerQuestion} | ${row.runLimitRate.toFixed(4)} |`,
      ),
    ...(writeCost ? [`| write-x | — | ${writeCost.inputTokens} | — | ${writeCost.perSession} per session | — |`] : []),
    "",
    ...Object.entries(delivery)
      .filter(([, value]) => value)
      .map(
        ([name, value]) =>
          `- ${name} stages: ${Object.entries(value.stages ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([stage, count]) => `${stage} ${count}`)
            .join(
              ", ",
            )}; all needed visible ${stageStratumLabel(value.conditionalAccuracy?.visible)}; not visible ${stageStratumLabel(value.conditionalAccuracy?.notVisible)}.`,
      ),
    ...missing.map((item) => `- missing completed report: ${item.id}`),
  ];
  await writeFile(`${ACCEPTANCE_1889_EVIDENCE}/acceptance-comparisons.md`, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ verdicts: summary.verdicts, missing, taskComplete: summary.taskComplete }, null, 2));
}

/**
 * The product cost is per stored session, the benchmark cost is per question: they are never
 * folded together, and a failed consolidation is reported because it is work the product paid for.
 */
export function writeCostOf(report) {
  if (!report) return null;
  const rows = report.results ?? [];
  const sessions = rows.reduce((sum, row) => sum + (row.ingest?.sessions ?? 0), 0);
  return {
    inputTokens: report.inputTokens ?? 0,
    sessions,
    questions: rows.length,
    perSession: sessions ? Math.round((report.inputTokens ?? 0) / sessions) : null,
    perQuestion: rows.length ? Math.round((report.inputTokens ?? 0) / rows.length) : null,
    failedConsolidations: rows.reduce((sum, row) => sum + (row.ingest?.consolidationFailures ?? 0), 0),
    wallMs: report.timing?.wallMs ?? null,
  };
}

/** Conditional accuracy for an offline diagnostic, joined to the paid verdict by question id. */
async function delivery1888From(report, results) {
  const correctById = new Map(results.map((row) => [row.id, row.correct === true]));
  const strata = { visible: { n: 0, correct: 0 }, notVisible: { n: 0, correct: 0 } };
  const byStage = {};
  for (const row of report.rows ?? []) {
    const stage =
      row.stage === "store_error"
        ? "store_error"
        : stageFromCounts({
            goldRounds: row.goldRounds,
            candidateGold: row.candidateGold,
            selectedGold: row.selectedGold,
            fineRounds: row.fineRounds,
            fineSelected: row.selectedFine,
            correct: row.answerCorrect === true,
          });
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (row.answerCorrect === undefined || !row.fineRounds) continue;
    const stratum = row.allNeededVisible ? strata.visible : strata.notVisible;
    stratum.n += 1;
    stratum.correct += Number(correctById.get(row.id) === true);
  }
  const rate = (stratum) => (stratum.n === 0 ? null : stratum.correct / stratum.n);
  return {
    protocol: report.protocol,
    subset: report.subset,
    renderer: report.injectionRenderer ?? null,
    stages: byStage,
    conditionalAccuracy: {
      visible: { ...strata.visible, accuracy: rate(strata.visible) },
      notVisible: { ...strata.notVisible, accuracy: rate(strata.notVisible) },
    },
  };
}

/**
 * Plan 188.10 Task 9: held-out v3 for the selected `x-tools` arm, paired against the passive `x`
 * reference on the same snapshot. The primary criteria come from the manifest; the report never
 * chooses them, and a missing arm leaves the run incomplete rather than scored.
 */
async function main18810() {
  const manifest = assertAcceptance18810Manifest(JSON.parse(await readFile(ACCEPTANCE_18810_MANIFEST, "utf8")));
  const journal = JSON.parse(await readFile(ACCEPTANCE_18810_JOURNAL, "utf8"));
  const attempts = journal.attempts ?? [];
  const reports = new Map();
  const missing = [];
  for (const job of manifest.jobs) {
    const candidates = await reportsFor(job.id, ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE);
    const completed = candidates.find((report) => report.status === "completed");
    if (completed) reports.set(job.id, completed);
    else missing.push({ id: job.id, attempts: candidates.map((report) => ({ status: report.status, inputTokens: report.inputTokens })) });
  }
  const arm = (name) => reports.get(ACCEPTANCE_18810_ARM_IDS[name]);
  const record = (report) => {
    if (!report) return null;
    const rows = report.results ?? [];
    return {
      status: report.status,
      usageComplete: report.usageComplete !== false,
      answers: rows.length,
      correct: rows.filter((row) => row.correct === true).length,
      runLimitRate: rows.length ? rows.filter((row) => row.outcome === "run_limit").length / rows.length : 0,
      inputTokens: report.inputTokens ?? 0,
      cacheReadTokens: report.cacheReadTokens ?? 0,
      outputTokens: report.outputTokens ?? 0,
      injectedContextTokens: report.injectedContextTokens ?? null,
      injectionPrecision: report.injectionPrecision ?? null,
      toolCalls: report.toolCalls ?? null,
      toolCallsPerQuestion: report.toolCallsPerQuestion ?? null,
      recallCalls: report.recallCalls ?? null,
      byAbility: byAbility1888(report),
      tokensPerQuestion: rows.length ? Math.round((report.inputTokens ?? 0) / rows.length) : null,
      timing: report.timing ?? null,
    };
  };
  const reference = arm("x");
  const selected = arm("x-tools");
  const full = arm("full");
  const comparison = reference && selected ? paired1888(reference, selected) : null;
  const verdict = acceptance18810Verdict({ reference, arm: selected, comparison: comparison ?? {}, criteria: manifest.criteria });
  if (!comparison) {
    verdict.met = false;
    verdict.multiSessionSuccess = false;
    verdict.checks = verdict.checks.map((check) => (check.ok ? check : check));
    verdict.reason = `incomplete arms: ${missing.map((item) => item.id).join(", ") || "no reports"}`;
  }
  const substitutionGroups = full && selected ? paired1888(full, selected) : null;
  const substitution = substitutionGroups
    ? substitutionVerdict({
        overall: substitutionGroups.overall,
        powered: Boolean(selected.status === "completed" && statisticallyPowered(substitutionGroups.overall)),
      })
    : "not-a-substitute";
  const sortKeys = (value) =>
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
  const summary = {
    schemaVersion: 1,
    kind: "188.10-heldout-acceptance",
    plan: "188.10",
    metricVersion: METRIC_VERSION,
    protocolVersion: manifest.protocolVersion,
    manifestHash: stableHash({
      ceiling: manifest.ceiling,
      selection: manifest.selection,
      product: manifest.product,
      heldoutV3: manifest.heldoutV3.idsHash,
      jobs: manifest.jobs.map((job) => [job.id, job.config, job.subset, job.maxInputTokens]),
    }),
    selection: manifest.selection,
    heldoutV3: manifest.heldoutV3,
    criteria: manifest.criteria,
    nonInferiorityMargin: manifest.nonInferiorityMargin,
    incomplete: missing.length > 0,
    missing,
    reliability: {
      requiredJobs: manifest.jobs.length,
      completedJobs: reports.size,
      attempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => ["failed", "setup-failure", "abandoned"].includes(attempt.status)).length,
      usageIncompleteAttempts: attempts.filter((attempt) => attempt.usageComplete === false).length,
    },
    arms: Object.fromEntries(["write-x", "x", "x-tools", "full"].map((name) => [name, record(arm(name))])),
    comparison: comparison
      ? {
          baseline: "x",
          candidate: "x-tools",
          multiSession: comparison["multi-session"] ?? null,
          overall: comparison.overall ?? null,
          byAbility: Object.fromEntries(
            Object.entries(comparison).filter(([ability]) => ability !== "multi-session" && ability !== "overall"),
          ),
        }
      : null,
    substitution: substitutionGroups
      ? { baseline: "full", candidate: "x-tools", overall: substitutionGroups.overall, verdict: substitution }
      : null,
    writeCost: writeCostOf(arm("write-x")),
    verdict,
    taskComplete: !missing.length,
  };
  await writeFile(ACCEPTANCE_18810_COMPARISONS, `${JSON.stringify(summary, null, 2)}\n`);
  const row = (label, groups) =>
    Object.entries(sortKeys(groups ?? {})).map(
      ([metric, group]) =>
        `| ${label} | ${metric} | ${group.n} | ${group.diff.toFixed(4)} | [${group.ci95.map((value) => value.toFixed(4)).join(", ")}] | ${group.p.toExponential(3)} |`,
    );
  const lines = [
    "# 188.10 held-out v3 acceptance",
    "",
    `Selected arm: ${manifest.selection.arm} (from ${manifest.selection.path}); product frozen at Stage A (${manifest.product.hash.slice(0, 8)}).`,
    `Required arms: ${manifest.jobs.length}; completed: ${reports.size}; missing: ${missing.length}; attempts: ${attempts.length}.`,
    `Multi-session success: ${verdict.multiSessionSuccess}; ${verdict.reason}.`,
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...verdict.checks.map((check) => `| ${check.id} | ${check.ok ? "pass" : "fail"} | ${check.detail} |`),
    "",
    "| Arm | Ability | n | Diff | 95% CI | p |",
    "| --- | --- | ---: | ---: | --- | ---: |",
    ...row("x-tools-x", comparison),
    ...(substitutionGroups ? row("x-tools-full", { overall: substitutionGroups.overall }) : []),
    "",
    "| Arm | Correct | Input | Cache-read | Tokens/question | Tools/question | Run-limit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...["x", "x-tools", "full"]
      .map((name) => [name, record(arm(name))])
      .filter(([, row]) => row)
      .map(
        ([name, row]) =>
          `| ${name} | ${row.correct}/${row.answers} | ${row.inputTokens} | ${row.cacheReadTokens} | ${row.tokensPerQuestion} | ${row.toolCallsPerQuestion ?? "—"} | ${row.runLimitRate.toFixed(4)} |`,
      ),
    ...(summary.writeCost
      ? [`| write-x | — | ${summary.writeCost.inputTokens} | — | — | — | ${summary.writeCost.perSession} per session |`]
      : []),
    ...missing.map((item) => `- missing completed report: ${item.id}`),
  ];
  await writeFile(ACCEPTANCE_18810_COMPARISONS.replace(/\.json$/, ".md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ verdict: summary.verdict, missing, taskComplete: summary.taskComplete }, null, 2));
}

/* Plan 208 Task 5: the ontology development report, O1-O7 on the development partition only. */
async function main208() {
  const { writeOntologyDevReport } = await import("./ontology-report.mjs");
  const partition = process.argv.includes("--partition") ? process.argv[process.argv.indexOf("--partition") + 1] : undefined;
  try {
    const report = await writeOntologyDevReport({ partition });
    console.log(
      JSON.stringify(
        {
          jobsRead: report.jobsRead,
          rows: Object.fromEntries(Object.entries(report.rows).map(([k, v]) => [k, v.pass ?? v.status ?? null])),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

/* Plan 209 Task 6: the work-outcome development report (W1-W6, plan 208's O8, the no-harm read), dev partition only. */
async function main209() {
  const { writeScreen209Report } = await import("./work-outcome/screen.mjs");
  const partition = process.argv.includes("--partition") ? process.argv[process.argv.indexOf("--partition") + 1] : undefined;
  try {
    const report = await writeScreen209Report({ partition });
    console.log(
      JSON.stringify(
        {
          jobsRead: report.jobsRead.length,
          models: report.models.map((model) => ({
            model: model.model,
            armsMissing: model.armsMissing,
            w3Valid: model.w3Valid,
            rows: Object.fromEntries(Object.entries(model.criteria).map(([k, v]) => [k, v.pass ?? v.skipped ?? null])),
          })),
          noHarm: report.noHarm,
          usd: report.usd,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

/* Plan 210 Task 5: the C-1 ablation report. Every verdict comes from cleanupVerdict() (cleanup-criteria.json). */
async function main210() {
  const { writeC1Report } = await import("./cleanup-campaign.mjs");
  const partition = process.argv.includes("--partition") ? process.argv[process.argv.indexOf("--partition") + 1] : "dev";
  try {
    const report = await writeC1Report({ partition });
    console.log(
      JSON.stringify(
        {
          jobsRead: report.jobs.read.length,
          verdicts: Object.fromEntries(report.verdicts.filter((row) => row.measured).map((row) => [row.feature, row.verdict])),
          predictions: Object.fromEntries(report.predictions.map((row) => [`${row.feature}/${row.arm}`, row.outcome])),
          f4: report.f4.disposition,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
