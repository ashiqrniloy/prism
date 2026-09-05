# Evaluations

## What it does

`@arnilo/prism-core/governance/evals` adds optional deterministic scorers, immutable datasets, bounded persistence-trace grading, explicit host model judges, pairwise comparisons, CI thresholds, live post-run scoring, and batch experiments over `AgentRunResult`. Scores are finite numbers in `[0, 1]` with optional reason/metadata and linkage to run/session/trace/experiment IDs.

## When to use it

Use this package when a host needs offline quality checks or sampled live scoring without coupling scorers into core agent execution. Install it directly or through the `@arnilo/prism-core` family package; installation does not attach scorers to runs.

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
| `datasetFromRuns` | `runIds` and/or `sessionIds`, existing dataset, `ProductionPersistenceStore`, ownership, redactor/secrets, optional `toItem` |
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
| `datasetFromRuns` | `{ dataset, version, added, skipped }` — new immutable dataset version with one item per added run; skips carry reasons (missing run, ownership mismatch, empty output) |

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
} from "@arnilo/prism-core/governance/evals";

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
- `datasetFromRuns` redacts before item construction and never stores an unredactable item; curated items are byte-capped (`ERR_PRISM_EVAL_CURATE`), ownership is verified exactly per run, and a failed append leaves the prior dataset version untouched.

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

`traceResolver` is explicit; no arbitrary run search occurs. `baseline`/`candidate` are host functions returning `AgentRunResult`. See `examples/evaluation-gate.ts` for a network-free gate and `examples/coding-browser-evaluation.ts` for coding/browser adversarial fixtures.

## Curating datasets from production runs

Plan 043 adds `datasetFromRuns`: it turns recorded runs (production incident transcripts included) into dataset items in one call — resolve through `createPersistenceTraceResolver`, redact, map through an optional host `toItem`, and append as a **new immutable dataset version**. The prior version object is never mutated.

```ts
import { datasetFromRuns, defineDataset } from "@arnilo/prism-core/governance/evals";

const result = await datasetFromRuns({
  runIds: ["run_9f2", "run_a71"],
  dataset: defineDataset({ id: "support-regressions", items: [] }),
  store: persistence,
  ownership: { tenantId: "t1", userId: "u1" },
  redactor,
  toItem: (run) => ({
    input: run.input,
    expected: run.feedback?.metadata?.expected, // human-graded gold from the feedback seam
    metadata: { graded: run.feedback?.rating },
  }),
});
// result.added === 2, result.dataset.version === "2"
```

Omit `toItem` and the default mapping is used: `input` = first user message, `expected` = the recorded feedback's `metadata.expected` when present, `output` = final assistant text under `metadata.output`.

- Session ids (`sessionIds`) expand to every run recorded under the session; bare `runIds` are located by one ownership-bounded scan of the run ledger (page/byte caps apply).
- Each resolved run maps to one item keyed by the run id. The default `toItem` carries the first user message as `input`; `expected` comes **only from the feedback seam** (`metadata.expected` of the latest human-graded `RunFeedbackRecord`) — never re-derived from untrusted outputs, and omitted entirely (not fabricated) when a run has no feedback. The recorded output rides `metadata.output` for provenance. A host `toItem` always wins and may return `undefined` to drop a run (`host filter` skip).
- Feedback costs one bounded, owner-scoped query per curation batch (`store.feedback`); records are read id-only per the feedback linkage contract — scorer payloads are never copied. A feedback query failure (e.g. scope contract mismatch) omits `expected` instead of aborting the batch.
- Every item field passes the host `redactor` after host mapping — fail closed: a redactor failure or an item over the frozen 4 MiB cap (`ERR_PRISM_EVAL_CURATE`) skips the run or aborts the append before anything is persisted. Cross-tenant runs are never readable (resolver ownership check → `ownership mismatch` skip).

Prompt versions can ride the same primitives: [`assertPromptPromotion`](prompt-registry.md#eval-gated-promotion) in `@arnilo/prism-core/governance/prompts` resolves two prompt versions, runs them through `runComparison`, and returns a `promote`/`hold` verdict with per-scorer aggregates and a bounded report — never applying the change itself.

## Coding and browser adversarial evaluations (0.0.9)

Release 0.0.9 ships curated network-free adversarial fixtures in package tests:

- `@arnilo/prism-coding-tools/agent` `eval-fixtures.test.ts`: safe native list vs shell, Git path/ref injection, dirty-tree rollback, unknown named-check failure, PR-handoff artifact completeness, and prompt-injection file content under read-only tools.
- `browser` `eval-fixtures.test.ts`: stale snapshot refs, side-effect approval, private/loopback/file deny, upload/download/screenshot policy, CSS/evaluate target rejection, and hostile accessible-name text.

Fixtures reuse `@arnilo/prism-core/governance/evals` (`defineDataset` / `defineScorer` / `scoreRun` / `assertEvaluationThreshold` / `serializeEvaluationReport`). Optional SWE-bench-compatible or live-browser harnesses remain host adapters — they are not default dependencies or quality claims. Protected real Docker/Playwright gates stay env-gated (`PRISM_TEST_DOCKER_SANDBOX`, `PRISM_LIVE_PLAYWRIGHT`) and never enter `sdk:ready`.

## PostgreSQL enterprise state (0.0.23)

`createPostgresEnterpriseState({ pool, schema }).evaluations` implements this package's existing `EvaluationStore`. The host creates an `EvaluationRecord` from verified ownership before append; every PostgreSQL query requires tenant scope, uses exact normalized account/user matching, and returns owner-bound opaque cursor pages. It is durable across reopen and supports the existing id/scorer/session/run/trace/dataset/item/experiment/status filters.

```ts
const state = await createPostgresEnterpriseState({ pool });
await state.evaluations.append(record); // record is already host-owned and redacted
const page = await state.evaluations.query({ tenantId: "t1", userId: "u1", status: "scored", limit: 100 });
```

Memory evaluation storage remains suitable for development and deterministic tests; it is not cross-replica production storage. PostgreSQL bounds each evaluation row to 64 KiB (reason/error 8 KiB each and metadata 32 KiB).

## ERP invariant evals (0.2.7)

Plan 027 adds two frozen exports to this package for the deterministic ERP release journey: `erpInvariantDataset` and `createErpInvariantScorers`. Scorers consume **structured journey facts only** — never model prose, credentials, or classified payloads. Each of the eight invariants is a hard 0/1 gate; no weighted average can hide an atomicity or security failure.

### Fact schema

The protected runner (`scripts/phase27-erp-journey.test.mjs`) carries the journey facts as JSON in `result.text`. Every scorer isolates its facts block and returns 1 only when every required fact is present and truthy:

| Invariant (scorer id) | Facts block | Required facts |
|---|---|---|
| `atomic-intent` | `atomic` | `committedAtomically` |
| `single-local-effect` | `delivery` | `singleLocalEffect`, `duplicateDelivered`, `businessMutationCount` |
| `compensation-terminal` | `compensation` | `compensated`, `reconciled`, `terminalStatus` |
| `quorum-provenance` | `quorum` | `distinctApprovers`, `requesterDenied`, `subagentDenied`, `revokedDenied`, `provenance` |
| `chain-verification` | `chain` | `verified`, `tamperedDetected`, `nextDigest` |
| `no-leak` | `noLeak` | `classifiedDenied`, `crossTenantDenied`, `secretRedacted` |
| `fenced-failover` | `fencedFailover` | `resumedByPeer`, `staleWriteRejected`, `cursorPreserved`, `failoverMs` |
| `restore-equality` | `restore` | `factsMatch`, `digestsMatch`, `drEvidenceFresh`, `restoreMs` |

### Hard-gate usage

```ts
import { createErpInvariantScorers, erpInvariantDataset, scoreRun } from "@arnilo/prism-core/governance/evals";

const scorers = createErpInvariantScorers();
const records = await scoreRun({
  result,                  // AgentRunResult whose .text is the JSON journey facts
  scorers,
  datasetId: erpInvariantDataset.id,
});
if (records.some((record) => record.status !== "scored" || record.score !== 1)) {
  process.exitCode = 1; // a single failing invariant fails the whole gate
}
```

### Execution command and substitutes

```sh
# Protected run (requires a disposable PostgreSQL instance):
PRISM_TEST_POSTGRES_URL=postgresql://... node --test scripts/phase27-erp-journey.test.mjs
```

The journey reuses the two-replica failover worker (`scripts/phase27-ha-worker.mjs`) and asserts the comprehensive DR drill evidence (`docs/_evidence/phase27-dr-evidence.json`) is present and not stale. Local substitutes are labelled in the journey evidence and never converted into production claims: an in-memory WORM/SIEM sink (host owns the immutable store in production), in-memory saga checkpoint/lease stores (saga durability is proven in its own suite), and a logical pg-client backup/restore of the ERP tables (comprehensive PITR is in the DR drill evidence). Passing this protected journey **does not** satisfy the 0.3.0 live-service matrix.


## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `AgentRunResult` and `session.run()`
- [Runs and usage ledger](runs-and-usage.md): run/session identity for score linkage
- [Observability](observability.md): use `onTraceReference` or bounded `traceId(runId)` to supply `ScoreRunOptions.traceId`; evaluation telemetry emits no reason/explanation content
- [Coding agent tools](coding-agent-tools.md) / [Browser automation](browser-automation.md) / [Workflows](workflows.md): network-free coding-task composition at `examples/durable-coding-workflow.ts`; adversarial coding/browser eval example at `examples/coding-browser-evaluation.ts`
- [Performance limits](performance.md): `scripts/benchmark-0.0.11.mjs` search/budget evidence, `scripts/benchmark-0.0.10.mjs` workspace-mode evidence, and `scripts/benchmark-0.0.9.mjs` coding/browser evidence fields
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable owner-scoped evaluation storage.
- [Release and install](release-and-install.md): optional package install and protected sandbox-browser workflow
