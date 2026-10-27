import { EvalError } from "./errors.js";
import { HARD_STATS_RESAMPLES } from "./limits.js";
import { benjaminiHochberg, bootstrapInterval, mcnemarExact, pairedPermutationTest } from "./stats.js";
import type { CompareExperimentsOptions, ExperimentComparison, ExperimentReport } from "./types.js";

function paired(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EvalError(message, "ERR_PRISM_EVAL_COMPARE_UNPAIRED");
}
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function itemsByTag(report: ExperimentReport) {
  const groups = new Map<string, ExperimentReport["items"][number][]>();
  for (const item of report.items) for (const tag of new Set(item.item.tags ?? [])) {
    const items = groups.get(tag) ?? [];
    items.push(item);
    groups.set(tag, items);
  }
  return groups;
}


function indexItems(report: ExperimentReport) {
  const items = new Map<string, Map<string, number[]>>();
  for (const item of report.items) {
    paired(typeof item.item.id === "string" && item.item.id.length && !items.has(item.item.id), "Comparison requires unique nonempty item ids");
    const scores = new Map<string, number[]>();
    for (const row of item.evaluations) {
      // Failed/skipped records are not numeric observations.
      if (row.status !== "scored") continue;
      paired(typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1,
        `Invalid score for ${row.scorerId} on item ${item.item.id}`);
      const values = scores.get(row.scorerId) ?? [];
      values.push(row.score);
      scores.set(row.scorerId, values);
    }
    items.set(item.item.id, scores);
  }
  return items;
}

/** Miller (2024), §4: pair item means, bootstrap their differences, and control FDR across scorers.
 * Positive differences favor the candidate. Unshared items are excluded; missing paired scores fail closed.
 */
export function compareExperiments(
  baseline: ExperimentReport, candidate: ExperimentReport, options: CompareExperimentsOptions = {},
): ExperimentComparison {
  const { seed = 0, resamples, alpha = .05 } = options;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1 || !Number.isSafeInteger(seed)
    || (resamples !== undefined && (!Number.isSafeInteger(resamples) || resamples < 1 || resamples > HARD_STATS_RESAMPLES))) {
    throw new EvalError("Comparison requires alpha in (0, 1), an integer seed, and valid resamples", "ERR_PRISM_EVAL_STATS");
  }
  paired(baseline.datasetContentHash === candidate.datasetContentHash, "Comparison requires matching dataset content hashes");
  paired(baseline.datasetId === candidate.datasetId, "Comparison requires matching dataset ids");
  paired(baseline.datasetVersion === undefined || candidate.datasetVersion === undefined
    || baseline.datasetVersion === candidate.datasetVersion, "Comparison requires matching dataset versions");
  paired(!baseline.manifest || !candidate.manifest || baseline.manifest.datasetVersion === candidate.manifest.datasetVersion,
    "Comparison requires matching manifest dataset versions");
  const left = indexItems(baseline), right = indexItems(candidate);
  const singleTrial = [baseline, candidate].every(report =>
    (report.trials?.count ?? 1) === 1 && report.items.every(item => item.trials.length <= 1));
  const ids = [...left.keys()].filter(id => right.has(id)).sort();
  paired(ids.length >= 2, "Comparison requires at least two paired items");
  const scorerIds = options.scorers ?? [...new Set([...left.values(), ...right.values()].flatMap(scores => [...scores.keys()]))].sort();
  paired(scorerIds.length > 0 && new Set(scorerIds).size === scorerIds.length
    && scorerIds.every(id => typeof id === "string" && id.length > 0), "Comparison requires distinct nonempty scorer ids");
  const entries = scorerIds.map(id => {
    const a: number[] = [], b: number[] = [];
    let binary = singleTrial, aOnly = 0, bOnly = 0;
    for (const itemId of ids) {
      const x = left.get(itemId)!.get(id), y = right.get(itemId)!.get(id);
      paired(x?.length && y?.length, `Missing scorer ${id} on paired item ${itemId}`);
      const xMean = mean(x), yMean = mean(y);
      a.push(xMean);
      b.push(yMean);
      binary &&= x.length === 1 && y.length === 1 && (xMean === 0 || xMean === 1) && (yMean === 0 || yMean === 1);
      if (xMean === 1 && yMean === 0) aOnly++;
      if (xMean === 0 && yMean === 1) bOnly++;
    }
    const differences = b.map((value, i) => value - a[i]!);
    return [id, {
      baselineMean: mean(a), candidateMean: mean(b), difference: mean(differences),
      ci95: bootstrapInterval(differences, { statistic: mean, seed, resamples }),
      pValue: binary ? mcnemarExact(aOnly, bOnly) : pairedPermutationTest(differences, { seed, resamples }),
      test: binary ? "mcnemar" as const : "paired_permutation" as const,
    }] as const;
  });
  const qValues = benjaminiHochberg(entries.map(([, stats]) => stats.pValue));
  const byTag: Record<string, ExperimentComparison> = Object.create(null);
  if (options.byTag) {
    const aTags = itemsByTag(baseline), bTags = itemsByTag(candidate);
    for (const tag of [...aTags.keys()].sort()) {
      const a = aTags.get(tag)!;
      const b = bTags.get(tag) ?? [];
      const rightIds = new Set(b.map(item => item.item.id));
      if (a.filter(item => rightIds.has(item.item.id)).length < 2) continue;
      byTag[tag] = compareExperiments({ ...baseline, items: a }, { ...candidate, items: b }, { ...options, byTag: false });
    }
    const stats = Object.values(byTag).flatMap(tag => Object.values(tag.scorers));
    const adjusted = benjaminiHochberg(stats.map(row => row.pValue));
    let index = 0;
    for (const [tag, comparison] of Object.entries(byTag)) {
      byTag[tag] = { ...comparison, scorers: Object.fromEntries(Object.entries(comparison.scorers).map(([id, row]) => {
        const qValue = adjusted[index++]!;
        return [id, { ...row, qValue, significant: qValue <= alpha }];
      })) };
    }
  }
  return { ...(options.byTag ? { byTag } : {}), pairedItems: ids.length, scorers: Object.fromEntries(entries.map(([id, stats], i) =>
    [id, { ...stats, qValue: qValues[i]!, significant: qValues[i]! <= alpha }])) };
}
