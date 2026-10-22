#!/usr/bin/env bun
/** Post-campaign acceptance aggregation. Reads only ids/scores/statuses from paid evidence. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import {
  ACCEPTANCE_EVIDENCE,
  ACCEPTANCE_JOURNAL,
  ACCEPTANCE_MANIFEST,
  assertAcceptanceManifest,
  LIFECYCLE_ARMS,
  LIFECYCLE_SEEDS,
  qualityVerdict,
  REQUIRED_LME_CONFIGS,
} from "./acceptance.mjs";
import { stableHash } from "./journal.mjs";
import { summarizeLifecycle } from "./lifecycle/suite.mjs";
import { METRIC_VERSION } from "./metrics.mjs";
import { compare, holm } from "./stats.mjs";

async function reportsFor(jobId) {
  const files = (await readdir(ACCEPTANCE_EVIDENCE)).filter((file) => file.startsWith(`final-${jobId}`) && file.endsWith(".json")).sort();
  const reports = [];
  for (const file of files) reports.push(JSON.parse(await readFile(`${ACCEPTANCE_EVIDENCE}/${file}`, "utf8")));
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

if (import.meta.main) await main();
