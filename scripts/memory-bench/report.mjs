import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { passAtK } from "@arnilo/prism-evals";
import { judgeAgreement } from "./judge.mjs";
import { METRIC_DEFINITIONS, METRIC_VERSION, metricDefinition } from "./metrics.mjs";
import { summarizeOntology } from "./ontology-arm.mjs";
import { compare, holm } from "./stats.mjs";
import { costReport } from "./usage.mjs";

const mean = (sum, n) => (n > 0 ? sum / n : null);
function bump(group, key, value) {
  if (typeof value === "boolean") value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  group[`_${key}Sum`] = (group[`_${key}Sum`] ?? 0) + value;
  group[`_${key}N`] = (group[`_${key}N`] ?? 0) + 1;
}
function finish(group, key) {
  const value = mean(group[`_${key}Sum`] ?? 0, group[`_${key}N`] ?? 0);
  delete group[`_${key}Sum`];
  delete group[`_${key}N`];
  return value;
}
export function summarize(report) {
  report.metricVersion ??= METRIC_VERSION;
  if (["full", "full-truncated"].includes(report.config)) {
    report.comparatorEligibility = {
      completeHistoryQuestions: report.results.filter(
        (row) => row.contextEligibility?.eligible === true && row.contextEligibility.completeHistory === true && row.truncated !== true,
      ).length,
      ineligibleQuestions: report.results.filter(
        (row) => row.outcome === "comparator_ineligible" || row.contextEligibility?.eligible === false,
      ).length,
      truncatedQuestions: report.results.filter((row) => row.truncated === true).length,
      unprovenQuestions: report.results.filter((row) => !row.contextEligibility).length,
    };
  }
  report.abilities = {};
  report.abilityGroups = {};
  for (const row of report.results) {
    for (const [groups, name] of [
      [report.abilities, row.ability],
      [report.abilityGroups, row.ability.startsWith("single-session-") ? "information-extraction" : row.ability],
    ]) {
      const group = (groups[name] ??= { n: 0, correct: 0, scored: 0, f1: null, recallAtK: null });
      group.n++;
      // An answer-only checkpoint row has no verdict yet; accuracy divides by scored rows, not all.
      group.scored += row.correct === undefined ? 0 : 1;
      group.correct += row.correct === true ? 1 : 0;
      bump(group, "runLimitRate", row.outcome === "run_limit");
      bump(group, "errorRate", row.outcome === "error");
      if (row.f1 !== undefined) group.f1 = (group.f1 ?? 0) + row.f1;
      if (typeof row.value === "number") bump(group, "value", row.value);
      if (typeof row.graded === "number") {
        bump(group, "graded", row.graded);
        bump(group, "gradedDisagreement", row.gradedDisagreement === true);
      }
      for (const key of [
        "answerSessionHitAtK",
        "evidenceRoundCoverage",
        "evidenceAllRequired",
        "fineEvidenceRecall",
        "fineEvidencePrecision",
        "retrievalRecallAtK",
      ])
        bump(group, key, typeof row[key] === "boolean" ? Number(row[key]) : row[key]);
    }
  }
  for (const [name, group] of [...Object.entries(report.abilities), ...Object.entries(report.abilityGroups)]) {
    const definition = metricDefinition(name);
    group.accuracy = group.scored ? group.correct / group.scored : null;
    group.runLimitRate = finish(group, "runLimitRate");
    group.errorRate = finish(group, "errorRate");
    if (group.f1 !== null) group.f1 /= group.n;
    group.valueMean = finish(group, "value");
    group.gradedMean = finish(group, "graded");
    group.gradedDisagreementRate = finish(group, "gradedDisagreement");
    group.answerSessionHitAtK = finish(group, "answerSessionHitAtK");
    group.evidenceRoundCoverage = finish(group, "evidenceRoundCoverage");
    group.evidenceAllRequired = finish(group, "evidenceAllRequired");
    group.fineEvidenceRecall = finish(group, "fineEvidenceRecall");
    group.fineEvidencePrecision = finish(group, "fineEvidencePrecision");
    group.legacyRetrievalRecallAtK = finish(group, "retrievalRecallAtK");
    group.recallAtK = group.answerSessionHitAtK ?? group.legacyRetrievalRecallAtK;
    group.metric = name;
    group.definition = definition.definition;
    group.unit = definition.unit;
    group.direction = definition.direction;
  }
  report.metricDefinitions = Object.fromEntries(
    [...new Set(report.results.map((row) => row.ability))].map((name) => [name, metricDefinition(name)]),
  );
  report.runLimitRate = report.results.length
    ? report.results.filter((row) => row.outcome === "run_limit").length / report.results.length
    : 0;
  report.errorRate = report.results.length ? report.results.filter((row) => row.outcome === "error").length / report.results.length : 0;
  report.cacheReadRatio = report.inputTokens ? report.cacheReadTokens / report.inputTokens : 0;
  report.cacheWriteRatio = report.inputTokens ? (report.cacheWriteTokens ?? 0) / report.inputTokens : 0;
  // The lifecycle suite records its own component cost; never overwrite it with the answer-arm model.
  if (!report.cost)
    report.cost = {
      ...costReport(
        {
          inputTokens: report.inputTokens ?? 0,
          cacheReadTokens: report.cacheReadTokens ?? 0,
          cacheWriteTokens: report.cacheWriteTokens ?? 0,
          outputTokens: report.outputTokens ?? 0,
        },
        report.rate ?? null,
        { config: report.config },
      ),
      ratesAsOf: report.ratesAsOf ?? null,
      ratesStatus: report.ratesStatus ?? null,
    };
  if (report.roleUsage) {
    report.cost.measured = report.roleUsage.total.measured;
    report.cost.pricingStatus = report.roleUsage.total.measured === null ? "unpriced" : "priced";
    report.cost.rates = null;
    report.cost.scope = "campaign: product plus evaluation plus unknown historical usage";
    report.cost.product = report.roleUsage.product;
    if (report.roleUsage["product-extract"]?.exchanges > 0) report.cost.productExtract = report.roleUsage["product-extract"];
    if (report.roleUsage["product-ontology"]?.exchanges > 0) report.cost.productOntology = report.roleUsage["product-ontology"];
    report.cost.evaluation = report.roleUsage.evaluation;
    report.cost.cachedPrefixSimulation = null;
    report.cost.simulationAssumption =
      "product warm: full input is a cached prefix; other arms use reported cache tokens; cold reprices input uncached";
  }
  delete report.rate;
  // Plan 202 Task 3: the panel is scored as a panel, not as one judge wearing several names.
  const judgeRefs = report.judgePanel ?? [report.judge];
  if (judgeRefs.length > 1) report.judgeAgreement = judgeAgreement(report.results, judgeRefs);
  if ((report.repeats ?? 1) > 1) {
    const groups = new Map();
    for (const row of report.results) {
      const key = row.baseId ?? row.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const k = report.repeats;
    const drawn = [...groups.values()].filter((rows) => rows.length === k && rows.every((row) => typeof row.correct === "boolean"));
    report.passK = drawn.length ? drawn.reduce((sum, rows) => sum + Number(rows.every((row) => row.correct)), 0) / drawn.length : null;
    report.passAtK = drawn.length
      ? drawn.reduce((sum, rows) => sum + passAtK(k, rows.filter((row) => row.correct).length, k), 0) / drawn.length
      : null;
    const byRepeat = Array.from({ length: k }, (_, index) => {
      const rows = drawn.map((group) => group[index]).filter(Boolean);
      return {
        repeat: index,
        n: rows.length,
        accuracy: rows.length ? rows.filter((row) => row.correct).length / rows.length : null,
      };
    });
    const values = byRepeat.map((row) => row.accuracy).filter((value) => value !== null);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    report.repeatAccuracy = byRepeat;
    report.repeatAccuracySd =
      values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null;
    report.passKDefinition = "mean over questions of all k repeats correct; a missing repeat is excluded, never a pass";
  }
  const injections = report.injections ?? [];
  const labeled = injections.filter((item) => item.label !== null);
  const items = injections.filter((item) => item.granularity === "item");
  // Labels cost one judge call per injected item; a screening run may skip them, but then the
  // precision fields are unavailable and must say so rather than read as zero.
  report.injectionPrecision =
    report.labelInjections === "off"
      ? null
      : {
          granularity: items.length === injections.length && items.length ? "item" : "block",
          tokensPerTurn: report.turns ? report.injectedContextTokens / report.turns : 0,
          irrelevantRate: labeled.length ? labeled.filter((item) => item.label === "irrelevant").length / labeled.length : null,
          citedIdRate: items.length ? items.filter((item) => item.cited).length / items.length : null,
          tokenAccounting: "estimated ceil(characters/4); billing is wire usage",
        };
  report.injectionPrecisionReason = report.labelInjections === "off" ? "not-labelled" : null;
  const totalToolCalls = report.results.reduce((n, row) => n + (row.toolCalls ?? 0), 0);
  const totalRecallCalls = report.results.reduce((n, row) => n + (row.recallCalls ?? 0), 0);
  const totalSnippetTokens = report.results.reduce((n, row) => n + (row.retrievedSnippetTokens ?? 0), 0);
  report.toolCalls = totalToolCalls;
  report.toolCallsPerQuestion = report.results.length ? totalToolCalls / report.results.length : 0;
  report.recallCalls = totalRecallCalls;
  report.retrievedSnippetTokens = totalSnippetTokens;
  const metricRows = (key) =>
    report.results.filter((row) => typeof row[key] === "boolean" || (typeof row[key] === "number" && Number.isFinite(row[key])));
  const metricMean = (key) => {
    const rows = metricRows(key);
    return rows.length ? rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length : null;
  };
  report.answerSessionHitAtK = metricMean("answerSessionHitAtK");
  report.evidenceRoundCoverage = metricMean("evidenceRoundCoverage");
  report.evidenceAllRequired = metricMean("evidenceAllRequired");
  report.fineEvidenceRecall = metricMean("fineEvidenceRecall");
  report.fineEvidencePrecision = metricMean("fineEvidencePrecision");
  report.legacyRetrievalRecallAtK = metricMean("retrievalRecallAtK");
  report.retrievalRecallAtK = report.answerSessionHitAtK ?? report.legacyRetrievalRecallAtK;
  const ontologySummary = summarizeOntology(report.results);
  if (ontologySummary) report.ontologySummary = ontologySummary;
  const staged = report.results.filter((row) => typeof row.stage === "string");
  if (staged.length) {
    report.stages = {};
    for (const row of staged) report.stages[row.stage] = (report.stages[row.stage] ?? 0) + 1;
  }

  return report;
}
/** One line of timing evidence: wall time, per-question spread and per-role call latency. */
export function describeTiming(timing) {
  if (!timing) return "Timing: not recorded.";
  const questions = timing.questions?.wallMs;
  const roles = Object.entries(timing.roles ?? {})
    .map(([role, value]) => `${role} ${value.calls}x p50 ${value.totalMs.p50 ?? "n/a"}ms`)
    .join(", ");
  return `Timing: arm ${timing.wallMs ?? "n/a"} ms at concurrency ${timing.concurrency?.active ?? "n/a"} (initial ${timing.concurrency?.initial ?? "n/a"}); end-to-end questions p50 ${questions?.p50 ?? "n/a"} ms / p95 ${questions?.p95 ?? "n/a"} ms; ${[
    "ingestion",
    "restore",
    ...(timing.phases?.ontologySettle ? ["ontologySettle"] : []),
    "answer",
    "evaluation",
  ]
    .map((name) => {
      const phase = timing.phases?.[name];
      return `${name} n=${phase?.n ?? 0} p50/p95/mean ${phase?.wallMs?.p50 ?? "n/a"}/${phase?.wallMs?.p95 ?? "n/a"}/${phase?.wallMs?.mean ?? "n/a"} ms`;
    })
    .join("; ")}; ${roles || "no calls"}.`;
}

async function writeArtifact(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function writeReport(report, path) {
  if (!path.endsWith(".json")) throw new Error("MemoryBenchArguments: output must end in .json");
  await mkdir(dirname(path), { recursive: true });
  await writeArtifact(path, `${JSON.stringify(report, null, 2)}\n`);
  const rows = Object.entries(report.abilities).map(
    ([ability, score]) =>
      `| ${ability} | ${score.n} | ${score.accuracy === null ? "n/a" : score.accuracy.toFixed(4)} | ${score.f1 ?? "n/a"} | ${score.recallAtK !== null && score.recallAtK !== undefined ? score.recallAtK.toFixed(4) : "n/a"} | ${score.evidenceRoundCoverage ?? "n/a"} | ${score.evidenceAllRequired ?? "n/a"} | ${score.runLimitRate.toFixed(4)} |`,
  );
  const gradedRows = Object.entries(report.abilities)
    .filter(([, score]) => score.gradedMean !== null && score.gradedMean !== undefined)
    .map(
      ([ability, score]) =>
        `| ${ability} | ${score.n} | ${score.gradedMean.toFixed(4)} | ${score.accuracy === null ? "n/a" : score.accuracy.toFixed(4)} | ${(score.gradedDisagreementRate ?? 0).toFixed(4)} |`,
    );
  await writeArtifact(
    path.replace(/\.json$/, ".md"),
    `${[
      `# Memory benchmark: ${report.suite} / ${report.config}`,
      "",
      `Status: ${report.status}. Input: ${report.inputTokens}; cache read: ${report.cacheReadTokens}; ratio: ${report.cacheReadRatio.toFixed(4)}.`,
      `Attempt: ${report.attemptId ?? "none"}; usage complete: ${report.usageComplete !== false}; resumed results: ${report.resumedResults ?? 0}.`,
      `Tool calls: ${report.toolCalls ?? 0} (${(report.toolCallsPerQuestion ?? 0).toFixed(2)}/q); recall calls: ${report.recallCalls ?? 0}; snippet tokens: ${report.retrievedSnippetTokens ?? 0}; recall@k: ${report.retrievalRecallAtK !== null && report.retrievalRecallAtK !== undefined ? report.retrievalRecallAtK.toFixed(4) : "n/a"}.`,
      `Judge: ${report.judge}. Truncated questions: ${report.results.filter((row) => row.truncated).length}. Metric version: ${report.metricVersion ?? "historical"}.`,
      `Phase: ${report.phase ?? "all"}. ${describeTiming(report.timing)}`,
      ...(report.roleUsage
        ? [
            `USD: campaign ${report.roleUsage.total.measured ?? "unknown"}; product measured/cold/warm ${report.roleUsage.product.measured ?? "unknown"}/${report.roleUsage.product.cold ?? "unknown"}/${report.roleUsage.product.warm ?? "unknown"}; evaluation ${report.roleUsage.evaluation.measured ?? "unknown"}.`,
          ]
        : []),
      ...(report.roleUsage?.["product-extract"]?.exchanges > 0
        ? [
            `Extractor (product-extract): ${report.roleUsage["product-extract"].exchanges} exchanges; input ${report.roleUsage["product-extract"].inputTokens}, cache read ${report.roleUsage["product-extract"].cacheReadTokens}, cache write ${report.roleUsage["product-extract"].cacheWriteTokens}; measured USD ${report.roleUsage["product-extract"].measured ?? "unknown"}.`,
          ]
        : []),
      ...(report.ontologySummary
        ? [
            `Ontology (${report.ontology?.arm ?? "ontology"}): ${report.ontologySummary.histories} histories; ${report.ontologySummary.concepts} concepts, ${report.ontologySummary.claims} claims (${report.ontologySummary.claimsPerConcept?.toFixed(2) ?? "n/a"} per concept); bound-note share ${report.ontologySummary.boundNoteShare?.toFixed(3) ?? "n/a"}; ${report.ontologySummary.passes} passes, ${report.ontologySummary.modelCalls} model calls, ${report.ontologySummary.repairs} repairs; rejected trust/secret/invalid ${report.ontologySummary.rejected.trust}/${report.ontologySummary.rejected.secret}/${report.ontologySummary.rejected.invalid}; settle p50/p95/max ${report.ontologySummary.settle.p50Ms ?? "n/a"}/${report.ontologySummary.settle.p95Ms ?? "n/a"}/${report.ontologySummary.settle.maxMs ?? "n/a"} ms (not in answer latency), ${report.ontologySummary.settle.timeouts} timeouts; concept stage ${JSON.stringify(report.ontologySummary.conceptStages.all)}.`,
          ]
        : []),
      ...(report.roleUsage?.["product-ontology"]?.exchanges > 0
        ? [
            `Curator (product-ontology): ${report.roleUsage["product-ontology"].exchanges} exchanges; input ${report.roleUsage["product-ontology"].inputTokens}, output ${report.roleUsage["product-ontology"].outputTokens}, cache read ${report.roleUsage["product-ontology"].cacheReadTokens}, cache write ${report.roleUsage["product-ontology"].cacheWriteTokens}; measured USD ${report.roleUsage["product-ontology"].measured ?? "unknown"}.`,
          ]
        : []),
      "",
      "Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;",
      "evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold",
      "recall/precision stay n/a when the dataset does not expose usable fine gold.",
      "",
      "| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows,
      "",
      ...(gradedRows.length
        ? [
            "Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):",
            "",
            "| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |",
            "| --- | ---: | ---: | ---: | ---: |",
            ...gradedRows,
            "",
          ]
        : []),
      ...(report.coding
        ? [
            "| Coding metric | Prism |",
            "| --- | ---: |",
            ...Object.entries(report.metrics ?? {}).map(([name, value]) => `| ${name} | ${value ?? "n/a"} |`),
            "",
            "Paper baselines (descriptive context):",
            "",
            ...report.coding.baselines.map((row) => `- ${JSON.stringify(row)}`),
            "",
            `Source: ${report.coding.baselineSource}`,
            "",
            report.coding.comparability,
            ...(report.coding.access.available ? [] : ["", `Availability (${report.coding.access.date}): ${report.coding.access.reason}`]),
            "",
          ]
        : []),
      ...(report.suite === "lifecycle"
        ? [
            "| Lifecycle metric | Value | Unit | Direction | Definition |",
            "| --- | ---: | --- | --- | --- |",
            ...Object.entries(report.metrics).map(([name, value]) => {
              const definition = report.metricDefinitions?.[name] ?? METRIC_DEFINITIONS[name] ?? metricDefinition(name);
              return `| ${name} | ${value ?? "n/a"} | ${definition.unit} | ${definition.direction} | ${definition.definition} |`;
            }),
            "",
            `Sessions: ${report.sessions.length}; persona mode: ${report.persona}; seed: ${report.seed}. Metric version: ${report.metricVersion ?? "historical"}. Clusters: ${report.clusterUnit ?? "row"} (${report.clusters ?? "n/a"}); project stores share persona-level user/agent state.`,
            ...report.limitations.map((text) => `- ${text}`),
            "",
          ]
        : []),
      "Memory injection token counts are estimates; item text and dataset text are excluded from evidence.",
    ].join("\n")}\n`,
  );
}
/** Each candidate versus the same baseline; every ability belongs to this family. */
/**
 * Plan 202 Task 3: the arm difference under each judge, not only under the panel majority. Only ids
 * both arms and that judge scored survive, so a missing verdict can never look like a loss.
 */
export function compareJudges(a, b, options = {}) {
  const refs = (a.judgePanel ?? []).filter((ref) => (b.judgePanel ?? []).includes(ref));
  return Object.fromEntries(
    refs.map((ref) => {
      const right = new Map((b.results ?? []).map((row) => [row.id, row]));
      const ids = (a.results ?? [])
        .filter((row) => row.judgeVerdicts?.[ref] && right.get(row.id)?.judgeVerdicts?.[ref])
        .map((row) => row.id);
      const leftRows = ids.map((id) => a.results.find((row) => row.id === id));
      const rightRows = ids.map((id) => right.get(id));
      if (!ids.length) return [ref, null];
      return [
        ref,
        compare(
          { ...a, results: leftRows.map((row) => ({ ...row, correct: row.judgeVerdicts[ref] === "yes" })) },
          { ...b, results: rightRows.map((row) => ({ ...row, correct: row.judgeVerdicts[ref] === "yes" })) },
          options,
        ),
      ];
    }),
  );
}

export function compareFamily(baseline, candidates, options) {
  const comparisons = candidates.map((candidate) => compare(baseline, candidate, options));
  const groups = comparisons.flatMap((comparison) => Object.values(comparison));
  const adjusted = holm(groups.map((group) => group.p));
  groups.forEach((group, i) => {
    group.pHolm = adjusted[i];
  });
  return comparisons;
}
if (import.meta.main) {
  const [flag, baseline, ...candidates] = process.argv.slice(2);
  if (flag !== "--compare" || !baseline || !candidates.length)
    throw new Error("Usage: report.mjs --compare baseline.json candidate.json [candidate.json ...]");
  const reports = await Promise.all([baseline, ...candidates].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const comparisons = compareFamily(reports[0], reports.slice(1));
  console.log(JSON.stringify(comparisons.length === 1 ? comparisons[0] : comparisons, null, 2));
}
