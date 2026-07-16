# Evaluations

## What it does

`@arnilo/prism-evals` adds optional deterministic scorers, immutable datasets, live post-run scoring, and bounded batch experiments over `AgentRunResult`. Scores are finite numbers in `[0, 1]` with optional reason/metadata and linkage to run/session/trace/experiment IDs.

## When to use it

Use this package when a host needs offline quality checks or sampled live scoring without coupling scorers into core agent execution. Install it directly or through `@arnilo/prism-all`; installation does not attach scorers to runs.

## Inputs / request

| API | Key inputs |
| --- | --- |
| `defineScorer` | `id`, `score({ result, item?, expected?, signal? })` |
| `defineDataset` | `id`, `version?`, immutable `items[]` with unique ids |
| `scoreRun` / `scoreRunLive` | `AgentRunResult`, scorers, optional `sampleRate`, store, ownership, redactor |
| `runExperiment` | `agent`, dataset, scorers, bounded `concurrency`, optional store/ownership |
| `createMemoryEvaluationStore` | optional seed records |
| `appendEvaluationFeedback` | `RunFeedbackStore`, `EvaluationStore`, feedback fields, and 1–64 known evaluation IDs |

## Outputs / response / events

| API | Output |
| --- | --- |
| `scoreRun` | `EvaluationRecord[]` with `scored` / `skipped` / `failed` |
| `scoreRunLive` | same records; never mutates the agent result; host may ignore the promise |
| `runExperiment` | `ExperimentReport` with stable item order, evaluations, and aggregates |
| `EvaluationStore.query` | cursor-paginated, ownership-filtered page |
| `appendEvaluationFeedback` | immutable `RunFeedbackRecord` containing only evaluation/scorer IDs |

## Request/response example

```json
{
  "scorerId": "contains-citation",
  "status": "scored",
  "score": 1,
  "runId": "run_1",
  "sessionId": "session_1",
  "experimentId": "exp_1",
  "sampled": true
}
```

## Implementation example

```ts
import { createAgent, createMemoryRunFeedbackStore, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  appendEvaluationFeedback,
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
  items: [{ id: "1", input: "Summarize with a citation" }],
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
  ownership: { tenantId: "t1", userId: "u1" },
});

const result = await agent.createSession().run("Follow up");
void scoreRunLive(result, { scorers: [scorer], store });
const evaluation = report.evaluations[0]!;
const feedbackStore = createMemoryRunFeedbackStore({
  resolveRun: ({ runId }) => runId === evaluation.runId
    ? { runId, sessionId: evaluation.sessionId!, tenantId: "t1", userId: "u1" }
    : false,
});
const linked = await appendEvaluationFeedback({
  feedbackStore,
  evaluationStore: store,
  evaluationIds: [evaluation.id],
  feedback: { id: "fb_1", runId: evaluation.runId!, rating: 1, tenantId: "t1", userId: "u1" },
});
console.log(report.aggregate.meanScore, linked.evaluationIds);
```

## Extension and configuration notes

- Function scorers are the base primitive. No mandatory LLM judge, dashboard, or schema library is included.
- Evaluation-result persistence remains package-local (`EvaluationStore`) and in-memory by default. Linked feedback is separately durable through optional `ProductionPersistenceStore.feedback`; evaluation score/reason payloads are not copied there.
- `sampleRate` is explicit (`0`–`1`). Inject `random` for deterministic tests.
- Dataset snapshots are frozen; duplicate item ids fail closed.
- `appendEvaluationFeedback()` resolves every supplied ID from `EvaluationStore`, rejects missing IDs, verifies each evaluation has the same run, optional trace, and exact ownership as feedback, then copies only deduplicated `evaluationIds`/`scorerIds`. Evaluation scores, reasons, errors, and metadata are not duplicated.

## Security and performance notes

- Scorers receive result/item data only. Credentials, tools, and workspace access are not provided unless the host deliberately closes over them.
- Records pass through `SecretRedactor` / `secrets` before store append.
- Queries filter by ownership scope. Feedback linkage additionally requires tenant plus account/user and the feedback store re-verifies the run.
- Experiment concurrency defaults to `1` and is capped at `32`. Scoring can reference run IDs without duplicating unbounded event payloads.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `AgentRunResult` and `session.run()`
- [Runs and usage ledger](runs-and-usage.md): run/session identity for score linkage
- [Observability](observability.md): trace/run metadata hosts may copy into `traceId`
- [Release and install](release-and-install.md): optional package install
