import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { assertEvaluationThreshold, defineDataset, defineScorer, runExperiment } from "@arnilo/prism-evals";

const report = await runExperiment({
  agent: createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("answer [1]"), providerDone()]),
  }),
  dataset: defineDataset({ id: "citations", version: "1", items: [{ id: "1", input: "cite" }] }),
  scorers: [defineScorer({ id: "citation", score: ({ result }) => ({ score: result.text.includes("[") ? 1 : 0 }) })],
});

assertEvaluationThreshold(report, { minimumMean: 0.9, maximumFailures: 0 });
console.log(JSON.stringify({ mean: report.aggregate.meanScore }));
