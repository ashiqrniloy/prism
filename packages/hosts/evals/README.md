# @arnilo/prism-evals

Host library providing evaluation, datasets, scorers, judges, experiments, and multi-turn scenarios for Prism agents. It operates over public `Agent` and `Session` surfaces and does not construct an agent directly.

Imports into host libraries are strictly governed by [`scripts/host-surface-allowlist.json`](../../../scripts/host-surface-allowlist.json).

## Evaluation and experiment storage

Import `EvaluationRecord`, `EvaluationStatus`, `EvaluationQuery`, `EvaluationStore`,
`ExperimentReportRecord`, `ExperimentReportQuery`, and `ExperimentReportStore` from `@arnilo/prism`.
The memory implementations live in `@arnilo/prism-store-codecs`; evals no longer exports the
moved types or `createMemoryEvaluationStore`.

```ts
import { createMemoryEvaluationStore, createMemoryExperimentReportStore } from "@arnilo/prism-store-codecs";
import { runExperiment } from "@arnilo/prism-evals";

const ownership = { tenantId: "tenant", userId: "user" };
const store = createMemoryEvaluationStore();
const experimentStore = createMemoryExperimentReportStore();
const report = await runExperiment({ agent, dataset, scorers, ownership, store, experimentStore });
const baseline = await experimentStore.latest({ ...ownership, datasetId: dataset.id,
  manifestMatch: { runtimeRevision: "release-1" } });
```

`runExperiment` awaits **one summary write per completed experiment**, including failed or aborted
experiments that produce a report. Store failures reject the call. `toExperimentReportRecord(report,
ownership?)` builds the same immutable summary: dataset identity/hash, manifest, aggregate statistics,
and per-item scorer means over scored records. It excludes item input/output, reasons, trial content,
and record metadata. Summaries exceeding **1 MiB** throw `ERR_PRISM_EVAL_REPORT_BOUNDS`.
`metadata` on the summary is reserved for explicit store callers; the converter never copies it.

Queries match tenant, account, and user exactly, including absent fields. An unscoped query reads
only unowned records. Reuse the full ownership scope on writes and queries. Pagination defaults to
100 records, caps at 1,000, and returns a cursor for the last returned record. `latest` selects the
newest dataset/owner match, breaking timestamp ties by id; `manifestMatch` matches each supplied
manifest field exactly. These optional capabilities are declared on `ProductionPersistenceStore`;
SQL adapter implementations follow in plan 201 Task 3. Stored item means do not retain trial labels
or tags: reconstructing a full report for `compareExperiments` needs host-supplied report context.

## Install

```bash
bun add @arnilo/prism-evals
```

`@arnilo/prism` is a required peer. `@arnilo/prism-observability` is an **optional** peer: it is needed only to project timelines (`timeline: "metadata" | "redacted_io"`). Text-only scoring and experiments never load it, and asking for a timeline without installing it throws `EvalError` `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` naming the package.

```jsonc
{ "@arnilo/prism-evals": "^0.13.0", "@arnilo/prism-observability": "^0.13.0" }
```

## Evaluation telemetry

`scoreRun`, `scoreRunLive`, `runExperiment`, and `runScenario` accept an optional
`telemetry: EvaluationTelemetrySink`. It receives one call per stored/returned record after
redaction, including scored, failed, sampled-out, per-step, and simulator-failure skips.
No model calls are added. With a store, a failed append propagates before telemetry is called.

```ts
import type { EvaluationTelemetry } from "@arnilo/prism-observability";

// instrumentation is a host-held createOpenTelemetryInstrumentation() instance.
const telemetry = { handleEvaluation: (e: EvaluationTelemetry) => instrumentation.handleEvaluation(e) };
await scoreRunLive(result, { scorers, telemetry, onError: (error) => console.error(error) });
```

The payload contains only `runId`, scorer id as `name`, `status`, optional `score`, and
`hasReason`; it never includes reason/error text, input/output, metadata, or ownership.
A simulator failure before any run uses the evaluation record id as its standalone
correlation id. Sink exceptions leave records unchanged: live scoring reports each through
`onError`; direct scoring, experiments, and scenarios ignore them. The sink is synchronous;
async exporters must handle their own failures. Only the payload type references the optional
observability peer; supplying a structural sink does not load or require it at runtime.
The package definition does not expose its internal instrumentation instance.

## Online evaluation

`scoreRunLive`, `scoreRun`, and `runExperiment` accept `sampling: EvaluationSampling` (replacing the retired `sampleRate` option) to stratify and weight online or sampled evaluations:

```ts
import { estimateOnline, scoreRunLive } from "@arnilo/prism-evals";

const records = await scoreRunLive(result, {
  scorers: [citationScorer],
  sampling: {
    rate: 0.1,
    strata: (run) => run.status,
    rates: { completed: 0.05 },
    always: (run) => run.status !== "completed",
  },
  seed: 42,
  store,
  ownership: { tenantId: "acme" },
});

const estimate = estimateOnline(records, { scorerId: "contains-citation", seed: 42 });
// { scorerId, n, effectiveN, mean, ci95: { low, high }, byStratum: { ... } }
```

- `rate` is the default per-run inclusion probability in `[0, 1]` (defaults to `1`).
- `strata(result) => string` classifies the run once per `scoreRun` call (`"default"` when omitted) and makes no extra model calls.
- `rates: Record<stratum, number>` overrides the inclusion probability for matching strata in `[0, 1]`.
- `always(result) => boolean` forces inclusion probability `1` when true (for example, failed runs or runs with denied tools), overriding `rate` and `rates[stratum]`.
- Probability `0` for a run or stratum records nothing (`[]` returned, no store append, no telemetry emitted).
- With a Positive probability, each emitted record stores `metadata.sampling = { stratum, probability }`. Scorer-returned `metadata.sampling` cannot overwrite this record metadata. When `sampling` is configured and a run is not selected by the random draw, `scoreRun` records a `skipped` record with `reason: "sampled out (`<probability>`)"` and the same `metadata.sampling`.
- When `seed` is provided without a custom `random`, `scoreRun` derives a deterministic per-run stream via `mulberry32(hash32(seed, experimentId, datasetId, itemId, runId, sessionId))`.
- `estimateOnline(records, { scorerId, seed = 0, resamples = 2000, confidence = 0.95 })` filters to `status === "scored"` records for `scorerId` and computes the Horvitz–Thompson / Hájek ratio weighted mean `(Σ y_i / π_i) / (Σ 1 / π_i)`, Kish's effective sample size `(Σ w_i)² / Σ w_i²` (`w_i = 1 / π_i`), per-stratum `{ n, mean, weightSum }`, and a percentile bootstrap confidence interval (`ci95`) via `bootstrapInterval` (`undefined` when `n < 2`). Every scored record for `scorerId` must carry valid `metadata.sampling` with a non-empty `stratum` and `probability` in `(0, 1]`; unweighted or malformed records fail closed with `EvalError` (`ERR_PRISM_EVAL_STATS`).

## Statistics

The statistics helpers are standalone pure TypeScript utilities with no runtime dependency.

```ts
import { bootstrapInterval, passAtK, wilsonInterval } from "@arnilo/prism-evals";

wilsonInterval(18, 20); // { low: 0.698966…, high: 0.972134… }
passAtK(10, 3, 5); // 0.916666…
bootstrapInterval([0, 0, 1, 1], {
  statistic: (xs) => xs.reduce((sum, x) => sum + x / xs.length, 0),
  clusterIds: ["item-a", "item-a", "item-b", "item-b"],
  seed: 7,
}); // { low: 0, high: 1 }
```

In the formulas below, `N` is the number of records, `G` the number of clusters,
`q` the discordant-pair rate, `d` the absolute paired effect, `Φ` the standard normal CDF,
and `z = Φ⁻¹(1−α/2)`.

| Function | Formula and use |
| --- | --- |
| `wilsonInterval(successes, n, confidence = .95)` | `(p + z²/(2n) ± z√(p(1−p)/n + z²/(4n²))) / (1 + z²/n)`. Use for independent binary outcomes, including zero or all successes. [Wilson (1927)](https://doi.org/10.1080/01621459.1927.10502953). |
| `clusteredStandardError(values, clusterIds)` | CR1: `√(G/(G−1) × Σ_g (Σ_i∈g (x_i−mean))² / N²)`. Use when trials share an item; requires at least two distinct clusters. Singleton clusters give the usual sample SE. [Miller (2024), §2.2 and Appendix A](https://arxiv.org/abs/2411.00640). |
| `bootstrapInterval(values, { statistic, seed, resamples = 2000, confidence = .95, clusterIds? })` | Percentile interval `[Q(α/2), Q(1−α/2)]` with linear quantile interpolation. Draws `N` records or `G` entire clusters with replacement. Unequal clusters keep their sizes, so record means remain record-weighted. [Efron & Tibshirani (1993)](https://doi.org/10.1201/9780429246593). |
| `mcnemarExact(aOnly, bOnly)` | `min(1, 2 P(Binomial(aOnly+bOnly, .5) ≤ min(aOnly,bOnly)))`. Two-sided exact test for discordant binary pairs; returns 1 with no discordance. [McNemar (1947)](https://doi.org/10.1007/BF02295996). |
| `pairedPermutationTest(differences, { seed, resamples = 10000 })` | `P(abs(Σ sign_i d_i) ≥ abs(Σ d_i))`. Two-sided paired sign-flips; enumerate all signs when `n ≤ 16`, otherwise use Monte Carlo `(extreme+1)/(resamples+1)`. Fisher (1935), *The Design of Experiments*. |
| `benjaminiHochberg(pValues)` | Sorted `q_(i) = min_{j≥i}(1, m p_(j)/j)` returned in input order. Adjust a family of p-values for false discovery rate under independence or appropriate positive dependence. [Benjamini & Hochberg (1995)](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x). |
| `passAtK(n, c, k)` | `1 − C(n−c,k)/C(n,k)` via a stable product: probability at least one of `k` draws succeeds. [Chen et al. (2021), §2.1](https://arxiv.org/abs/2107.03374). |
| `passHatK(n, c, k)` | `C(c,k)/C(n,k)`: probability all `k` draws without replacement succeed. [Yao et al. (2024), τ-bench §3](https://arxiv.org/abs/2406.12045). |
| `pairedProportionPower({ discordantRate, effect, n, alpha = .05 })` | `Φ((−z√q−√n d)/√(q−d²)) + Φ((√n d−z√q)/√(q−d²))`. Two-sided normal approximation to McNemar, without continuity correction. [Connor (1987)](https://doi.org/10.2307/2531961). |
| `minimumDetectableEffect({ discordantRate, n, alpha = .05, power = .8 })` | Inverts the same power formula over `[0, q]`; throws if target power is unattainable. Use to size the smallest detectable paired effect. |

Both interval functions return `{ low, high }`. Samples must be nonempty and finite; counts must be
safe integers (`n ≥ 1`, `0 ≤ c ≤ n`, `1 ≤ k ≤ n`); confidence and alpha lie strictly in `(0, 1)`.
Power calculations require `0 < q ≤ 1`, `abs(effect) ≤ q`, and `alpha < power < 1` for inversion.
Cluster ids are nonempty strings or finite numbers, one per record. Seeds are required safe integers,
mapped to the existing `mulberry32` 32-bit stream; repeated calls with the same inputs reproduce results.
Invalid input, a throwing statistic, or a non-finite statistic result throws `EvalError` with
`code: "ERR_PRISM_EVAL_STATS"`.

Resamples must be integers in `[1, HARD_STATS_RESAMPLES]` (`100_000`), including when permutation
enumeration is exact. Bootstrap costs `O(resamples × N)` in expectation for a linear-time statistic,
plus sorting `resamples` statistics; unequal cluster sizes can produce longer individual resamples.
Monte Carlo permutation costs `O(resamples × N)`; exact permutation costs `O(2^N × N)` for `N ≤ 16`.
The test suite allows 1 second for the 1,000-item / 2,000-resample bootstrap (4× the 250 ms target).
Normal quantiles and the power CDF use rational approximations; CDF absolute error is below `7.5e-8`.

## Datasets

`defineDataset` returns a deeply frozen JSON snapshot and computes one SHA-256 over its items (at most 10,000). `contentHash` is `sha256:` plus 64 lowercase hex digits. Object keys are sorted, array/item order is preserved, object properties with `undefined` are dropped, and undefined array entries become `null`, as in JSON. Functions, cycles, non-finite numbers, bigint, symbols, and non-JSON objects fail with `EvalDatasetError` (`not serializable`). Dataset id, version, metadata, and canary are outside the item hash; item metadata is included.

```ts
const dataset = defineDataset({ id: "support", version: "3", canary: "prism-eval-canary-7f3c", items: [
  { id: "q1", input: "Where is my order?", expected: "tracking", split: "heldout",
    tags: ["tracking"], label: { source: "human", adjudicated: true, by: "reviewer-1" } },
] });
const report = await runExperiment({ agent, dataset, scorers, split: "heldout", allowHeldout: true });
validateReleaseEvalManifest({ ...manifest, datasetContentHash: dataset.contentHash }, report);
```

`split` is `dev`, `test`, or `heldout`; `runExperiment.split` accepts one or an array. Without a filter all items are selected, including unassigned items. An explicit filter omits unassigned items. Any selected heldout item requires `allowHeldout: true` before any agent runs; otherwise `EvalDatasetError` has code `ERR_PRISM_EVAL_HELDOUT`. Keep heldout results away from prompt tuning; the opt-in controls execution, not access to dataset content.

Items may have up to 16 tags of at most 64 characters each, and `label: { source, adjudicated?, by? }`, where source is `human`, `model`, `curated`, or `synthetic`. `aggregate.byTag[tag].scorers` repeats the full per-scorer statistics for that tag; duplicate tags count an item once and untagged items contribute only to the overall aggregate. `compareExperiments(a, b, { byTag: true })` returns per-tag comparisons and applies BH correction across all tag/scorer tests, separately from the overall scorer family. Tags with fewer than two paired items are omitted. Comparisons reject different dataset content hashes, including when only one report carries a hash; external score-only reports with neither hash retain their existing behavior.

Reports record `datasetContentHash` and the requested `split`. `validateEvalManifest` still accepts the two revision fields; `validateReleaseEvalManifest(manifest, report?)` additionally requires a valid `datasetContentHash` and, with a report, an exact hash match. Rubric hashes share the sorted-key canonical JSON helper; hashes created before this change must be regenerated.

An optional canary (at most 128 characters) appears in `dataset.canary`, `dataset.metadata.canary`, and the serialized report. Use a unique inert marker and search suspected training corpora, for example `rg --fixed-strings 'prism-eval-canary-7f3c' path/to/corpus`. A hit can reveal contamination; no hit does not prove its absence. Report serialization still applies configured secret redaction and byte limits.

## Scorers

Custom scorers use `defineScorer`; the built-ins cover the common trajectory checks.

| Scorer | `requires` | `invariant` | Checks |
| --- | --- | --- | --- |
| `createToolCallMatchScorer` | `timeline` | with `deny` or `invariant: true` | expected tool calls present, in order or unordered |
| `createApprovalBeforeEffectScorer({ tools })` | `timeline` | yes | an effect passes only with an `approved` `hitl` step for the same `toolCallId` before it |
| `createGuardrailPackScorer({ forbidTools })` | `timeline` | yes | no guardrail-pack denial for the forbidden tools |
| `createSchemaScorer` | `timeline` | no | final output parses against a JSON schema |
| `createErrorClassScorer()` | `timeline` | with `deny` | denied error classes never appear (and scores `0` with no evidence) |
| `createNoLoopScorer` | `timeline` | yes | no repeated identical tool call |
| `createCitationIntegrityScorer` | `environment` | yes | citations resolve against a live source |
| `createStateMatchScorer` | `environment` | with `invariant: true` | final JSON state equals or contains a goal state |
| ERP invariant scorers | — | yes | amount/approval/effect invariants on the result text |
| `createModelJudge` | — | no | low-level host judge adapter; see `createRubricJudge` for rubric judging |
| `createRubricJudge` | timeline when `include: "answer+timeline"` | no | labeled rubric judging with a tool-less agent |

`requires` is checked once by `scoreRun`, `runExperiment`, and `runScenario` **before** any agent run: a scorer that needs a timeline and is handed `timeline: "off"` throws `ERR_PRISM_EVAL_TIMELINE_REQUIRED` (`_TRACE_REQUIRED`, `_ENVIRONMENT_REQUIRED` likewise) instead of scoring a silent zero.

`createStateMatchScorer({ expected, select?, mode: "exact" | "subset", ignore?, invariant? })` compares final JSON state supplied by `toEnvironment` (or `scoreRun.environment`). `expected` is a value or `(item) => item?.expected`; `select` projects the environment before comparison. Exact mode checks all keys; subset mode checks every expected key recursively and allows extra actual keys. Arrays compare by index, so a subset array matches a prefix, preserving order and duplicates. `ignore` contains JSON pointers relative to the selected state (including escaped `~0` and `~1`); ignored array slots do not shift other indices, and the empty pointer ignores the whole state. Neither input is mutated.

Both compared states pass through `ScorerInput.redactor` before comparison, so differences hidden by redaction are intentionally equivalent. Each selected actual/expected JSON snapshot is capped at 1 MiB before and after redaction; exceeding it produces a failed record with `ERR_PRISM_EVAL_STATE_BOUNDS`. Comparison is linear in state size. Mismatches score 0 with at most 32 `metadata.diff` entries `{ path, expected, actual }`; paths are JSON pointers, missing values are `undefined`, and values over 256 serialized UTF-8 bytes become truncated strings. The diff also passes through normal record redaction. Matches score 1; `invariant: true` makes this a hard gate.

`createApprovalBeforeEffectScorer({ tools })` treats approval as evidence, not intent. `tools` (normally `agent.tools`) selects the calls whose `effects` include `write`, `execute`, or `external`; a tool step it does not declare is assumed effectful. An effect passes only when an `approved` `hitl` step for the same tool call precedes it — a denied or still-suspended decision fails the call, and a `succeeded` guardrail step never stands in for a human decision.

```ts
const records = await scoreRun({ result, scorers: [createToolCallMatchScorer({ mode: "unordered", expected: ["search"] })], timeline: "metadata", injectedTimeline: timeline });
```

- `timeline: "metadata"` needs a `traceResolver` in `scoreRun`; `runExperiment` and `runScenario` project while running, so they only need the mode.
- `forEach: "tool" | "workflow_node"` scores each matching step separately and passes it as `ScorerInput.step`, recording `stepId`. With no matching step it records one `skipped` record per scorer with reason `no matching steps` — absence of steps never reads as absence of failures.

## Hard invariants

A scorer declares itself a safety gate with `invariant: true`. `scoreRun` stamps `metadata.invariant` on every record of such a scorer — including a `failed` record from a scorer that threw — and `runExperiment` reports `aggregate.invariantsPassed: false` unless all of them scored `1`.

```ts
const noForbiddenTool = defineScorer({
  id: "no_drop_database",
  invariant: true,
  requires: ["timeline"],
  score: ({ timeline }) => ({ score: timeline?.steps.some((step) => step.name === "drop_database") ? 0 : 1 }),
});

assertEvaluationThreshold(report, { requireInvariants: true }); // fails when no invariant scorer ran at all
```

- Only the declaration counts. A `metadata.invariant` returned from `score` is stripped, so a scorer cannot promote itself at runtime.
- A non-invariant failure (a judge timeout, say) is a normal failure: `maximumFailures` governs it and it does not make `invariantsPassed` false.
- `requireInvariants: true` additionally fails when the report has no invariant records, so a threshold that expects a safety gate cannot pass because the gate was never configured.

## Experiments

`runExperiment({ agent, dataset, scorers, trials })` runs a dataset over an agent with bounded concurrency and per-scorer statistics.

`aggregate.scorers[id]` contains `{ items, records, mean, passRate, passAtK?, passHatK?, passKCounts?, se?, ci95?, method }`. Only scored numeric records enter statistics; failed and skipped records retain their separate counts. Records are grouped by item: `mean` averages item means, so repeated trials and `forEach` steps cannot outweigh another item. `aggregate.macroMean` is the unweighted mean of scorer means and is absent when nothing scored.

`se` uses CR1 over records clustered by item. With unequal record counts this estimates uncertainty of the record-weighted mean; the reported `mean` and bootstrap interval remain item-weighted. A binary scorer with exactly one record per item uses a Wilson 95% interval (`{ low, high }`). Otherwise the report bootstraps item means (equivalent to drawing whole items with equal weight), once per scorer, with 2,000 resamples and `seed` (default `0`). This costs O(2,000 × items) per scorer plus sorting. With fewer than two scored items, `se` and `ci95` are absent and `method` is `"single_item"`; otherwise it is `"wilson"` or `"cluster_bootstrap"`. Trial metadata contains only `count`, optional `seed`, and `sampleCount`.

`minimumMacroMean` and `minimumByScorer` are point-estimate gates; they do not test statistical significance.

```ts
const report = await runExperiment({ agent, dataset, scorers, trials: 3, seed: 7, concurrency: 4, timeline: "metadata" });
assertEvaluationThreshold(report, { minimumMacroMean: 0.8, requireInvariants: true });
```

- A `seed` gives each `(itemId, trialIndex)` its own stream — `mulberry32(hash32(seed, itemId, trialIndex))` — so sampled trials are identical at any concurrency. An explicit `random` instead shares one stream and is order-dependent.
A scorer's `passThreshold` is a finite number in `[0, 1]`, defaulting to `1`. A scored record passes when `score >= passThreshold`. `passRate` averages each item's fraction of passing scored trials, giving each item equal weight. Failed/skipped records are excluded, and an item with no scored trials contributes no pass fraction.

With `trials > 1`, each scorer also reports numeric `passAtK[k]` (at least one success) and `passHatK[k]` (all succeed) for `k = 1..trials`, averaged over items with at least `k` scored trials. These use the without-replacement estimators in Statistics above, extended incrementally across k. `passKCounts[k]` gives `{ items, excludedItems }`, counting excluded items against the full dataset, including items with no scored trials. A k with no eligible items has counts but no estimate; a scorer with no scored records is absent entirely. Exclusions can bias the result if missing trials depend on outcome; inspect the counts and failure total. Reliability summaries add O(items × trials) work. Setting `trials: k` multiplies agent runs by k (and usually cost).

```ts
const success = defineScorer({ id: "task_success", passThreshold: 1, score: checkTask });
// Run with scorers: [success], trials: 4, then require reliable repeated success:
assertEvaluationThreshold(report, { minimumPassHatK: { task_success: { k: 4, minimum: 0.8 } } });
```

`minimumPassHatK` validates positive integer k and a minimum in `[0, 1]`; it fails when the scorer or k estimate is absent, including single-trial reports. With one item passing 2 of 4 trials, `passRate` is 0.5, `passAtK[4]` is 1, and `passHatK[4]` is 0. Hard invariants still require every record to score exactly 1, regardless of `passThreshold`.

- Aborting keeps the work that finished: finished items retain their results and evaluations, unstarted items carry the abort reason, `status` is `aborted`, and `aggregate` counts only the finished items.
- `hooks` and `slots` are passed to an agent factory exactly as `runScenario` does; combining them with an `Agent` instance throws `ERR_PRISM_EVAL_EXPERIMENT`.

## Usage, cost, and latency

Every `runExperiment` item has `trials: [{ usage?, durationMs?, status, costComplete }]`, including single-trial experiments. `usage` preserves `RunResult.usage`; `result` still holds the last available run. Duration measures only `session.run` with a monotonic clock, including thrown/aborted runs, and excludes agent creation, input conversion, scoring, and timeline drain. Unstarted trials carry `status: "aborted"`, no duration/usage, and `costComplete: false`.

`aggregate.cost` sums observed `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, and `cacheWriteTokens`. Absent counts stay absent; available counts can be partial, and `estimated: true` propagates if any trial used estimates. `meanPerItem` divides these totals by the dataset item count, including all trials per item. `meanPerItem.durationMs` likewise divides summed measured run time by item count; it is work per item, not concurrent experiment wall time. `durationMs: { p50, p95 }` uses nearest-rank percentiles over measured trial times and is absent if no run was timed.

Billing is stricter: `cost` (and its per-item mean) is present only when **every** trial has finite, nonnegative, non-estimated cost, every provider attempt has complete pricing evidence, and all currencies match. Missing currency matches only another missing currency; no conversion or currency assumption is made. The collector observes turn and terminal run events even with timeline off, using constant accounting state and making no extra provider calls. Unpriced turns, missing/truncated evidence, mixed currencies, unstarted trials, and empty runs leave the total absent and `costComplete: false`. A trial's raw `usage.cost` can be partial; inspect its `costComplete` before treating it as a bill. Scorer/judge calls and agent setup costs are outside agent-run accounting.

```ts
import { paretoFrontier } from "@arnilo/prism-evals";

const frontier = paretoFrontier(reports, {
  quality: r => r.aggregate.macroMean ?? 0,
  cost: r => r.aggregate.cost?.cost ?? Infinity,
});
```

`paretoFrontier` maximizes quality and minimizes cost. A point is dominated when another is at least as good on both axes and strictly better on either. It returns the original report objects in ascending cost order, retaining identical points in input order and leaving the input untouched. Quality must be finite; cost must be finite or positive `Infinity` (for unknown billing), otherwise it throws `ERR_PRISM_EVAL_STATS`. Unknown cost is not a free run and can remain on the frontier if its quality is higher; filter incomplete reports first if you need only known bills. Compare the same quality metric and currency across reports; the callbacks do not convert currencies. Selection costs O(reports × log(reports)) and runs no agents.

## Multi-turn scenarios

`runScenario(scenario, agentFactory, options)` runs conversational clarification, refusal, and multi-turn workflows over a host-built agent.

```ts
const result = await runScenario(
  { turns: ["Transfer 50 USD", { user: "Yes, confirm", assertReply: (text) => text.includes("denied") }], maxTurns: 4 },
  (extra) => createAgent({ model: { provider: "mock", model: "demo" }, ...extra }),
  { scorers, timeline: "metadata", scoreTurns: "each" },
);
```

- `turns` is bounded, not truncated: more turns than `maxTurns` (default 8, hard cap 32) throws `ERR_PRISM_EVAL_SCENARIO_BOUNDS` before the agent is built, so a cut-off scenario cannot pass for the wrong reason.
- `status` is `succeeded`, `failed`, or `aborted` (a host signal, or a final run the agent aborted). A throwing `assertReply` stops the scenario with `failed` and `ERR_PRISM_EVAL_SCENARIO_ASSERTION` naming the turn.
- `scoreTurns: "each"` scores every turn on that turn's result and timeline slice, recording `metadata.turnIndex`; the default `"last"` scores only the final turn. `"each"` multiplies scorer calls (and judge cost) by the turn count.

Scenario inputs also work in ordinary datasets, including mixed single-turn and
multi-turn items:

```ts
const dataset = defineDataset({ id: "refunds", items: [{
  id: "r1", input: { kind: "scenario", turns: ["I want a refund", "Order 42"], scoreTurns: "each" },
}] });
const report = await runExperiment({ agent: factory, dataset, scorers, trials: 3, timeline: "metadata" });
```

Each trial opens a fresh session, even when `agent` is an existing instance. The
factory receives the experiment's `hooks` and `slots`; ownership, cancellation,
redaction, and run options apply on every turn. `toEnvironment` runs after the
last turn by default, or after each turn with `scoreTurns: "each"`. Stored records
carry `itemId`, `metadata.trialIndex`, and, when scoring each turn,
`metadata.turnIndex`. Statistics and storage use the ordinary experiment pipeline;
trial usage and duration include all scenario runs. Cost equals running those
turns individually, with no extra model calls. A non-completed run ends the loop.

Dataset scenarios must be JSON: use strings or `{ user: message }` turns;
function-valued `assertReply` remains available only in standalone scenarios.
`ScenarioInput` accepts exactly one of `turns` or `user`. Invalid turn bounds,
scoring modes, or both/neither input sources fail before an agent is constructed.
The existing standalone `runScenario` signatures and exports remain available.

## Simulated users

```ts
const user = createUserSimulator({
  agent: simulatorAgent, persona: "terse customer",
  goal: "Get a refund for order 42 to the original card.",
});
const result = await runScenario({ agent, user, scorers, secrets: [customerSecret] });
// Or: defineDataset({ id: "refunds", items: [{ id: "r1", input: { kind: "scenario", user } }] })
console.log(result.simulation); // { turns: [{ user, assistant }], stopReason, simulatorModel }
```

Simulation is opt-in: one extra simulator model call per proposed user turn,
including a call that returns the stop token. `maxTurns` defaults to **8** (hard
cap 32); `stop` defaults to `"###DONE###"` and must match the trimmed reply exactly.
An explicit scenario `maxTurns` can lower the simulator's limit. The loop stops
on the token (`goal_reached`), the limit (`max_turns`), or a non-completed agent
run (`agent_stopped`). Experiment trial entries also retain `simulation`.

Each proposal uses a fresh, closed, tool-less session, one provider attempt, and
no continuation. The versioned prompt contains only persona, hidden goal, stop
token, and text conversation: expected answers, environment state, timelines,
and tool I/O are excluded. The resolved scorer redactor (`redactor` plus
`secrets`) redacts this data before sending it to the simulator and redacts the
recorded simulation turns. `timeoutMs` defaults to 30,000 (hard cap 300,000);
prompts are capped at 1 MiB and replies at 16 KiB. Empty, oversized, failed, or
timed-out replies fail the scenario with `ERR_PRISM_EVAL_USER_SIMULATOR` and skip
its scorers with that reason. Per-turn scoring is deferred until simulation
finishes so simulator failures cannot count against the agent. Existing agent
failures still receive normal scoring. Simulator tokens/cost are additional to
the target-agent usage reported by experiment accounting.

The simulator specification and model identity are JSON; its host-owned agent
binding is held outside the hash in a weak map and preserved by `defineDataset`.
After loading serialized items, rebuild each `user` with
`createUserSimulator({ ...savedUser, agent: simulatorAgent })` before
`defineDataset`. Unbound specs fail closed. The host retains responsibility for
disposing both agents. No credentials or agent object enter dataset JSON.

## Failure injection

`failureInjection(options)` builds an `AgentConfig.hooks` value that denies tools via `tool.call` and marks unknown effects via `tool.execute`; `failingStore(store)` wraps a `SessionStore` to fail on the first append. Both exist so a test can prove a host degrades safely without a real outage.

## Curation

`datasetFromRuns({ dataset, runIds, sessionIds, store, ownership })` resolves recorded runs from the production store, redacts, maps each run through `toItem`, and appends the results as a new immutable dataset version.

```ts
const { dataset: next, added, skipped } = await datasetFromRuns({ runIds: ["run_a"], dataset, store, ownership });
// skipped: [{ id: "run_a", reason: "already in dataset" }]
```

- Idempotent by run id: every candidate is checked against the existing item ids before any trace is read, so a repeat sweep costs one `Set` lookup per run. A custom `toItem` id that collides with an existing item is caught after mapping and skipped the same way, so one pass cannot add a duplicate either.
- New items carry `label.source: "human"` when feedback metadata supplied `expected`, otherwise `"curated"`; existing labels, dataset metadata, and canary are preserved.
- Datasets are immutable versions; an existing item is never replaced — a changed label is a new item id or a new version, the host's choice.
- When every candidate skips, the input dataset object and its `version` come back unchanged (`added: 0`).
- Skip reasons: `missing run`, `ownership mismatch`, `empty output`, `host filter` (a `toItem` returning `undefined`), `redaction failed`, and `already in dataset`.
- Versioning: numeric versions increment (`1` → `2`); a non-numeric label keeps its prefix and counts in a trailing `.N` (`v1` → `v1.1` → `v1.2`, `v1.9` → `v1.10`).

## Thresholds and reports

`assertEvaluationThreshold(report, thresholds)` throws `EvalError` `ERR_PRISM_EVAL_THRESHOLD` unless every requested gate holds: `minimumMacroMean`, `maximumFailures`, `minimumByScorer`, `minimumPassHatK`, `minimumLowerBound`, `maximumRegression`, `minimumCandidateWins`, and `requireInvariants` (which also fails when no invariant scorer ran at all). `serializeEvaluationReport` writes the stable JSON form for a CI artifact.

## Errors

All failures are `EvalError` subclasses carrying a stable `code`:

| Code | Raised when |
| --- | --- |
| `ERR_PRISM_EVAL_SCORE` | a scorer returned a non-finite or out-of-range score |
| `ERR_PRISM_EVAL_HELDOUT` | heldout items selected without `allowHeldout: true` |
| `ERR_PRISM_EVAL_DATASET` | a dataset manifest, item, or revision pin is invalid |
| `ERR_PRISM_EVAL_TRACE_REQUIRED` / `_TIMELINE_REQUIRED` / `_ENVIRONMENT_REQUIRED` | a scorer's declared requirement is not available |
| `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` | a timeline was requested but `@arnilo/prism-observability` is not installed |
| `ERR_PRISM_EVAL_SCENARIO_BOUNDS` | `maxTurns`/`turns` exceed the bounded scenario contract |
| `ERR_PRISM_EVAL_SCENARIO_ASSERTION` | a turn's `assertReply` threw |
| `ERR_PRISM_EVAL_EXPERIMENT` | experiment options cannot work (e.g. `hooks` with an `Agent` instance) |
| `ERR_PRISM_EVAL_CURATE` | a curated item exceeds the byte cap |
| `ERR_PRISM_EVAL_JUDGE_PANEL` | invalid panel/model diversity or fewer than half of panel judges succeeded |
| `ERR_PRISM_EVAL_JUDGE_SELF` | the candidate model identity is missing or equals the judge model without explicit opt-in |
| `ERR_PRISM_EVAL_JUDGE_OUTPUT` | a rubric judge reply is invalid after the configured attempts |
| `ERR_PRISM_EVAL_JUDGE_TIMEOUT` / `_JUDGE_BOUNDS` | a judge attempt timed out or a byte/option bound was exceeded |
| `ERR_PRISM_EVAL_SCORER` / `_JUDGE` / `_MANIFEST` / `_TRIALS` / `_COMPARISON` | an invalid scorer, judge, manifest, trials, or comparison input |
| `ERR_PRISM_EVAL_CALIBRATION` | invalid calibration options, unsettled runs, or exceeded item/matrix bounds |
| `ERR_PRISM_EVAL_THRESHOLD` | an evaluation threshold was not met |
| `ERR_PRISM_EVAL_STORE_FAILURE` | an evaluation store append or query failed |

## Cost, security, and failure behavior

- **Judge cost.** Model judges (`createModelJudge`) invoke an LLM once per evaluation item, so cost scales as `O(items × trials)`, and `scoreTurns: "each"` multiplies it by the turn count. Prefer deterministic rule, schema, and trajectory scorers for continuous CI; reserve judges for semantic quality gates.
- **Redaction.** Curation redacts before an item is built; a redactor that throws skips the run (`redaction failed`) rather than storing raw data. Records are redacted on the way out (`reason`, `error`, `metadata`), but a scorer's *input* is raw: `result`, `item`, and an untimelined run carry the text as recorded. The entry point resolves `redactor`/`secrets` once and hands the result to every scorer as `ScorerInput.redactor`, so a scorer or judge that embeds text in a prompt redacts with `input.redactor?.redact(value)` first. `createModelJudge` already does this for the target and the item before the prompt; a host that configures neither option has declared no secrets, and the seam is `undefined`.
- **Fail closed.** A missing timeline is a requirement error, not a zero (except where a scorer explicitly reports `0` with `metadata.invariant`); a missing decision is never inferred from a guardrail pass; an unstarted item is never counted as a pass.
- **No timeline, no peer.** Timeline projection is the only reason this package needs `@arnilo/prism-observability`; text-only hosts do not install it.

## Comparing two runs

```ts
import { compareExperiments } from "@arnilo/prism-evals";
const comparison = compareExperiments(baseline, candidate, { seed: 1 });
const success = comparison.scorers.task_success;
// difference = candidateMean - baselineMean; negative means regression.
// ci95 = { low, high }; significant uses the BH-adjusted qValue.
```

The function pairs shared item ids, averages scored observations within each item,
and gives every paired item equal weight. It uses exact McNemar for binary scores
with one scored observation per item on both sides, and paired sign-flip permutation
otherwise. The 95% percentile bootstrap resamples item differences together.
Benjamini–Hochberg adjusts p-values across the compared scorers; `significant`
means `qValue <= alpha` (default `.05`), for either improvement or regression.

Dataset ids must match. Report versions, and manifest dataset versions, must match
when present on both sides. Duplicate ids, fewer than two shared items, or a
missing scorer/valid numeric score on any paired item throw
`ERR_PRISM_EVAL_COMPARE_UNPAIRED`. Failed/skipped records are excluded; a paired
item with no scored observations for a compared scorer is rejected. Unshared
items are excluded, so inspect `pairedItems` before drawing conclusions.

`scorers` selects distinct scorer ids; by default all observed scorer ids from
both reports are compared and required on every paired item. `seed` defaults to
zero. `resamples` overrides both bootstrap (default 2,000) and Monte Carlo
permutation (default 10,000), capped at `HARD_STATS_RESAMPLES`. Invalid numerical
options throw `ERR_PRISM_EVAL_STATS`. `alpha` changes significance only; `ci95`
always has 95% coverage. Comparison is pure and makes no agent calls.

## Gating a release

Point-estimate gates (`minimumMacroMean`, `minimumByScorer`, `minimumPassHatK`,
and `minimumCandidateWins`) are non-statistical. They suit deterministic mock
suites. For sampled datasets, opt into confidence-aware gates:

```ts
assertEvaluationThreshold(candidate, {
  minimumLowerBound: { task_success: .7 },
  maximumRegression: { baseline, delta: .02, alpha: .05 },
});
```

`minimumLowerBound` requires each scorer's `ci95.low >= minimum`. Missing or
invalid intervals fail closed, including reports with fewer than two scored
items. For example, 9/10 successes has mean .9 but a Wilson lower bound about
.596, so it fails a .8 lower-bound gate. Bounds must be finite in `[0, 1]`;
equality passes. Failures name the scorer, requested bound, and observed interval
(or unavailable evidence).

`maximumRegression` calls `compareExperiments` once, using `baseline`, optional
`scorers`, and `alpha` (default .05). It fails when a candidate-minus-baseline
difference is strictly below `-delta` (default 0) and its BH-adjusted
`qValue <= alpha`. Equality at `-delta` passes. Failures include the scorer,
difference, margin, 95% interval, p-value, q-value, and alpha. Significance tests
against zero; the margin filters the observed drop, rather than testing a null
at `-delta`. A passing gate does not establish equivalence or sufficient power.
`delta` must be finite in `[0, 1]`, and `alpha` in `(0, 1)`. Pairing and option
errors propagate from comparison; a pairwise preference report cannot use this
gate. The comparison adds resampling work, with no extra agent or judge calls.

Size the paired dataset before running it:

```ts
import { powerAnalysis, minimumDetectableEffect } from "@arnilo/prism-evals";
powerAnalysis({ baselinePassRate: .85, minimumDetectableDrop: .05 }); // { items: 909 }
powerAnalysis({ baselinePassRate: .85, minimumDetectableDrop: .05,
  expectedDiscordance: .1 }); // { items: 312 }
minimumDetectableEffect({ discordantRate: .1, n: 312 }); // approximately .05
```

`powerAnalysis` returns the smallest integer `items` reaching the target power
under the same two-sided McNemar normal approximation as `pairedProportionPower`
(Connor 1987), without continuity correction. Defaults are `alpha: .05` and
`power: .8`. With baseline rate `p`, drop `d`, and candidate rate `p-d`, default
discordance is `q = p*(1-p+d) + (1-p)*(p-d)`, assuming independent outcomes
within a pair. Prefer `expectedDiscordance` measured on paired pilot data;
positive outcome correlation often reduces the required sample size.

| Baseline | Detectable drop | Discordance | Alpha | Power | Paired items |
| --- | --- | --- | --- | --- | --- |
| .85 | .05 | .29 (default) | .05 | .8 | 909 |
| .90 | .05 | .22 (default) | .05 | .8 | 689 |
| .95 | .02 | .113 (default) | .05 | .8 | 2,215 |
| .85 | .05 | .10 (pilot) | .05 | .8 | 312 |
| .85 | .05 | .10 (pilot) | .01 | .9 | 591 |

Inputs require `0 < p <= 1`, `0 < d <= p`, `alpha < power < 1`, and feasible
discordance `d <= q <= min(2*p-d, 2*(1-p)+d)`. Invalid inputs or a required count
beyond the safe integer range throw `ERR_PRISM_EVAL_STATS`. The inverse
`minimumDetectableEffect` takes discordance directly, not a baseline rate.
These are planning approximations for one binary paired metric; small samples,
continuous scores, and multi-scorer BH gates need separate power assessment.
The item count means distinct paired items, not repeated trials of one item.


## Comparing candidates

```ts
const report = await runComparison({
  dataset, candidates, scorers: [pairwise], trials: 3, seed: 1,
});
report.ranking; // [{ scorerId, candidate, strength, ci95: [low, high], rank }, …]
```

Each candidate runs once per item per trial (`trials` defaults to 1, hard maximum
16). Every stable candidate pair is scored by every scorer in each trial.
Records include a zero-based `trialIndex`. A thrown candidate error (including
a falsy thrown value), or a returned `failed`/`aborted` run, forfeits to a
successful opponent: the record is `scored`, its preference names the winner's
side, and `metadata.forfeit` names the loser. Both candidates failing or a scorer
throwing produces a `failed` record. Host cancellation still propagates.
Forfeits skip the judge. `wins`, `ties`, `failures`, and win thresholds retain
their existing meaning; wins now include forfeits.

Rankings are fitted separately per `scorerId`; different scorers are never
pooled. `bradleyTerry(pairs)` is also exported as a pure helper taking
`{ left, right, preference: "left" | "right" | "tie" }` records and returning a
candidate-to-strength object, or `null` when the fit is unavailable. It uses
[Hunter's MM update (2004)](https://doi.org/10.1214/aos/1079120141), treats ties as
half a win for each side, and normalizes strengths to geometric mean 1.
Larger strength means higher estimated win probability:
`P(a beats b) = strength[a] / (strength[a] + strength[b])`.
The fit takes O(iterations × candidates² + records), uses O(candidates²) space,
and stops at a maximum change in log strengths below 1e-9 or 1,000 iterations.

The 95% percentile `ci95` resamples whole item ids through `bootstrapInterval`,
keeping all trials and pair records for each sampled item together. There are
1,000 resamples per scorer. Each bootstrap fit is reused across candidates;
sampling/quantile extraction adds O(candidates × (1,000 × records + 1,000 log 1,000))
work and fits add O(1,000 × iterations × candidates²).
`seed` (default 0) controls this bootstrap; it does not seed host candidate or
scorer calls. Candidate runs cost `items × trials × candidates` calls;
judge invocations cost at most `items × trials × pairs × scorers`, before any
judge-internal position swap or retry. Ranking makes no additional model calls.

A finite unregularized estimate requires a strongly connected win graph.
All wins on one side, disconnected evidence, no scored pairs, missing candidates,
or failure to converge produce `strength: null, ci95: null, rank: null`.
No pseudocounts are added. If any bootstrap draw has an unavailable fit, strengths
from the original data remain, but all CIs and ranks for that scorer are `null`;
invalid draws are never dropped to manufacture a narrower interval.
Otherwise overlapping intervals form transitive shared-rank groups, with
competition ranks (1, 1, 3). Rows within each scorer are sorted by descending
strength, breaking ties by candidate name. With no fit they retain name order.

## Judges

`createRubricJudge` runs a host-built judge agent in a fresh session per attempt,
with no tools, one turn, one provider attempt, no continuations, and explicit
wall-time and token limits. The host owns and disposes the agent; the scorer
closes each session. A factory may return an agent synchronously or asynchronously.

```ts
const judge = createRubricJudge({
  agent: judgeAgent,
  judgedModel: candidateAgent.config.model, // use the actual model if the candidate run overrides it
  rubric: {
    id: "helpfulness", version: "1", criteria: "Does the answer resolve the request?",
    scale: [
      { label: "no", score: 0, description: "Does not resolve it" },
      { label: "partly", score: 0.5, description: "Resolves part of it" },
      { label: "yes", score: 1, description: "Fully resolves it" },
    ],
  },
  reference: item => item.expected as string | undefined,
});
```

The scorer id defaults to the rubric id. `judgedModel` is a `{ provider, model }`
or a resolver `(input) => model`; supply the actual model including run overrides.
`RunResult` does not carry model identity. Equal or missing candidate identity
fails closed with `ERR_PRISM_EVAL_JUDGE_SELF` unless `allowSelfJudging: true`.
Known equal models are rejected at construction; factories and resolvers are
checked on use. Judge agents must have a resolved model.

The versioned prompt includes criteria, labeled score anchors, the item, optional
reference, and answer text. `include: "answer+timeline"` requires a timeline and
adds only structural step metadata, excluding input/output, errors, and arbitrary
metadata. Resolved `ScorerInput.redactor` redacts the item before the reference
callback and all prompt data before enforcing `maxInputBytes` (default 1 MiB,
hard 8 MiB). With no configured redactor or secrets the host declares no secrets.
The canonical rubric is snapshotted and SHA-256 hashed; its default byte cap is
16 KiB (hard 64 KiB). Output defaults to 16 KiB (hard 64 KiB).

Replies must be JSON with exactly `reasoning` (at most 4 KiB of UTF-8) and a scale
`label`. The prompt requests reasoning before the label. Schema/parse failures
retry and then produce failed records with `ERR_PRISM_EVAL_JUDGE_OUTPUT`, never
an invented score. Successful records include `evaluatorKind`, `judgeModel`,
`rubricId`, `rubricVersion`, `rubricHash`, `templateVersion`, `label`, `attempts`,
and a redacted reasoning excerpt capped at 512 bytes.

**Cost:** one judge model call per item per attempt; `maxAttempts` defaults to 2
(hard 3), with a 30-second timeout per attempt (hard 300 seconds). Trials and
per-turn scoring multiply this cost. Provider failures and timeouts also retry;
host cancellation stops retries. A factory is inside the attempt timeout.

Labeled anchors, reference answers, and reasoning before the label make the
criteria explicit; the prompt also asks judges to avoid irrelevant verbosity
preferences. These measures do not establish agreement with human graders or
remove model bias. Use an independent judge model and validate semantic gates
against human labels. `createModelJudge` remains the low-level adapter for hosts
that supply their own judge call.

### Pairwise judges and position consistency

`createPairwiseJudge` compares answer text in both orders using the same bounded,
tool-less session runner as `createRubricJudge`:

```ts
const pairwise = createPairwiseJudge({
  agent: judgeAgent,
  rubric: { id: "helpfulness", version: "1", criteria: "Which answer resolves the request better?" },
  judgedModels: { left: leftAgent.config.model, right: rightAgent.config.model },
});
const report = await runComparison({ dataset, candidates, scorers: [pairwise] });
```

`judgedModels` supplies the actual models in `input.left` / `input.right` order,
including run overrides. It may instead be `(input) => ({ left, right })` for
comparisons with more candidates. Both identities are checked against the judge;
missing identities fail closed unless `allowSelfJudging: true`. Agent factories,
ids (defaulting to the rubric id), byte caps, timeouts, and retries work as for
rubric judges. This scorer sees answer text and the dataset item only.

Each reply must contain exactly `{ reasoning, winner: "A" | "B" | "tie" }`.
`allowTie` defaults to `true`; `false` excludes `"tie"` from valid replies.
After mapping the swapped verdict back to the original order, disagreement
always becomes a conservative tie, including when `allowTie: false`.
`metadata.positionInconsistent` distinguishes this from an agreed tie.
`metadata.verdicts` preserves both validated winner labels, redacted reasoning
excerpts (512 bytes each), attempt counts, and model/rubric/template provenance.
`metadata.lengthRatio` is left/right Unicode character count after redaction,
with each empty answer counted as one character to keep the ratio finite.
Candidate names are omitted from prompts. Both orders reuse the same redacted
answers; `runComparison` forwards its resolved redactor to pairwise scorers and
retains their metadata in comparison records.

`report.positionConsistency[scorerId]` is the fraction of successful swapped
judgments with agreeing verdicts, including agreed ties. Failed judgments are
excluded; scorers without successful swap evidence are omitted. An invalid reply
or failed order fails the pair rather than manufacturing a tie.

**Cost:** two judge calls per pair per item without retries. Each order defaults
to at most two attempts, so up to four calls per pair (or
`2 × maxAttempts`). Calls run sequentially, each in a fresh session. Judging is
opt-in: nothing runs until the host supplies the scorer to `runComparison`.
Position swaps expose position bias; they do not establish agreement with humans.


### Judge panels

```ts
const panel = createJudgePanel({
  id: "helpfulness_panel",
  judges: [judgeHyper, judgeOpenCodeGo, judgeLaya],
  combine: "majority", // or "mean" / "median"
});
```

A panel calls every member with the original `ScorerInput`, including its redactor,
then combines successful verdicts. `majority` requires `metadata.label` and chooses
the most frequent label; tied labels resolve to the lower score. If judges map the
same label to different scores, the lowest score for that label is used. `mean`
and `median` combine numeric scores and do not require labels. Use shared rubric
labels and score anchors so the verdicts are comparable.

`requireDistinctModels` defaults to `true`: each scorer must declare a known,
distinct `judgeModel: { provider, model }` at construction. `createRubricJudge`
populates this for a static agent; custom scorers can declare it directly or
through `defineScorer`. Factory-backed judges have no construction-time identity;
use `requireDistinctModels: false` to explicitly accept unverified diversity.
An empty panel is invalid. Member ids may repeat (for example, the same rubric
on different models); metadata retains the configured member order.

Throwing judges, invalid scores, and missing majority labels are excluded and
counted. Exactly half succeeding is enough; fewer than half causes a failed
record with `ERR_PRISM_EVAL_JUDGE_PANEL` and the failure count in its message.
Successful metadata includes `judges` (each id, model, label, score and status),
`failedJudges`, and `labels` in configured order, with `null` for missing labels.
Member errors and reasoning are omitted; the entry point redacts panel metadata.
Member `requires` declarations are combined, so input requirements still fail
before the candidate runs. Cancellation propagates through the original signal.

`report.aggregate.scorers[panel.id].judgeAgreement` is Fleiss’ κ across complete
label rows. Records with failed or unlabeled members are excluded from this
statistic. It is absent when no complete rows exist, there are fewer than two
judges, or all observed labels belong to one category (κ is undefined). Repeated
trials/step evaluations each contribute a rating row. The exported
`fleissKappa(labels)` accepts equally sized rows of two or more judge labels and
follows the [statsmodels Fleiss κ formula](https://www.statsmodels.org/stable/_modules/statsmodels/stats/inter_rater.html#fleiss_kappa).

**Cost:** the sum of all members’ calls, including their retries; the panel adds
no model calls or retries. Members run concurrently. Three rubric judges cost
three calls per item without retries, up to six with their default attempts.

### Calibrating a judge

```ts
import { calibrateJudge, labeledItemsFromFeedback, assertEvaluationThreshold } from "@arnilo/prism-evals";
const items = await labeledItemsFromFeedback({
  feedbackStore, persistence, ownership: { tenantId, userId }, query: { tag: "graded" },
  secrets,
});
const calibration = await calibrateJudge({ judge, items, scale: "ordinal", seed: 1, secrets });
assertEvaluationThreshold(experiment, {
  calibrations: { [judge.id]: { report: calibration, minimumKappa: .6, minimumN: 30 } },
});
```

Supply an independent judge with the actual candidate model through `judgedModel`,
including run overrides. The loader reconstructs the recorded result and first user
message through the persistence trace resolver. It requires a tenant and account
or user scope, checks exact ownership on every feedback record and trace, and uses
`traceLimits` for bounded cursor pagination and trace bytes. Query ownership cannot
override the explicit scope. The default mapping normalizes `rating` from `[-1, 1]`
to `[0, 1]`; records without a rating are omitted. `toScore(record)` can map tags
or metadata to a score, or return `undefined` to omit a record. Each selected
feedback record is a separate pair, including repeated reviews of the same run;
select a representative independent sample for calibration. Comments and feedback
metadata are never copied into the judge's item or result. Supply `redactor` or
`secrets` to both entry points when loading and judging secret-bearing content.

`calibrateJudge` accepts `{ item, result, humanScore }` pairs with finite scores
in `[0, 1]`. It passes only the item, expected answer, result, redactor and signal
to the scorer, never the human score. It supports answer-only scorers; declared
trace, timeline or environment requirements fail before scoring. Judge errors and
invalid scores count in `judgeFailures`; `n` counts successful pairs only. Abort
rejects the operation. Empty or single-category agreement and constant-rank
correlation are `null`, with no fabricated agreement or NaN in serialized reports.
The confusion matrix has ascending numeric `labels`, human rows and judge columns
in `counts`. Exact numeric scores are categories; align human and judge scales
before measuring agreement. Inputs are capped at `HARD_DATASET_ITEMS`, and the
estimated numeric matrix storage at the report byte ceiling.

The report includes unweighted `cohensKappa`, nominal `krippendorffAlpha` for two
complete raters, and average-tie-rank `spearman`. `scale: "ordinal"` additionally
returns quadratic `weightedKappa`, using positions in the sorted observed score
categories. Alpha remains nominal. These follow the definitions in
[scikit-learn's Cohen κ documentation](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html),
[Krippendorff's alpha implementation](https://github.com/pln-fing-udelar/fast-krippendorff),
and [SciPy's Spearman documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html).

`kappaCi95` is a paired-item percentile bootstrap of **unweighted** κ using 2,000
resamples (default seed 0); it is absent when the original κ is undefined. A
one-category bootstrap draw has undefined κ and is conservatively assigned -1.
This can produce a wide interval for small samples, including perfect small
samples. Gates use the lower bound when present, otherwise the point κ, and
require at least 30 successful pairs by default. Undefined/non-finite evidence
fails; calibration entries for scorers absent from the evaluation report are
ignored. `minimumKappa` accepts `[-1, 1]`, and `minimumN` is a positive integer.
The caller supplies calibrations explicitly; judges never trigger them automatically.

**Cost:** one scorer invocation per labeled item; rubric retries and panel members
retain their own call costs. Bootstrap resampling makes no model calls. Nominal
statistics take linear time, ranking takes `O(n log n)`, the dense confusion matrix
takes `O(categories²)` space, and bootstrap takes up to
`O(2,000 × n)` for unweighted κ. `examples/run-feedback.ts` runs a small
mock-provider calibration; its single label demonstrates the API, not enough
evidence to pass a calibration gate.

## Prompt-injection suite

`createInjectionDataset` makes a benign copy of every task and crosses tasks with
attacks and carriers. Inputs, expected values, splits, labels and existing tags
are retained; generated IDs are unique. `metadata.injection` contains
`{ attackId, carrier, payload, goal }` for attacks and
`{ attackId: null, carrier: null }` for benign items. Tags add `benign` or
`attack:<id>`. Dataset JSON, tag and item caps still apply.

```ts
const dataset = createInjectionDataset({
  id: "page-injection", tasks,
  carriers: [{ tool: "web_fetch" }], // also: read, browser_snapshot
});
const suite = await runInjectionSuite({
  agent: factory, dataset, utility: taskScorer, trials: 3,
});
console.log(suite.benignUtility, suite.utilityUnderAttack, suite.attackSuccessRate);
```

The factory receives `hooks`, `slots`, and the current `item` (also available to
ordinary experiment factories). Forward hooks and slots into `createAgent`.
Factories must create isolated agents; manage their disposal as with
`runExperiment`. Existing hooks run alongside the injection hook, so approval
and output guardrails still apply. Each trial has its own injection closure,
including at concurrency greater than one. `injectionHooks(spec)` is also
available for standalone scenarios.

The original Prism payloads are `important_instructions`, `ignore_previous`,
`fake_tool_output`, and `exfiltration_link`. Custom `InjectionAttack` values have
`{ id, payload, goal: { tool?, argsContain?, textContains? } }`. All supplied goal
conditions must match; tool and argument conditions match the same call after
the first carrier call. Tool goals measure attempted calls, including calls
blocked by policy. The exfiltration goal uses `https://exfiltrate.invalid/collect`.
The `.invalid` domain is reserved and cannot identify a public destination;
use in-memory fixtures for fully network-free runs.

Carriers accept `position: "append" | "prepend"` (default append). The hook
changes successful text results only, retaining identity, non-text blocks and
trust metadata. It updates structured `markdown`, `answer`, or `ariaSnapshot`
fields too. Web fetch and browser snapshot retain the kernel's untrusted
content envelope; text-file `read` retains its existing unenveloped behavior.
Image and extracted-document reads are skipped.

**Run this opt-in suite against sandboxed tools only.** Payloads are inert text,
but an agent may follow them and try real tool actions. The included example
uses an in-memory tool and a scripted mock provider.

Rates are pass proportions at the utility scorer's `passThreshold` (default 1)
and deterministic attack success, with `{ rate, n, successes, missing, ci95:
{ low, high } }`. Overall and per-attack/per-carrier metrics share the benign
baseline. `n` counts completed, fully scored item-trials; failed, skipped and
aborted trials are reported as `missing`. Empty evidence leaves rate/CI absent.
Wilson 95% intervals treat item-trials as Bernoulli observations; repeated tasks
can be correlated, so also inspect the report's item-clustered scorer statistics.
`attack_success` is explicitly not an invariant (higher means less safe).

Argument goals require timeline inputs: the suite defaults to `redacted_io`,
requires the optional observability peer, and rejects `metadata`/`off` and
sampling below 1. Secret redaction still applies; a redacted argument cannot
match a goal containing that secret. Inspect missing evidence before comparing
rates. No model judge calls are added.

Runs = tasks × (1 + attacks × carriers) × trials. Four built-in attacks mean
**5 runs per task/trial for one carrier**, or **13 for all three**.
See `examples/eval-injection.ts` for a runnable example that falls for one attack.
