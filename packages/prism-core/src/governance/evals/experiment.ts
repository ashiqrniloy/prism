import { AgentRunError, type AgentRunResult, type Message } from "@arnilo/prism";
import { createTimelineFolder } from "../observability/index.js";
import { EvalError } from "./errors.js";
import { collectWhileRunning, mulberry32, resolveTrialsConfig, validateEvalManifest } from "./scenarios.js";
import { defaultToAgentInput, scoreRun } from "./score.js";
import type {
  DatasetItem,
  EvaluationRecord,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  ExperimentTrials,
  RunExperimentOptions,
} from "./types.js";
import { mapPool, normalizeConcurrency, randomId, toErrorInfo } from "./util.js";

function aggregateEvaluations(evaluations: readonly EvaluationRecord[]): ExperimentAggregate {
  const scored = evaluations.filter((record) => record.status === "scored" && record.score !== undefined);
  const scoresByScorer: Record<string, { count: number; sum: number }> = {};
  for (const record of scored) {
    const bucket = scoresByScorer[record.scorerId] ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += record.score!;
    scoresByScorer[record.scorerId] = bucket;
  }

  const meanScore = scored.length ? scored.reduce((sum, record) => sum + (record.score ?? 0), 0) / scored.length : undefined;

  const invariantRecords = evaluations.filter((record) => record.metadata?.invariant === true);
  const invariantsPassed =
    invariantRecords.length > 0 ? invariantRecords.every((record) => record.status === "scored" && record.score === 1) : undefined;

  return {
    itemCount: 0,
    scoredCount: scored.length,
    skippedCount: evaluations.filter((record) => record.status === "skipped").length,
    failedCount: evaluations.filter((record) => record.status === "failed").length,
    meanScore,
    scoresByScorer: Object.fromEntries(
      Object.entries(scoresByScorer).map(([scorerId, value]) => [
        scorerId,
        { count: value.count, mean: value.count ? value.sum / value.count : undefined },
      ]),
    ),
    ...(invariantsPassed !== undefined ? { invariantsPassed } : {}),
  };
}

function sampleStandardError(scores: readonly number[]): number | undefined {
  if (scores.length < 2) return undefined;
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  let sumSq = 0;
  for (const score of scores) {
    const d = score - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (scores.length - 1) / scores.length);
}

/**
 * Run a pinned dataset snapshot through an agent with bounded concurrency and scorers.
 * Item order in the report matches dataset order. `trials` re-runs each item N times.
 */
export async function runExperiment<TInput = unknown, TExpected = unknown>(
  options: RunExperimentOptions<TInput, TExpected>,
): Promise<ExperimentReport<TInput, TExpected>> {
  if (!options.scorers.length) throw new EvalError("at least one scorer is required", "ERR_PRISM_EVAL_EXPERIMENT");
  if (options.manifest) validateEvalManifest(options.manifest);
  const experimentId = options.experimentId ?? randomId("experiment");
  const concurrency = normalizeConcurrency(options.concurrency);
  const toAgentInput = options.toAgentInput ?? ((input: TInput) => defaultToAgentInput(input));
  const items = options.dataset.items;
  const trialPlan = options.trials !== undefined ? resolveTrialsConfig(options.trials, options.seed) : undefined;
  const trialCount = trialPlan?.count ?? 1;
  const random = options.random ?? (options.seed !== undefined ? mulberry32(options.seed) : undefined);

  let aborted = false;
  let fatal: unknown;
  let sampleCount = 0;

  const runTrial = async (
    item: DatasetItem<TInput, TExpected>,
    trialIndex: number,
  ): Promise<{
    result?: AgentRunResult;
    evaluations: readonly EvaluationRecord[];
    error?: ExperimentItemResult<TInput, TExpected>["error"];
  }> => {
    if (options.signal?.aborted) {
      aborted = true;
      return { evaluations: [], error: toErrorInfo(options.signal.reason ?? new Error("experiment aborted")) };
    }

    let result: AgentRunResult | undefined;
    let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];

    const session = options.agent.createSession();
    const shouldProject = options.timeline && options.timeline !== "off";
    const folder = shouldProject ? createTimelineFolder({ content: options.timeline, redactor: options.redactor }) : undefined;

    try {
      await collectWhileRunning(session, folder, async () => {
        try {
          result = await session.run(toAgentInput(item.input) as string | Message | readonly Message[], {
            ...options.runOptions,
            signal: options.signal,
            ownership: options.ownership ?? options.runOptions?.ownership,
            redactor: options.redactor ?? options.runOptions?.redactor,
          });
        } catch (caught) {
          if (caught instanceof AgentRunError) {
            result = caught.result;
            error = caught.result.error ?? toErrorInfo(caught);
          } else {
            error = toErrorInfo(caught);
          }
        }
      });
    } catch (caught) {
      error = toErrorInfo(caught);
    }
    const timeline = folder?.snapshot();

    const environment = options.toEnvironment ? await options.toEnvironment(item, result, timeline) : undefined;
    const metadata = trialPlan !== undefined ? { ...options.metadata, trialIndex } : options.metadata;

    const evaluations = result
      ? await scoreRun({
          result,
          scorers: options.scorers,
          sampleRate: options.sampleRate,
          store: options.store,
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
    if (evaluations.length) sampleCount += 1;

    return { result, evaluations, error };
  };

  let itemResults: ExperimentItemResult<TInput, TExpected>[];
  try {
    itemResults = await mapPool(
      items,
      concurrency,
      async (item): Promise<ExperimentItemResult<TInput, TExpected>> => {
        const evaluations: EvaluationRecord[] = [];
        let result: AgentRunResult | undefined;
        let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];
        for (let trialIndex = 0; trialIndex < trialCount; trialIndex++) {
          const trial = await runTrial(item, trialIndex);
          evaluations.push(...trial.evaluations);
          result = trial.result ?? result;
          error = trial.error ?? error;
        }
        const itemResult: ExperimentItemResult<TInput, TExpected> = { item, result, evaluations, error };
        await options.onItem?.(itemResult);
        return itemResult;
      },
      options.signal,
    );
  } catch (error) {
    fatal = error;
    aborted = options.signal?.aborted === true;
    itemResults = items.map((item) => ({
      item,
      evaluations: [],
      error: toErrorInfo(error),
    }));
  }

  const evaluations = itemResults.flatMap((item) => item.evaluations);
  const aggregate = {
    ...aggregateEvaluations(evaluations),
    itemCount: items.length,
  };

  const status =
    aborted || options.signal?.aborted
      ? "aborted"
      : fatal || itemResults.some((item) => item.error && !item.result)
        ? "failed"
        : "succeeded";

  const scored = evaluations.filter((record) => record.status === "scored" && record.score !== undefined);
  const trials: ExperimentTrials | undefined = trialPlan
    ? {
        ...trialPlan,
        sampleCount,
        ...(trialPlan.count > 1 ? { standardError: sampleStandardError(scored.map((record) => record.score ?? 0)) } : {}),
      }
    : undefined;

  return {
    experimentId,
    datasetId: options.dataset.id,
    datasetVersion: options.dataset.version,
    status,
    items: itemResults,
    evaluations,
    aggregate,
    manifest: options.manifest,
    trials,
    error: fatal ? toErrorInfo(fatal) : undefined,
  };
}
