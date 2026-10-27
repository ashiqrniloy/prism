import { toExperimentReportRecord } from "./report-record.js";
import type { EvaluationRecord } from "@arnilo/prism";
import { type Message, type RunResult, type Usage } from "@arnilo/prism";
import { fleissKappa, bootstrapInterval, clusteredStandardError, passAtK, passHatK, wilsonInterval } from "./stats.js";
import { validateSplit } from "./dataset.js";
import { EvalDatasetError, EvalError } from "./errors.js";
import { loadTimeline } from "./timeline.js";
import { executeScenario, isScenarioInput, validateScenario } from "./scenario-runner.js";
import { collectWhileRunning, mulberry32, resolveTrialsConfig, validateEvalManifest } from "./scenarios.js";
import { checkRequirements, defaultToAgentInput, scoreRun, skipScorers } from "./score.js";
import type {
  DatasetItem,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  ExperimentTrials,
  RunExperimentOptions,
  ScorerStats,
  TimelineFolder,
  ExecutionTimeline,
  UserSimulation,
} from "./types.js";
import { assertFiniteUnitInterval, hash32, mapPool, normalizeConcurrency, randomId, toErrorInfo } from "./util.js";

function aggregateEvaluations(
  evaluations: readonly EvaluationRecord[], passThresholds: ReadonlyMap<string, number>,
  trialCount: number, itemCount: number, seed = 0,
): ExperimentAggregate {
  const scored = evaluations.filter((record) => record.status === "scored" && record.score !== undefined);
  const groups = new Map<string, Map<string, number[]>>();
  const panelLabels = new Map<string, string[][]>();
  for (const record of scored) {
    const items = groups.get(record.scorerId) ?? new Map<string, number[]>();
    const values = items.get(record.itemId!) ?? [];
    values.push(record.score!);
    items.set(record.itemId!, values);
    groups.set(record.scorerId, items);
    const labels = record.metadata?.labels;
    // Fleiss requires complete, equally sized rating rows; failed/unlabeled members stay null.
    if (Array.isArray(labels) && labels.length >= 2 && labels.every(label => typeof label === "string" && label.trim())) {
      const rows = panelLabels.get(record.scorerId) ?? [];
      if (!rows.length || rows[0]!.length === labels.length) rows.push(labels);
      panelLabels.set(record.scorerId, rows);
    }
  }
  const scorers = Object.fromEntries([...groups].map(([id, items]): [string, ScorerStats] => {
    const values = [...items.values()];
    const means = values.map(scores => scores.reduce((sum, score) => sum + score, 0) / scores.length);
    const mean = means.reduce((sum, score) => sum + score, 0) / means.length;
    const records = values.reduce((sum, scores) => sum + scores.length, 0);
    const threshold = passThresholds.get(id)!;
    const successes = values.map(scores => scores.filter(score => score >= threshold).length);
    const passRate = successes.reduce((sum, c, i) => sum + c / values[i]!.length, 0) / items.size;
    const reliability: Pick<ScorerStats, "passRate" | "passAtK" | "passHatK" | "passKCounts"> = { passRate };
    const judgeAgreement = fleissKappa(panelLabels.get(id) ?? []);
    const agreement = judgeAgreement === undefined ? {} : { judgeAgreement };
    if (trialCount > 1) {
      const at: Record<number, number> = {}, hat: Record<number, number> = {};
      const counts: Record<number, { items: number; excludedItems: number }> = {};
      for (let k = 1; k <= trialCount; k++) counts[k] = { items: 0, excludedItems: itemCount };
      for (let i = 0; i < values.length; i++) {
        const n = values[i]!.length, c = successes[i]!;
        let atK = passAtK(n, c, 1), hatK = passHatK(n, c, 1);
        for (let k = 1; k <= Math.min(n, trialCount); k++) {
          // Extend the estimators by one draw, computing all k in O(n).
          if (k > 1) {
            atK = n - c < k ? 1 : atK + (1 - atK) * c / (n - k + 1);
            hatK = c < k ? 0 : hatK * (c - k + 1) / (n - k + 1);
          }
          at[k] = (at[k] ?? 0) + atK;
          hat[k] = (hat[k] ?? 0) + hatK;
          counts[k]!.items++;
          counts[k]!.excludedItems--;
        }
      }
      for (const key of Object.keys(at)) {
        const k = Number(key);
        at[k] = at[k]! / counts[k]!.items;
        hat[k] = hat[k]! / counts[k]!.items;
      }
      Object.assign(reliability, { passAtK: at, passHatK: hat, passKCounts: counts });
    }
    if (items.size < 2) return [id, { items: items.size, records, mean, ...reliability, ...agreement, method: "single_item" }];
    const binary = values.every(scores => scores.length === 1 && (scores[0] === 0 || scores[0] === 1));
    const se = clusteredStandardError(values.flat(), values.flatMap((scores, i) => scores.map(() => i)));
    // Resampling item means preserves equal item weights even with unequal trial/step counts.
    const ci95 = binary ? wilsonInterval(means.reduce((sum, value) => sum + value, 0), items.size)
      : bootstrapInterval(means, { seed, clusterIds: [...items.keys()], statistic: sample => sample.reduce((sum, value) => sum + value, 0) / sample.length });
    return [id, { items: items.size, records, mean, ...reliability, ...agreement, se, ci95, method: binary ? "wilson" : "cluster_bootstrap" }];
  }));
  const stats = Object.values(scorers);
  const macroMean = stats.length ? stats.reduce((sum, value) => sum + value.mean, 0) / stats.length : undefined;

  // Written by `scoreRun` from the scorer's `invariant` declaration only; a scorer cannot set it.
  const invariantRecords = evaluations.filter((record) => record.metadata?.invariant === true);
  const invariantsPassed =
    invariantRecords.length > 0 ? invariantRecords.every((record) => record.status === "scored" && record.score === 1) : undefined;

  return {
    itemCount: 0,
    scoredCount: scored.length,
    skippedCount: evaluations.filter((record) => record.status === "skipped").length,
    failedCount: evaluations.filter((record) => record.status === "failed").length,
    macroMean,
    scorers,
    ...(invariantsPassed !== undefined ? { invariantsPassed } : {}),
  };
}

/** Sum observed usage; billing is published only with complete trial evidence. */
function aggregateCost(items: readonly ExperimentItemResult[]): NonNullable<ExperimentAggregate["cost"]> {
  const trials = items.flatMap(item => item.trials);
  const totals: { -readonly [K in keyof Usage]?: Usage[K] } = {};
  const meanPerItem: { -readonly [K in keyof Usage]?: Usage[K] } & { durationMs?: number } = {};
  for (const field of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    const values = trials.flatMap(trial => trial.usage?.[field] === undefined ? [] : [trial.usage[field]!]);
    if (values.length) {
      totals[field] = values.reduce((sum, value) => sum + value, 0);
      meanPerItem[field] = totals[field]! / items.length;
    }
  }
  if (trials.some(trial => trial.usage?.estimated)) totals.estimated = meanPerItem.estimated = true;
  const currency = trials[0]?.usage?.currency;
  const totalCost = trials.reduce((sum, trial) => sum + (trial.usage?.cost ?? 0), 0);
  const costComplete = trials.length > 0 && trials.every(trial => trial.costComplete && trial.usage?.currency === currency)
    && Number.isFinite(totalCost);
  if (costComplete) {
    totals.cost = totalCost;
    meanPerItem.cost = totalCost / items.length;
    if (currency !== undefined) totals.currency = meanPerItem.currency = currency;
  }
  const durations = trials.flatMap(trial => trial.durationMs === undefined ? [] : [trial.durationMs]).sort((a, b) => a - b);
  if (durations.length) meanPerItem.durationMs = durations.reduce((sum, value) => sum + value, 0) / items.length;
  return { ...totals, costComplete, meanPerItem, ...(durations.length ? {
    durationMs: { p50: durations[Math.ceil(durations.length * .5) - 1]!, p95: durations[Math.ceil(durations.length * .95) - 1]! },
  } : {}) };
}

/**
 * Run a pinned dataset snapshot through an agent with bounded concurrency and scorers.
 * Item order in the report matches dataset order. `trials` re-runs each item N times.
 */
export async function runExperiment<TInput = unknown, TExpected = unknown>(
  options: RunExperimentOptions<TInput, TExpected>,
): Promise<ExperimentReport<TInput, TExpected>> {
  if (!options.scorers.length) throw new EvalError("at least one scorer is required", "ERR_PRISM_EVAL_EXPERIMENT");
  const passThresholds = new Map(options.scorers.map(scorer => [
    scorer.id, assertFiniteUnitInterval(scorer.passThreshold === undefined ? 1 : scorer.passThreshold, `passThreshold.${scorer.id}`),
  ]));
  if (options.manifest) validateEvalManifest(options.manifest);
  checkRequirements(options.scorers, {
    timeline: options.timeline !== undefined && options.timeline !== "off",
    trace: options.traceResolver !== undefined,
    environment: options.toEnvironment !== undefined,
  });
  const experimentId = options.experimentId ?? randomId("experiment");
  const concurrency = normalizeConcurrency(options.concurrency);
  const toAgentInput = options.toAgentInput ?? ((input: TInput) => defaultToAgentInput(input));
  const splits = options.split === undefined ? undefined : Array.isArray(options.split) ? options.split : [options.split];
  splits?.forEach(validateSplit);
  const items = options.dataset.items.filter(item => splits === undefined || (item.split !== undefined && splits.includes(item.split)));
  if (options.allowHeldout !== true && items.some(item => item.split === "heldout")) {
    throw new EvalDatasetError("heldout items require allowHeldout: true", { code: "ERR_PRISM_EVAL_HELDOUT" });
  }
  for (const item of items) if (isScenarioInput(item.input)) validateScenario(item.input);
  const trialPlan = options.trials !== undefined ? resolveTrialsConfig(options.trials, options.seed) : undefined;
  const trialCount = trialPlan?.count ?? 1;
  if (typeof options.agent !== "function" && (options.hooks !== undefined || options.slots !== undefined)) {
    throw new EvalError("hooks and slots require an agent factory; an Agent instance cannot be reconfigured", "ERR_PRISM_EVAL_EXPERIMENT");
  }

  let aborted = false;
  let fatal: unknown;
  let sampleCount = 0;

  const runTrial = async (
    item: DatasetItem<TInput, TExpected>,
    trialIndex: number,
  ): Promise<{
    result?: RunResult;
    accounting: ExperimentItemResult["trials"][number];
    evaluations: readonly EvaluationRecord[];
    error?: ExperimentItemResult<TInput, TExpected>["error"];
  }> => {
    if (options.signal?.aborted) {
      aborted = true;
      return { accounting: { status: "aborted", costComplete: false }, evaluations: [], error: toErrorInfo(options.signal.reason ?? new Error("experiment aborted")) };
    }

    let result: RunResult | undefined;
    let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];

    // One stream per (item, trial): identical sampling at concurrency 1 and 8. An explicit
    // `random` keeps the old single shared stream, which is order-dependent by nature.
    const random = options.random ?? (options.seed !== undefined ? mulberry32(hash32(options.seed, item.id, trialIndex)) : undefined);

    const agent = typeof options.agent === "function" ? await options.agent({ hooks: options.hooks, slots: options.slots, item }) : options.agent;
    const session = await agent.session();
    const shouldProject = options.timeline && options.timeline !== "off";
    let folder: TimelineFolder | undefined;
    if (shouldProject) {
      const { createTimelineFolder } = await loadTimeline();
      folder = createTimelineFolder({ content: options.timeline, redactor: options.redactor });
    }

    const scenario = isScenarioInput(item.input) ? item.input : undefined;
    const evaluations: EvaluationRecord[] = [];
    let scoredSteps = 0;
    let scoringError = false;
    let simulation: UserSimulation | undefined;
    const deferred: { result: RunResult; timeline?: ExecutionTimeline; environment: unknown; turnIndex: number }[] = [];
    const score = async (turnIndex?: number, captured?: typeof deferred[number]) => {
      const snapshot = captured ? captured.timeline : folder?.snapshot();
      const timeline = captured || turnIndex === undefined || snapshot === undefined ? snapshot
        : { ...snapshot, steps: snapshot.steps.slice(scoredSteps) };
      scoredSteps = snapshot?.steps.length ?? 0;
      const environment = captured ? captured.environment : options.toEnvironment ? await options.toEnvironment(item, result, timeline) : undefined;
      const scoredResult = captured?.result ?? result;
      const metadata = { ...options.metadata, ...(trialPlan !== undefined || scenario ? { trialIndex } : {}), ...(turnIndex === undefined ? {} : { turnIndex }) };

      return scoredResult
        ? await scoreRun({
            result: scoredResult,
            scorers: options.scorers,
            sampling: options.sampling,
            store: options.store,
            telemetry: options.telemetry,
            ownership: options.ownership,
            redactor: options.redactor,
            secrets: options.secrets,
            signal: options.signal,
            datasetId: options.dataset.id,
            itemId: item.id,
            experimentId,
            traceId: options.traceId,
            traceResolver: options.traceResolver,
            traceLimits: options.traceLimits,
            metadata,
            random,
            item,
            timeline: options.timeline,
            injectedTimeline: timeline,
            environment,
          })
        : [];
    };
    let durationMs = 0;
    let startedTurns = 0, completedTurns = 0;
    let settledRunId: string | undefined;
    let pricedTurns = true;
    let settledRuns = true;
    let currency: string | undefined;
    const runResults: RunResult[] = [];
    const run = async (input: string | Message | readonly Message[]) => {
      const started = performance.now();
      settledRunId = undefined;
      const turnsBefore = completedTurns;
      try {
        const current = await collectWhileRunning(session, folder, () => session.run(input, {
          ...options.runOptions,
          signal: options.signal,
          ownership: options.ownership ?? options.runOptions?.ownership,
          redactor: options.redactor ?? options.runOptions?.redactor,
        }), event => {
          if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.suspended") settledRunId = event.runId;
          if (event.type === "turn.started") startedTurns++;
          if (event.type !== "turn.completed") return;
          if (completedTurns++ === 0) currency = event.usage?.currency;
          const usage = event.usage;
          pricedTurns &&= usage !== undefined && usage.estimated !== true && usage.cost !== undefined
            && Number.isFinite(usage.cost) && usage.cost >= 0 && usage.currency === currency;
        });
        settledRuns &&= settledRunId === current.runId && completedTurns > turnsBefore;
        result = current;
        runResults.push(current);
        if (current.status === "failed" || current.status === "aborted") {
          error = current.error ?? toErrorInfo(new Error(`Agent run ${current.status}`));
        }
        return current;
      } finally {
        durationMs += performance.now() - started;
      }
    };
    try {
      if (scenario) {
        simulation = await executeScenario({ ...scenario, signal: options.signal, redactor: options.redactor, secrets: options.secrets }, run, async (current, turnIndex) => {
          if (scenario.scoreTurns === "each") {
            try {
              if (scenario.user) {
                const snapshot = folder?.snapshot();
                const timeline = snapshot ? { ...snapshot, steps: snapshot.steps.slice(scoredSteps) } : undefined;
                scoredSteps = snapshot?.steps.length ?? 0;
                const environment = options.toEnvironment ? await options.toEnvironment(item, current, timeline) : undefined;
                deferred.push({ result: current, timeline, environment, turnIndex });
              } else evaluations.push(...await score(turnIndex));
            }
            catch (caught) { scoringError = true; throw caught; }
          }
        });
      } else {
        await run(toAgentInput(item.input));
      }
    } catch (caught) {
      if (scoringError) throw caught;
      error = toErrorInfo(caught);
    }
    if (error?.code === "ERR_PRISM_EVAL_USER_SIMULATOR") {
      evaluations.push(...await skipScorers({ result, scorers: options.scorers, store: options.store, telemetry: options.telemetry,
        ownership: options.ownership, redactor: options.redactor, secrets: options.secrets,
        datasetId: options.dataset.id, itemId: item.id, experimentId, traceId: options.traceId,
        metadata: { ...options.metadata, trialIndex },
      }, "ERR_PRISM_EVAL_USER_SIMULATOR"));
    } else {
      for (const turn of deferred) evaluations.push(...await score(turn.turnIndex, turn));
      if (!scenario || scenario.scoreTurns !== "each") evaluations.push(...await score());
    }
    const usage: { -readonly [K in keyof Usage]?: Usage[K] } = {};
    for (const field of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "cost"] as const) {
      const values = runResults.flatMap(run => run.usage?.[field] === undefined ? [] : [run.usage[field]!]);
      if (values.length) usage[field] = values.reduce((sum, value) => sum + value, 0);
    }
    if (runResults.some(run => run.usage?.estimated)) usage.estimated = true;
    const usageCurrency = runResults[0]?.usage?.currency;
    if (runResults.every(run => run.usage?.currency === usageCurrency) && usageCurrency !== undefined) usage.currency = usageCurrency;
    const accounting: ExperimentItemResult["trials"][number] = {
      simulation,
      usage: runResults.length === 1 ? result?.usage : runResults.length ? usage : undefined, durationMs,
      status: options.signal?.aborted || result?.status === "aborted" ? "aborted" : error ? "failed" : result?.status ?? (simulation?.stopReason === "goal_reached" ? "completed" : "failed"),
      costComplete: error === undefined && settledRuns && runResults.length > 0 && startedTurns === completedTurns && pricedTurns
        && runResults.every(run => run.status === "completed" && run.usage?.cost !== undefined && run.usage.estimated !== true
          && Number.isFinite(run.usage.cost) && run.usage.cost >= 0 && run.usage.currency === currency),
    };
    if (evaluations.length) sampleCount += 1;

    return { result, accounting, evaluations, error };
  };

  let itemResults: ExperimentItemResult<TInput, TExpected>[];
  try {
    itemResults = await mapPool(
      items,
      concurrency,
      async (item): Promise<ExperimentItemResult<TInput, TExpected>> => {
        const evaluations: EvaluationRecord[] = [];
        const trials: ExperimentItemResult["trials"][number][] = [];
        let result: RunResult | undefined;
        let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];
        for (let trialIndex = 0; trialIndex < trialCount; trialIndex++) {
          const trial = await runTrial(item, trialIndex);
          evaluations.push(...trial.evaluations);
          trials.push(trial.accounting);
          result = trial.result ?? result;
          error = trial.error ?? error;
        }
        const itemResult: ExperimentItemResult<TInput, TExpected> = { item, result, trials, evaluations, error };
        await options.onItem?.(itemResult);
        return itemResult;
      },
      options.signal,
      // Settle-all: finished items keep their results, unstarted ones fail with the abort reason.
      (item, _index, error) => ({ item, evaluations: [],
        trials: Array.from({ length: trialCount }, () => ({ status: options.signal?.aborted ? "aborted" as const : "failed" as const, costComplete: false })),
        error: toErrorInfo(error) }),
    );
  } catch (error) {
    fatal = error;
    aborted = options.signal?.aborted === true;
    itemResults = items.map((item) => ({
      item,
      trials: Array.from({ length: trialCount }, () => ({ status: aborted ? "aborted" as const : "failed" as const, costComplete: false })),
      evaluations: [],
      error: toErrorInfo(error),
    }));
  }

  const evaluations = itemResults.flatMap((item) => item.evaluations);
  const tagGroups = new Map<string, { itemCount: number; evaluations: EvaluationRecord[] }>();
  for (const result of itemResults) for (const tag of new Set(result.item.tags ?? [])) {
    const group = tagGroups.get(tag) ?? { itemCount: 0, evaluations: [] };
    group.itemCount++;
    group.evaluations.push(...result.evaluations);
    tagGroups.set(tag, group);
  }
  const byTag = Object.fromEntries([...tagGroups].map(([tag, group]) => [tag, {
    scorers: aggregateEvaluations(group.evaluations, passThresholds, trialCount, group.itemCount, options.seed).scorers,
  }]));
  const aggregate = {
    ...aggregateEvaluations(evaluations, passThresholds, trialCount, items.length, options.seed),
    itemCount: items.length,
    cost: aggregateCost(itemResults),
    byTag,
  };

  const status =
    aborted || options.signal?.aborted
      ? "aborted"
      : fatal || itemResults.some((item) => item.error && (!item.result || isScenarioInput(item.item.input)))
        ? "failed"
        : "succeeded";

  const trials: ExperimentTrials | undefined = trialPlan
    ? {
        ...trialPlan,
        sampleCount,
      }
    : undefined;

  const report: ExperimentReport<TInput, TExpected> = {
    experimentId,
    datasetId: options.dataset.id,
    datasetVersion: options.dataset.version,
    datasetContentHash: options.dataset.contentHash,
    split: options.split,
    canary: options.dataset.canary,
    status,
    items: itemResults,
    evaluations,
    aggregate,
    manifest: options.manifest,
    trials,
    error: fatal ? toErrorInfo(fatal) : undefined,
  };
  await options.experimentStore?.append(toExperimentReportRecord(report, options.ownership));
  return report;
}
