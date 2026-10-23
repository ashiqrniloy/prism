import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { METRIC_DEFINITIONS, METRIC_VERSION, metricDefinition } from "./metrics.mjs";
import { compare, holm } from "./stats.mjs";

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

  return report;
}
/** One line of timing evidence: wall time, per-question spread and per-role call latency. */
export function describeTiming(timing) {
  if (!timing) return "Timing: not recorded.";
  const questions = timing.questions?.wallMs;
  const roles = Object.entries(timing.roles ?? {})
    .map(([role, value]) => `${role} ${value.calls}x p50 ${value.totalMs.p50 ?? "n/a"}ms`)
    .join(", ");
  return `Timing: arm ${timing.wallMs ?? "n/a"} ms at concurrency ${timing.concurrency?.active ?? "n/a"} (initial ${timing.concurrency?.initial ?? "n/a"}); questions p50 ${questions?.p50 ?? "n/a"} ms / p95 ${questions?.p95 ?? "n/a"} ms; ${roles || "no calls"}.`;
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
      "",
      "Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;",
      "evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold",
      "recall/precision stay n/a when the dataset does not expose usable fine gold.",
      "",
      "| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows,
      "",
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
