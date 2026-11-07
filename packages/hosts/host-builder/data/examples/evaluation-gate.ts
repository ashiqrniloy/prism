import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { assertEvaluationThreshold, defineDataset, defineScorer, powerAnalysis, runExperiment } from "@arnilo/prism-evals";
import { mockProvider } from "@arnilo/prism/testing";

const dataset = defineDataset({
  id: "citations", version: "1",
  items: Array.from({ length: 20 }, (_, i) => ({ id: String(i), input: "cite" })),
});

async function evaluate(text: string) {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta(text), providerDone()]])],
  });
  try {
    return await runExperiment({ agent, dataset,
      scorers: [defineScorer({ id: "citation", score: ({ result }) => ({ score: result.text.includes("[") ? 1 : 0 }) })],
    });
  } finally {
    await agent.dispose();
  }
}

const baseline = await evaluate("answer [1]");
const candidate = await evaluate("updated answer [1]");
assertEvaluationThreshold(candidate, {
  minimumMacroMean: .9, maximumFailures: 0,
  minimumLowerBound: { citation: .8 },
  maximumRegression: { baseline, delta: .02 },
});
console.log(JSON.stringify({ mean: candidate.aggregate.macroMean,
  plannedDataset: powerAnalysis({ baselinePassRate: .85, minimumDetectableDrop: .05 }),
}));
