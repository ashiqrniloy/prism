# Evaluations

## What it does

`@arnilo/prism-evals` adds optional deterministic scorers, immutable datasets, bounded persistence-trace grading, explicit host model judges, pairwise comparisons, CI thresholds, live post-run scoring, and batch experiments over `AgentRunResult`. Scores are finite numbers in `[0, 1]` with optional reason/metadata and linkage to run/session/trace/experiment IDs.

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
| `createPersistenceTraceResolver` | explicit `ProductionPersistenceStore`, exact session/run/ownership, page/byte bounds |
| `createModelJudge` | host judge callback, stable rubric/version, timeout/attempt/output bounds |
| `runComparison` | immutable dataset, 2–8 named candidates by default, pairwise scorers |
| `assertEvaluationThreshold` / `serializeEvaluationReport` | mean/failure/per-scorer gates and bounded redacted JSON |

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
- Experiment concurrency defaults to `1` and is capped at `32`. Datasets cap at 10,000 items.
- Trace reads default to 100 rows × 20 pages with a 4 MiB aggregate cap (hard: 1,000 × 100 and 32 MiB). Repeated/missing cursors, identity drift, ownership drift, and overflow fail closed before scoring.
- Model judges are host callbacks, not providers: Prism passes rubric/version plus bounded target only—never credential resolvers, tools, or workspace. Defaults are one attempt, 30 seconds, and 16 KiB output; failures become redacted evaluation records.
- Pairwise candidates are sorted by name, executed once per item, compared in stable item/pair/scorer order, and record ties/failures without choosing a winner. Candidate and scorer outputs have byte caps.
- `assertEvaluationThreshold()` throws `ERR_PRISM_EVAL_THRESHOLD`; an uncaught error gives CI a non-zero exit. Keep model-judge/live gates credential-gated and outside the network-free default suite. `serializeEvaluationReport()` bounds/redacts checked-in artifacts.

## Trace, judge, comparison, and CI example

```ts
const traceResolver = createPersistenceTraceResolver(persistence);
const judge = createModelJudge({
  id: "quality", rubric: "Score factual quality from 0 to 1", rubricVersion: "2026-07-20",
  judge: hostStructuredJudge,
});
const evaluations = await scoreRun({ result, scorers: [judge], traceResolver, ownership });
const comparison = await runComparison({ dataset, candidates: { baseline, candidate }, scorers: [preference] });
assertEvaluationThreshold(report, { minimumMean: 0.9, maximumFailures: 0 });
```

`traceResolver` is explicit; no arbitrary run search occurs. `baseline`/`candidate` are host functions returning `AgentRunResult`. See `examples/evaluation-gate.ts` for a network-free gate.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `AgentRunResult` and `session.run()`
- [Runs and usage ledger](runs-and-usage.md): run/session identity for score linkage
- [Observability](observability.md): use `onTraceReference` or bounded `traceId(runId)` to supply `ScoreRunOptions.traceId`; evaluation telemetry emits no reason/explanation content
- [Release and install](release-and-install.md): optional package install
