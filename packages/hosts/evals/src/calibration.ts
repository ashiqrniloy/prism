import {
  resolveRedactor,
  type Message,
  type OwnershipScope,
  type ProductionPersistenceStore,
  type RunFeedbackQuery,
  type RunFeedbackRecord,
  type RunFeedbackStore,
  type RunResult,
  type SecretRedactor,
} from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_TRACE_PAGES,
  HARD_DATASET_ITEMS,
  HARD_REPORT_MAX_BYTES,
  HARD_TRACE_PAGE_SIZE,
  HARD_TRACE_PAGES,
} from "./limits.js";
import { checkRequirements } from "./score.js";
import { bootstrapInterval, cohensKappa, krippendorffAlpha, spearman } from "./stats.js";
import { createPersistenceTraceResolver, limit, pages } from "./trace.js";
import type { CalibrationItem, CalibrationReport, Scorer, TraceLimits } from "./types.js";
import { assertFiniteUnitInterval, exactOwnershipMatches, validateScoreResult } from "./util.js";

export interface CalibrateJudgeOptions<TInput = unknown, TExpected = unknown> {
  readonly judge: Scorer<TInput, TExpected>;
  readonly items: readonly CalibrationItem<TInput, TExpected>[];
  readonly scale?: "nominal" | "ordinal";
  readonly seed?: number;
  readonly signal?: AbortSignal;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
}

/** Score labels once, then bootstrap paired items without additional judge calls. */
export async function calibrateJudge<TInput = unknown, TExpected = unknown>(
  options: CalibrateJudgeOptions<TInput, TExpected>,
): Promise<CalibrationReport> {
  const { judge, items, scale = "nominal", seed = 0, signal } = options;
  if (!["nominal", "ordinal"].includes(scale) || !Number.isSafeInteger(seed) || items.length > HARD_DATASET_ITEMS) {
    throw new EvalError("invalid calibration scale, seed, or item count", "ERR_PRISM_EVAL_CALIBRATION");
  }
  signal?.throwIfAborted();
  checkRequirements([judge], { timeline: false, trace: false, environment: false });
  for (const row of items) assertFiniteUnitInterval(row.humanScore, "humanScore");
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const human: number[] = [],
    judged: number[] = [];
  let judgeFailures = 0;
  for (const { item, result, humanScore } of items) {
    signal?.throwIfAborted();
    try {
      const verdict = validateScoreResult(await judge.score({ item, result, expected: item.expected, redactor, signal }));
      human.push(humanScore);
      judged.push(verdict.score);
    } catch {
      judgeFailures++;
    }
    signal?.throwIfAborted();
  }
  const labels = [...new Set([...human, ...judged])].sort((a, b) => a - b);
  const indices = new Map(labels.map((label, i) => [label, i]));
  if (labels.length ** 2 * 8 > HARD_REPORT_MAX_BYTES) {
    throw new EvalError("calibration confusion matrix exceeds report bounds", "ERR_PRISM_EVAL_CALIBRATION");
  }
  const counts = labels.map(() => labels.map(() => 0));
  for (let i = 0; i < human.length; i++) counts[indices.get(human[i]!)!]![indices.get(judged[i]!)!]!++;
  const kappa = cohensKappa(human, judged);
  return {
    n: human.length,
    judgeFailures,
    cohensKappa: kappa ?? null,
    ...(scale === "ordinal" ? { weightedKappa: cohensKappa(human, judged, true) ?? null } : {}),
    krippendorffAlpha: krippendorffAlpha(human, judged) ?? null,
    spearman: spearman(human, judged) ?? null,
    confusion: { labels, counts },
    ...(kappa === undefined
      ? {}
      : {
          kappaCi95: bootstrapInterval(
            human.map((_, i) => i),
            {
              // Degenerate one-category resamples provide no agreement evidence; use the worst kappa.
              seed,
              statistic: (sample) =>
                cohensKappa(
                  sample.map((i) => human[i]!),
                  sample.map((i) => judged[i]!),
                ) ?? -1,
            },
          ),
        }),
  };
}

export interface LabeledItemsFromFeedbackOptions {
  readonly feedbackStore: RunFeedbackStore;
  readonly persistence: ProductionPersistenceStore;
  readonly ownership: OwnershipScope;
  readonly query?: Omit<RunFeedbackQuery, keyof OwnershipScope>;
  readonly toScore?: (feedback: RunFeedbackRecord) => number | undefined;
  readonly traceLimits?: TraceLimits;
  readonly signal?: AbortSignal;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
}

/** Read bounded owner-scoped feedback and traces; never include feedback in the judge's item/result. */
export async function labeledItemsFromFeedback(
  options: LabeledItemsFromFeedbackOptions,
): Promise<readonly CalibrationItem<Message | undefined>[]> {
  const { ownership, query = {}, signal } = options;
  if (
    !ownership.tenantId?.trim() ||
    !(ownership.accountId?.trim() || ownership.userId?.trim()) ||
    (ownership.accountId !== undefined && !ownership.accountId.trim()) ||
    (ownership.userId !== undefined && !ownership.userId.trim()) ||
    Object.keys(ownership).some((key) => !["tenantId", "accountId", "userId"].includes(key)) ||
    ["tenantId", "accountId", "userId"].some((key) => key in query)
  ) {
    throw new EvalError("calibration feedback requires explicit ownership without query overrides", "ERR_PRISM_EVAL_TRACE_OWNERSHIP");
  }
  signal?.throwIfAborted();
  const pageSize = limit(options.traceLimits?.pageSize, DEFAULT_TRACE_PAGE_SIZE, HARD_TRACE_PAGE_SIZE, "pageSize");
  const maxPages = limit(options.traceLimits?.maxPages, DEFAULT_TRACE_PAGES, HARD_TRACE_PAGES, "maxPages");
  const records = await pages(
    (cursor) => options.feedbackStore.query({ ...query, ...ownership, limit: pageSize, cursor, signal }),
    maxPages,
  );
  if (records.length > HARD_DATASET_ITEMS) throw new EvalError("too many calibration feedback items", "ERR_PRISM_EVAL_CALIBRATION");
  const resolver = createPersistenceTraceResolver(options.persistence);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const output: CalibrationItem<Message | undefined>[] = [];
  for (const record of records) {
    signal?.throwIfAborted();
    if (!exactOwnershipMatches(ownership, record)) throw new EvalError("feedback ownership mismatch", "ERR_PRISM_EVAL_TRACE_OWNERSHIP");
    const humanScore = options.toScore ? options.toScore(record) : record.rating === undefined ? undefined : (record.rating + 1) / 2;
    if (humanScore === undefined) continue;
    assertFiniteUnitInterval(humanScore, "humanScore");
    const trace = await resolver({
      ...ownership,
      sessionId: record.sessionId,
      runId: record.runId,
      limits: options.traceLimits,
      redactor,
      signal,
    });
    const messages = trace.events.flatMap((row) => (row.event.type === "message.completed" ? [row.event.message] : []));
    const message = [...messages].reverse().find((row) => row.role === "assistant");
    const content = message?.content ?? [];
    const run = trace.run;
    if (!["succeeded", "failed", "aborted", "suspended", "denied"].includes(run.status ?? "")) {
      throw new EvalError("calibration requires a settled run", "ERR_PRISM_EVAL_CALIBRATION");
    }
    const result: RunResult = {
      sessionId: run.sessionId,
      runId: run.id,
      status:
        run.status === "succeeded"
          ? run.stopReason
            ? "stopped"
            : "completed"
          : run.status === "denied"
            ? "stopped"
            : (run.status as "failed" | "aborted" | "suspended"),
      text: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      content,
      message,
      messages,
      error: run.error,
      abortReason: run.abortReason,
      stopReason: run.status === "denied" ? "denied" : run.stopReason,
    };
    output.push({ item: { id: record.id, input: messages.find((row) => row.role === "user") }, result, humanScore });
  }
  return output;
}
