import type { AppendRunFeedbackInput, RunFeedbackRecord, RunFeedbackStore } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import type { EvaluationRecord, EvaluationStore } from "./types.js";

export interface AppendEvaluationFeedbackInput {
  readonly feedbackStore: RunFeedbackStore;
  readonly evaluationStore: EvaluationStore;
  readonly feedback: Omit<AppendRunFeedbackInput, "evaluationIds" | "scorerIds">;
  readonly evaluationIds: readonly string[];
}

/** Resolve known evaluations, verify run/trace/ownership, then persist ID-only feedback linkage. */
export async function appendEvaluationFeedback(input: AppendEvaluationFeedbackInput): Promise<RunFeedbackRecord> {
  if (input.evaluationIds.length === 0 || input.evaluationIds.length > 64 || new Set(input.evaluationIds).size !== input.evaluationIds.length) {
    throw new EvalError("1-64 unique evaluationIds are required", "ERR_PRISM_EVAL_FEEDBACK");
  }
  const evaluations = await Promise.all(input.evaluationIds.map(async (id) => {
    const page = await input.evaluationStore.query({
      id,
      tenantId: input.feedback.tenantId,
      accountId: input.feedback.accountId,
      userId: input.feedback.userId,
      limit: 1,
      signal: input.feedback.signal,
    });
    const evaluation = page.items[0];
    if (!evaluation || evaluation.id !== id) throw new EvalError("evaluation not found", "ERR_PRISM_EVAL_FEEDBACK");
    return evaluation;
  }));
  for (const evaluation of evaluations) assertMatches(evaluation, input.feedback);
  return input.feedbackStore.append({
    ...input.feedback,
    evaluationIds: input.evaluationIds,
    scorerIds: [...new Set(evaluations.map((evaluation) => evaluation.scorerId))],
  });
}

function assertMatches(evaluation: EvaluationRecord, feedback: AppendEvaluationFeedbackInput["feedback"]): void {
  if (evaluation.runId !== feedback.runId
    || evaluation.tenantId !== feedback.tenantId
    || evaluation.accountId !== feedback.accountId
    || evaluation.userId !== feedback.userId
    || (feedback.traceId !== undefined && evaluation.traceId !== undefined && evaluation.traceId !== feedback.traceId)) {
    throw new EvalError("evaluation does not match feedback run/trace ownership", "ERR_PRISM_EVAL_FEEDBACK");
  }
}
