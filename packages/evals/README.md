# @arnilo/prism-evals

Optional deterministic scorers, immutable datasets, and bounded batch experiments over Prism `AgentRunResult`.

Install explicitly. This package is not included in profile bundles until a size/use review.

## Install

```bash
npm install @arnilo/prism-evals @arnilo/prism
```

## Usage

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  createMemoryEvaluationStore,
  defineDataset,
  defineScorer,
  runExperiment,
  scoreRunLive,
} from "@arnilo/prism-evals";

const scorer = defineScorer({
  id: "contains-citation",
  score: ({ result }) => ({ score: result.text.includes("[") ? 1 : 0 }),
});

const dataset = defineDataset({
  id: "citations",
  version: "1",
  items: [
    { id: "1", input: "Summarize with a citation", expected: "[" },
  ],
});

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("ok [1]"), providerDone()]),
});

const store = createMemoryEvaluationStore();
const report = await runExperiment({
  agent,
  dataset,
  scorers: [scorer],
  concurrency: 2,
  store,
  ownership: { tenantId: "t1" },
});

console.log(report.aggregate.meanScore);

const session = agent.createSession();
const result = await session.run("Follow up");
void scoreRunLive(result, { scorers: [scorer], store }); // does not change result
```

## API surface

| Export | Role |
| --- | --- |
| `defineScorer` | Deterministic function scorer (`score` in `[0, 1]`) |
| `defineDataset` | Immutable dataset snapshot; duplicate item ids fail closed |
| `scoreRun` / `scoreRunLive` | Score one `AgentRunResult`; live helper never mutates the result |
| `runExperiment` | Bounded concurrency batch runner with stable item order |
| `createMemoryEvaluationStore` | In-memory `EvaluationStore` with ownership filters |
| `appendEvaluationFeedback` | Verify same run/trace/ownership and copy only evaluation/scorer IDs into `RunFeedbackStore` |

## Security

- Scorers receive `AgentRunResult` / dataset item data only — no credentials, tools, or workspace access unless the host explicitly closes over them.
- Evaluation records accept `SecretRedactor` / `secrets` before persistence.
- Queries are ownership-scoped (`tenantId` / `accountId` / `userId`).
- Concurrency is capped (`HARD_EXPERIMENT_CONCURRENCY_CAP = 32`); sample rate is explicit.

See [Evaluations](../../docs/evaluations.md).
