import { createAgent, providerDone, providerTextDelta, type EvaluationRecord } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createMemoryEvaluationStore, createMemoryRunFeedbackStore } from "@arnilo/prism-store-codecs";
import { appendEvaluationFeedback, calibrateJudge, createRubricJudge } from "@arnilo/prism-evals";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation } from "@arnilo/prism-observability";

const ownership = { tenantId: "example-tenant", userId: "example-user" } as const;
const run = { runId: "run-1", sessionId: "session-1", traceId: "trace-1", ...ownership };
const feedback = createMemoryRunFeedbackStore({
  resolveRun: ({ runId }) => (runId === run.runId ? run : false),
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

console.log(
  JSON.stringify({
    feedback: (await feedback.query({ ...ownership, runId: run.runId })).items,
    metricLabels: memory.metrics.map((metric) => metric.attributes),
  }),
);

// One mock label demonstrates the API; a CI gate needs a representative human-labeled sample.
const candidate = await createAgent({ model: { provider: "mock", model: "candidate" },
  packages: [mockProvider([[providerTextDelta("A useful answer [1]."), providerDone()]])] });
const judgeAgent = await createAgent({ model: { provider: "mock", model: "judge" },
  packages: [mockProvider([[providerTextDelta(JSON.stringify({ reasoning: "Useful and cited", label: "yes" })), providerDone()]])] });
const session = await candidate.session();
try {
  const result = await session.run("Give a useful answer with a citation");
  const judge = createRubricJudge({ agent: judgeAgent, judgedModel: candidate.config.model,
    rubric: { id: "citation-quality", version: "1", criteria: "The answer is useful and cited", scale: [
      { label: "no", score: 0, description: "Missing useful citations" },
      { label: "yes", score: 1, description: "Useful and cited" },
    ] } });
  const calibration = await calibrateJudge({ judge, items: [{ item: { id: record.id, input: "Give a useful answer with a citation" },
    result, humanScore: (record.rating! + 1) / 2 }], seed: 1 });
  console.log(JSON.stringify({ calibration }));
} finally {
  await session.close();
  await candidate.dispose();
  await judgeAgent.dispose();
}
