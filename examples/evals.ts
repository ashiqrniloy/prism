import {
  createAgent,
  createMockProvider,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import {
  createMemoryEvaluationStore,
  defineDataset,
  defineScorer,
  runExperiment,
  scoreRunLive,
} from "@arnilo/prism-evals";

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

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([
    providerTextDelta("Prism is an agent harness [1]."),
    providerDone(),
  ]),
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

const liveResult = await agent.createSession().run("Follow up with [2]");
void scoreRunLive(liveResult, {
  scorers: [scorer],
  store,
  ownership: { tenantId: "demo" },
});

const page = await store.query({ tenantId: "demo", experimentId: "demo-exp" });
console.log("stored evaluations", page.items.length, page.items.map((item) => item.score));
