import { createMemoryRunFeedbackStore } from "@arnilo/prism";
import { appendEvaluationFeedback, createMemoryEvaluationStore, type EvaluationRecord } from "@arnilo/prism-evals";
import {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
} from "@arnilo/prism-observability-opentelemetry";

const ownership = { tenantId: "example-tenant", userId: "example-user" } as const;
const run = { runId: "run-1", sessionId: "session-1", traceId: "trace-1", ...ownership };
const feedback = createMemoryRunFeedbackStore({
  resolveRun: ({ runId }) => runId === run.runId ? run : false,
});
const evaluation: EvaluationRecord = {
  id: "eval-1",
  scorerId: "citation-quality",
  status: "scored",
  sampled: true,
  score: 1,
  runId: run.runId,
  sessionId: run.sessionId,
  traceId: run.traceId,
  createdAt: new Date().toISOString(),
  ...ownership,
};
const record = await appendEvaluationFeedback({
  feedbackStore: feedback,
  evaluationStore: createMemoryEvaluationStore([evaluation]),
  evaluationIds: [evaluation.id],
  feedback: {
    id: "feedback-1",
    runId: run.runId,
    traceId: run.traceId,
    rating: 1,
    comment: "Useful and cited",
    tags: ["reviewed"],
    ...ownership,
  },
});

const memory = createInMemoryTelemetry();
const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
telemetry.handleRunFeedback({
  runId: record.runId,
  rating: record.rating,
  hasComment: record.comment !== undefined,
  tagCount: record.tags.length,
  scorerCount: record.scorerIds.length,
  evaluationCount: record.evaluationIds.length,
});
telemetry.handleEvaluation({ runId: run.runId, status: evaluation.status, score: evaluation.score, hasReason: false });

console.log(JSON.stringify({
  feedback: (await feedback.query({ ...ownership, runId: run.runId })).items,
  metricLabels: memory.metrics.map((metric) => metric.attributes),
}));
