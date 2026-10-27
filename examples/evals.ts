import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { defineDataset, defineScorer, estimateOnline, runExperiment, scoreRunLive } from "@arnilo/prism-evals";
import { createMemoryEvaluationStore } from "@arnilo/prism-store-codecs";
import { mockProvider } from "@arnilo/prism/testing";

const scorer = defineScorer({
  id: "contains-citation",
  score: ({ result }) => ({
    score: result.text.includes("[") ? 1 : 0,
    reason: result.text.includes("[") ? "found citation marker" : "missing citation marker",
  }),
});

const dataset = defineDataset({
  id: "citations",
  version: "1",
  items: [
    { id: "1", input: "Summarize Prism with a citation" },
    { id: "2", input: "Say hello" },
  ],
});

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [
    mockProvider([
      [providerTextDelta("Prism is an agent harness [1]."), providerDone()],
      [providerTextDelta("Hello there."), providerDone()],
      [providerTextDelta("Follow up [2]."), providerDone()],
      [providerTextDelta("Another note [3]."), providerDone()],
    ]),
  ],
});

const store = createMemoryEvaluationStore();
const report = await runExperiment({
  agent,
  dataset,
  scorers: [scorer],
  concurrency: 2,
  store,
  ownership: { tenantId: "demo" },
  experimentId: "demo-exp",
});

console.log("experiment", report.experimentId, report.aggregate);

const session = await agent.session();
const liveResult1 = await session.run("Follow up with [2]");
const liveResult2 = await session.run("Follow up with [3]");
const liveRecords = [
  ...(await scoreRunLive(liveResult1, {
    scorers: [scorer],
    sampling: {
      rate: 0.5,
      strata: (r) => r.status,
      rates: { completed: 1 },
      always: (r) => r.status !== "completed",
    },
    seed: 1,
    store,
    ownership: { tenantId: "demo" },
  })),
  ...(await scoreRunLive(liveResult2, {
    scorers: [scorer],
    sampling: {
      rate: 0.5,
      strata: (r) => r.status,
      rates: { completed: 1 },
      always: (r) => r.status !== "completed",
    },
    seed: 2,
    store,
    ownership: { tenantId: "demo" },
  })),
];

const onlineEstimate = estimateOnline(liveRecords, { scorerId: "contains-citation", seed: 1 });
console.log("online estimate", onlineEstimate);

const page = await store.query({ tenantId: "demo", experimentId: "demo-exp" });
console.log(
  "stored evaluations",
  page.items.length,
  page.items.map((item) => item.score),
);
