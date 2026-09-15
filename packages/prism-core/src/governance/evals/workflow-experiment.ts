import type { AgentRunResult, OwnershipScope, SecretRedactor } from "@arnilo/prism";
import { createMemoryWorkflowCheckpoints } from "../../runtime/workflows/checkpoints.js";
import { createWorkflowEventBus } from "../../runtime/workflows/events.js";
import { runWorkflow } from "../../runtime/workflows/run.js";
import type { WorkflowCheckpointAdapter, WorkflowDefinition, WorkflowEvent } from "../../runtime/workflows/types.js";
import { projectWorkflowTimeline } from "../observability/timeline.js";
import { EvalError } from "./errors.js";
import { scoreRun } from "./score.js";
import type {
  Dataset,
  DatasetItem,
  EvaluationRecord,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  Scorer,
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

export interface RunWorkflowExperimentOptions<TInput = unknown, TExpected = unknown> {
  readonly workflow: WorkflowDefinition;
  readonly dataset: Dataset<TInput, TExpected>;
  readonly scorers: readonly Scorer<TInput, TExpected>[];
  readonly concurrency?: number;
  readonly sampleRate?: number;
  readonly store?: import("./types.js").EvaluationStore;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
  readonly experimentId?: string;
  readonly traceId?: string;
  readonly checkpoints?: WorkflowCheckpointAdapter;
  /** Custom runner injection. When provided, replaces direct runWorkflow execution. */
  readonly runner?: (
    item: DatasetItem<TInput, TExpected>,
    input: unknown,
  ) => Promise<{ status: string; runId: string; events?: readonly WorkflowEvent[] }>;
  readonly timeline?: "off" | "metadata" | "redacted_io";
  readonly toWorkflowInput?: (input: TInput) => unknown;
  readonly toEnvironment?: (
    item: DatasetItem<TInput, TExpected>,
    result?: AgentRunResult,
    timeline?: import("../observability/timeline-types.js").ExecutionTimeline,
  ) => unknown | Promise<unknown>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly random?: () => number;
  readonly onItem?: (item: ExperimentItemResult<TInput, TExpected>) => void | Promise<void>;
}

/**
 * Executes a dataset against a workflow definition, projects workflow execution timelines,
 * and runs trajectory/outcome scorers (R-E6).
 */
export async function runWorkflowExperiment<TInput = unknown, TExpected = unknown>(
  options: RunWorkflowExperimentOptions<TInput, TExpected>,
): Promise<ExperimentReport<TInput, TExpected>> {
  if (!options.scorers.length) throw new EvalError("at least one scorer is required", "ERR_PRISM_EVAL_EXPERIMENT");
  const experimentId = options.experimentId ?? randomId("wf-experiment");
  const concurrency = normalizeConcurrency(options.concurrency);
  const items = options.dataset.items;
  const toWorkflowInput = options.toWorkflowInput ?? ((input: TInput) => input);
  const checkpoints = options.checkpoints ?? createMemoryWorkflowCheckpoints();

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
            error: toErrorInfo(options.signal.reason ?? new Error("workflow experiment aborted")),
          };
        }

        const events: WorkflowEvent[] = [];
        let runId = "";
        let runStatus = "failed";
        let error = undefined as ExperimentItemResult<TInput, TExpected>["error"];

        try {
          if (options.runner) {
            const res = await options.runner(item, toWorkflowInput(item.input));
            runId = res.runId;
            runStatus = res.status;
            if (res.events) events.push(...res.events);
          } else {
            const eventBus = createWorkflowEventBus({
              workflowId: options.workflow.id,
              runId,
              signal: options.signal,
            });
            const sub = eventBus.subscribe();
            const collector = (async () => {
              for await (const ev of sub) {
                events.push(ev);
              }
            })();

            const wfResult = await runWorkflow(options.workflow, toWorkflowInput(item.input), {
              checkpoints,
              eventBus,
              ownership: options.ownership,
              signal: options.signal,
            });

            runId = wfResult.runId;
            runStatus = wfResult.status;

            await eventBus.close();
            await collector;
          }
        } catch (caught) {
          error = toErrorInfo(caught);
        }

        const checkpoint = checkpoints
          ? await checkpoints.load({
              workflowId: options.workflow.id,
              runId,
              ownership: options.ownership,
            })
          : undefined;

        const timeline =
          options.timeline === "off"
            ? undefined
            : projectWorkflowTimeline(events, {
                checkpoint: checkpoint ? checkpoint.value : undefined,
                content: options.timeline ?? "metadata",
                redactor: options.redactor,
                traceId: options.traceId,
              });

        const result: AgentRunResult = {
          sessionId: runId,
          runId,
          status: runStatus === "succeeded" ? "succeeded" : "failed",
          text: checkpoint ? JSON.stringify(checkpoint) : "",
          content: [],
        };

        const environment = options.toEnvironment ? await options.toEnvironment(item, result, timeline) : undefined;

        const evaluations = await scoreRun({
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
          timeline: options.timeline ?? "metadata",
          injectedTimeline: timeline,
          environment,
        });

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
  } catch (err) {
    fatal = err;
    aborted = options.signal?.aborted === true;
    itemResults = items.map((item) => ({
      item,
      evaluations: [],
      error: toErrorInfo(err),
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
