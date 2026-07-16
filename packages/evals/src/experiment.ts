import { AgentRunError, type AgentRunResult, type Message } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import { defaultToAgentInput, scoreRun } from "./score.js";
import type {
  EvaluationRecord,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  RunExperimentOptions,
} from "./types.js";
import {
  mapPool,
  normalizeConcurrency,
  randomId,
  toErrorInfo,
} from "./util.js";

function aggregateEvaluations(evaluations: readonly EvaluationRecord[]): ExperimentAggregate {
  const scored = evaluations.filter((record) => record.status === "scored" && record.score !== undefined);
  const scoresByScorer: Record<string, { count: number; sum: number }> = {};
  for (const record of scored) {
    const bucket = scoresByScorer[record.scorerId] ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += record.score!;
    scoresByScorer[record.scorerId] = bucket;
  }

  const meanScore = scored.length
    ? scored.reduce((sum, record) => sum + (record.score ?? 0), 0) / scored.length
    : undefined;

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
  };
}

/**
 * Run a pinned dataset snapshot through an agent with bounded concurrency and scorers.
 * Item order in the report matches dataset order.
 */
export async function runExperiment<TInput = unknown, TExpected = unknown>(
  options: RunExperimentOptions<TInput, TExpected>,
): Promise<ExperimentReport<TInput, TExpected>> {
  if (!options.scorers.length) throw new EvalError("at least one scorer is required", "ERR_PRISM_EVAL_EXPERIMENT");
  const experimentId = options.experimentId ?? randomId("experiment");
  const concurrency = normalizeConcurrency(options.concurrency);
  const toAgentInput = options.toAgentInput ?? ((input: TInput) => defaultToAgentInput(input));
  const items = options.dataset.items;

  let aborted = false;
  let fatal: unknown;

  let itemResults: ExperimentItemResult<TInput, TExpected>[];
  try {
    itemResults = await mapPool(
      items,
      concurrency,
      async (item): Promise<ExperimentItemResult<TInput, TExpected>> => {
        if (options.signal?.aborted) {
          aborted = true;
          return {
            item,
            evaluations: [],
            error: toErrorInfo(options.signal.reason ?? new Error("experiment aborted")),
          };
        }

        let result: AgentRunResult | undefined;
        let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];
        try {
          const session = options.agent.createSession();
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
              metadata: options.metadata,
              random: options.random,
              item,
            })
          : [];

        const itemResult: ExperimentItemResult<TInput, TExpected> = {
          item,
          result,
          evaluations,
          error,
        };
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

  const status = aborted || options.signal?.aborted
    ? "aborted"
    : fatal || itemResults.some((item) => item.error && !item.result)
      ? "failed"
      : "succeeded";

  return {
    experimentId,
    datasetId: options.dataset.id,
    datasetVersion: options.dataset.version,
    status,
    items: itemResults,
    evaluations,
    aggregate,
    error: fatal ? toErrorInfo(fatal) : undefined,
  };
}
