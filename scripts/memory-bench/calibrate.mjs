#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_PROMOTION_MIN_SCORE, DEFAULT_PROMOTION_WEIGHTS } from "../../packages/memory/fabric/src/consolidation/score.ts";

export function calibrateInjection(items, { minBinN = 20, auditedGold = false } = {}) {
  if (!Number.isSafeInteger(minBinN) || minBinN < 1) throw new Error("CalibrationMinBinN");
  const bins = Array.from({ length: 10 }, (_, i) => ({ floor: i / 10, n: 0, used: 0 }));
  let excluded = 0;
  for (const item of items) {
    if (item.coverage === null || item.coverage === undefined || !["used", "irrelevant"].includes(item.label)) {
      excluded++;
      continue;
    }
    if (!Number.isFinite(item.coverage) || item.coverage < 0 || item.coverage > 1) throw new Error("CalibrationCoverage");
    const bin = bins[Math.min(9, Math.floor(item.coverage * 10))];
    bin.n++;
    bin.used += Number(item.label === "used");
  }
  for (const bin of bins) bin.usedRate = bin.n ? bin.used / bin.n : null;
  const threshold = (bin) => bin.usedRate !== null && bin.usedRate >= 0.5;
  const floor = bins.find(threshold)?.floor ?? null;
  // A sparse or unaudited bin may be a descriptive hint, never a production default.
  const eligibleFloor = bins.find((bin) => bin.n >= minBinN && threshold(bin))?.floor ?? null;
  return {
    floor,
    eligibleFloor,
    defaultEligible: auditedGold && eligibleFloor !== null,
    minBinN,
    auditedGold,
    bins,
    excluded,
  };
}

export function calibrateConsolidation(pairs, { mode = "lexical" } = {}) {
  if (!["lexical", "hybrid"].includes(mode)) throw new Error("CalibrationMode");
  const metric = mode === "lexical" ? "dice" : "cosine";
  if (
    pairs.some(
      (row) =>
        !Number.isFinite(row[metric]) || row[metric] < (mode === "hybrid" ? -1 : 0) || row[metric] > 1 || typeof row.sameNote !== "boolean",
    )
  )
    throw new Error("CalibrationPairs");
  const table = [...new Set([0, ...pairs.map((row) => row[metric]).filter((score) => score >= 0)])]
    .sort((a, b) => a - b)
    .map((threshold) => {
      let tp = 0,
        fp = 0,
        fn = 0;
      for (const row of pairs) {
        if (row[metric] >= threshold) row.sameNote ? tp++ : fp++;
        else if (row.sameNote) fn++;
      }
      return {
        threshold,
        tp,
        fp,
        fn,
        precision: tp + fp ? tp / (tp + fp) : null,
        recall: tp + fn ? tp / (tp + fn) : null,
        f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0,
      };
    });
  // Precision breaks F1 ties; the more conservative threshold breaks the remaining tie.
  const selected =
    table.filter((row) => row.precision >= 0.9).sort((a, b) => b.f1 - a.f1 || b.precision - a.precision || b.threshold - a.threshold)[0] ??
    null;
  return { mode, threshold: selected?.threshold ?? null, selected, table };
}

export function calibratePromotion(rows, { audit } = {}) {
  const keys = Object.keys(DEFAULT_PROMOTION_WEIGHTS);
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        typeof row.persona !== "string" ||
        !row.persona.trim() ||
        typeof row.label !== "boolean" ||
        keys.some((key) => !Number.isFinite(row.signals?.[key]) || row.signals[key] < 0 || row.signals[key] > 1),
    )
  )
    throw new Error("CalibrationPromotionRows");
  const personas = [...new Set(rows.map((row) => row.persona))].sort();
  if (personas.length < 2) throw new Error("Calibration requires at least two personas");
  const heldoutPersonas = personas.filter((_, index) => (index + 1) % 5 === 0);
  if (!heldoutPersonas.length) heldoutPersonas.push(personas.at(-1));
  const heldoutSet = new Set(heldoutPersonas);
  const train = rows.filter((row) => !heldoutSet.has(row.persona));
  const heldout = rows.filter((row) => heldoutSet.has(row.persona));
  const score = (row, weights) => keys.reduce((sum, key) => sum + row.signals[key] * weights[key], 0);
  // Match scorePromotion's hard gates and explicit bypass on already-computed signals.
  const accepted = (row, value, minScore) =>
    row.signals.derivability !== 1 && (row.signals.explicit === 1 || (row.signals.ephemerality !== 1 && value >= minScore));
  const evaluate = (items, weights, minScore) => {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const row of items) {
      if (accepted(row, score(row, weights), minScore)) row.label ? tp++ : fp++;
      else if (row.label) fn++;
    }
    return {
      n: items.length,
      tp,
      fp,
      fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0,
    };
  };
  const better = (a, b) =>
    a &&
    (!b ||
      a.train.f1 > b.train.f1 ||
      (a.train.f1 === b.train.f1 &&
        (a.train.precision > b.train.precision || (a.train.precision === b.train.precision && a.minScore > b.minScore))));
  const fit = (weights) => {
    const values = train.map((row) => score(row, weights));
    const thresholds = [
      ...new Set([DEFAULT_PROMOTION_MIN_SCORE, values.reduce((max, value) => Math.max(max, value), -Infinity) + 1, ...values]),
    ].sort((a, b) => a - b);
    let best = null;
    for (const minScore of thresholds) {
      const candidate = { weights, minScore, train: evaluate(train, weights, minScore) };
      if (candidate.train.precision !== null && candidate.train.precision >= 0.8 && better(candidate, best)) best = candidate;
    }
    return best;
  };
  let selected = fit({ ...DEFAULT_PROMOTION_WEIGHTS });
  // A bounded coordinate search calibrates each shipped term without an exponential grid.
  for (let pass = 0; pass < 2; pass++)
    for (const key of keys) {
      const base = selected?.weights ?? DEFAULT_PROMOTION_WEIGHTS;
      for (const multiplier of [0, 0.5, 1, 2]) {
        const candidate = fit({ ...base, [key]: DEFAULT_PROMOTION_WEIGHTS[key] * multiplier });
        if (better(candidate, selected)) selected = candidate;
      }
    }
  const checkedAudit = audit ? { n: audit.n, kappa: audit.kappa, errorRate: audit.errorRate, provisional: audit.provisional } : null;
  if (
    checkedAudit &&
    (!Number.isSafeInteger(checkedAudit.n) ||
      checkedAudit.n < 0 ||
      typeof checkedAudit.provisional !== "boolean" ||
      (checkedAudit.kappa !== null && (!Number.isFinite(checkedAudit.kappa) || Math.abs(checkedAudit.kappa) > 1)) ||
      (checkedAudit.errorRate !== null &&
        (!Number.isFinite(checkedAudit.errorRate) || checkedAudit.errorRate < 0 || checkedAudit.errorRate > 1)))
  )
    throw new Error("CalibrationGoldAudit");
  return {
    precisionFloor: 0.8,
    search: "two coordinate passes; each default weight multiplied by 0, 0.5, 1 or 2",
    split: { train: personas.filter((persona) => !heldoutSet.has(persona)), heldout: heldoutPersonas },
    audit: checkedAudit,
    provisional: !checkedAudit || checkedAudit.provisional || !checkedAudit.n || checkedAudit.kappa === null || checkedAudit.kappa < 0.6,
    selected,
    heldout: selected ? evaluate(heldout, selected.weights, selected.minScore) : null,
    baseline: {
      weights: DEFAULT_PROMOTION_WEIGHTS,
      minScore: DEFAULT_PROMOTION_MIN_SCORE,
      train: evaluate(train, DEFAULT_PROMOTION_WEIGHTS, DEFAULT_PROMOTION_MIN_SCORE),
      heldout: evaluate(heldout, DEFAULT_PROMOTION_WEIGHTS, DEFAULT_PROMOTION_MIN_SCORE),
    },
  };
}

export function calibrateRetention(reports) {
  const table = reports.map((report) => {
    const { archiveRegret, graveyardIndex } = report.metrics ?? {};
    if (
      !/^[a-f0-9]{64}$/.test(report.policyHash ?? "") ||
      [archiveRegret, graveyardIndex].some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
    )
      throw new Error("CalibrationRetention");
    return {
      policyHash: report.policyHash,
      archiveRegret,
      graveyardIndex,
      feasible: report.status === "completed" && archiveRegret !== null && graveyardIndex !== null && archiveRegret <= 0.02,
    };
  });
  const selected =
    table
      .filter((row) => row.feasible)
      .sort(
        (a, b) => a.graveyardIndex - b.graveyardIndex || a.archiveRegret - b.archiveRegret || a.policyHash.localeCompare(b.policyHash),
      )[0] ?? null;
  return { regretLimit: 0.02, selected, table };
}

export async function calibrateFiles({ kind, pairs, reports, goldReport, mode = "lexical" }) {
  if (kind === "retention") {
    if (!reports?.length) throw new Error("Calibration requires replay reports");
    const runs = (await Promise.all(reports.map(async (path) => JSON.parse(await readFile(path, "utf8"))))).flat();
    if (runs.some((run) => run.suite !== "lifecycle-replay" || run.calls?.extractor !== 0))
      throw new Error("Calibration requires warm replay reports");
    return {
      kind,
      provisional: true,
      ...calibrateRetention(runs),
      limitations: [
        "In-sample search on the supplied policies and probes; construction replay cannot establish production retention or capacity defaults.",
      ],
    };
  }
  if (kind === "promotion") {
    if (!pairs || !goldReport) throw new Error("Calibration requires pairs and gold-report");
    const gold = JSON.parse(await readFile(goldReport, "utf8"));
    const rows = (await readFile(pairs, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const audit = gold.fields?.shouldPromote;
    if (!/^[a-f0-9]{64}$/.test(gold.dataset ?? "") || !audit || !["synthetic-construction", "judge-panel"].includes(gold.provenance))
      throw new Error("CalibrationGoldAudit");
    const result = calibratePromotion(rows, { audit });
    return {
      kind,
      dataset: gold.dataset,
      provenance: gold.provenance,
      ...result,
      provisional:
        result.provisional || gold.provenance === "synthetic-construction" || gold.provisional !== false || gold.status !== "complete",
      limitations: [
        "Only training personas select weights and minScore. Held-out labels are evaluated once; construction or unaudited gold cannot establish production defaults.",
      ],
    };
  }
  if (kind === "consolidation") {
    if (!pairs || !goldReport) throw new Error("Calibration requires pairs and gold-report");
    const gold = JSON.parse(await readFile(goldReport, "utf8"));
    const rows = (await readFile(pairs, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const field = gold.duplicateAudit?.fields?.sameNote;
    if (
      !/^[a-f0-9]{64}$/.test(gold.dataset ?? "") ||
      !field ||
      !Number.isSafeInteger(field.n) ||
      field.n < 0 ||
      typeof field.provisional !== "boolean" ||
      !["synthetic-construction", "judge-panel"].includes(gold.provenance) ||
      (field.kappa !== null && (!Number.isFinite(field.kappa) || field.kappa < -1 || field.kappa > 1)) ||
      (field.errorRate !== null && (!Number.isFinite(field.errorRate) || field.errorRate < 0 || field.errorRate > 1))
    )
      throw new Error("CalibrationGoldAudit");
    const audit = { n: field.n, kappa: field.kappa, errorRate: field.errorRate, provisional: field.provisional };
    return {
      kind,
      dataset: gold.dataset,
      provenance: gold.provenance,
      audit,
      provisional:
        gold.provenance === "synthetic-construction" ||
        gold.provisional !== false ||
        gold.status !== "complete" ||
        audit.provisional ||
        !audit.n ||
        audit.kappa === null ||
        audit.kappa < 0.6,
      ...calibrateConsolidation(rows, { mode }),
      limitations: ["In-sample F1 on the supplied Dice-stratified pairs; not a population estimate or a production-default verdict."],
    };
  }
  if (kind === "injection") {
    if (!reports?.length) throw new Error("Calibration requires reports");
    const runs = await Promise.all(reports.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
    if (runs.some((run) => !Array.isArray(run.injections) || run.memoryConfig?.fabric?.retrieval !== "lexical"))
      throw new Error("Calibration requires lexical reports");
    return {
      kind,
      provisional: true,
      ...calibrateInjection(
        runs.flatMap((run) => run.injections),
        {
          auditedGold: runs.every((run) => run.goldAudited === true),
        },
      ),
      runs: runs.map((run) => ({ suite: run.suite, config: run.config, provider: run.provider, model: run.model, status: run.status })),
      limitations: [
        "Observed injected hits only; floors below the collection floor are unmeasured. Judge-used labels do not prove causal benefit. Validate a proposed floor in a paired live arm.",
      ],
    };
  }
  throw new Error("CalibrationKind");
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(["kind", "pairs", "reports", "gold-report", "mode", "output"].map((key) => [key, { type: "string" }])),
      strict: true,
    });
    const result = await calibrateFiles({ ...values, reports: values.reports?.split(","), goldReport: values["gold-report"] });
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, text);
    } else console.log(text);
  } catch {
    console.error("Memory calibration failed; check arguments, scores and gold audit report");
    process.exitCode = 1;
  }
}
