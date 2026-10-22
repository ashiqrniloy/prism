# Memory benchmark (0.13.0)

This opt-in runner measures Prism on pinned public datasets. It never runs as a
live test during `bun run test`; the offline smoke needs only Bun.

```sh
timeout 60 bun scripts/memory-bench/run.mjs --offline
timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs

# Live benchmark tooling, isolated from all Prism packages:
timeout 60 python3 -m venv /tmp/memory-bench-python
timeout 180 /tmp/memory-bench-python/bin/pip install -r scripts/memory-bench/requirements.txt
export PRISM_MEMORY_BENCH_PYTHON=/tmp/memory-bench-python/bin/python

timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config full \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5
timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config om \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5

timeout 30 bun scripts/memory-bench/report.mjs --compare a.json b.json
```

The suites are `longmemeval-s`, `locomo`, and `memoryagentbench-cr`; configurations
are `full`, `om`, `fabric`, `fabric-hybrid`, `fabric-agentic`, and `om+fabric`.
`fabric-hybrid` requires an embeddings model via `--embeddings <provider/model>`.
Supported live transports are the existing Hyper and OpenCode Go providers.
The judge can use a different provider or model. Credentials use the existing
live matrix dotenv parser and default to `~/.config/prism/live.env`;
`PRISM_LIVE_ENV_FILE` overrides it. Existing environment values win. Keys and
dataset/answer/memory text are never written to reports.

The benchmark-only Python requirements are PyArrow 23.0.1 for the pinned Parquet
artifact and NLTK 3.9.2 for LoCoMo's Porter-stemmed F1. No corpus downloads are
needed. No kernel or memory package depends on either library.

## Pinned data and draw

`datasets.mjs` records immutable revisions, byte sizes, SHA-256 hashes, license
names and source URLs. Files download into
`${PRISM_CACHE_DIR:-~/.cache/prism}/memory-bench/`. Both downloaded and cached bytes
are verified before parsing; a mismatch raises `MemoryBenchDatasetError` and
requires explicitly removing the corrupt file. Each cache file has a license
notice sidecar. Dataset contents are never vendored.

- LongMemEval-S cleaned: MIT, 500 questions. Base: ten ordinary questions of each
  of its six types, excluding `_abs` ids, plus ten abstentions: **70 questions**.
  `--subset targeted --ability knowledge-update` draws thirty of that type,
  including its ten base ids. All six targeted sets are recorded in `subsets.json`.
- LoCoMo: **CC BY-NC 4.0**, noncommercial use only. All **386 QA** from the seeded
  conversations `conv-47` and `conv-49`, with all five QA categories. Its
  `adversarial_answer` is a distractor, not the gold answer.
- MemoryAgentBench Conflict_Resolution: MIT, eight context rows. Forty fixed
  `(row, question-index)` pairs, twenty from each single-/multi-hop stratum.
  Decoded source names are `factconsolidation_sh_*` and `factconsolidation_mh_*`;
  rows retain their different context sizes. Each ordered fact line is an
  incremental ingestion unit. Dates are explicitly synthetic, starting at
  2000-01-01 UTC and advancing a minute per line.

`subsets.json` records the seed and ids. Ranking is ascending SHA-256 of seed,
colon, and id. MAB ids for the draw use the Python tuple spelling `(row, index)`.
`--subset all` bypasses the release draw. It can cost substantially more.
`--max-questions N` is an explicitly partial diagnostic, never a full baseline.

## Replay, accounting, and limits

Source messages are linked session entries with stable source-derived ids, original role, source id,
and source-session timestamp. The final provider view prefixes retained source messages with their dates; worker input uses the shipped OM serializer. LongMemEval dates and LoCoMo dates without timezone
are interpreted as UTC. OM receives source messages incrementally in approximately
10k-token checkpoints and runs its shipped workers and compaction policy. An empty-input
run triggers the package's normal background hook; it makes no main model call
and appends no synthetic user instruction. The runner waits for each
worker before ingesting the next chunk. It never supplies gold answers during
replay. Each question has a fresh agent/session and memory state.

`full` retains the whole haystack, trimming oldest complete dialogue turns when
the estimated model input cap is exceeded, and records `truncated: true`. The cap
comes from the existing provider catalog and `resolveInputCap`; prompt and tool
headroom is reserved. Character-based estimates govern trimming only. Request and
response byte caps remain Prism's defaults. The benchmark owns a separate total
wire token ceiling, so the ordinary 40k-input/50k-total per-run policy caps are
disabled for this opt-in harness. Provider calls and multi-call background worker passes have ten-minute deadlines; the input-token ceiling remains the cost bound. The benchmark transport uses Prism’s existing transient-error retry policy with three attempts for all model calls, including workers. It also retries the observed empty SSE gateway error (`HTTP 400`, `event: error` / `data: {}`); ordinary validation errors are never retried. `calls.gatewayRetries` and wire exchanges include this overhead; memory-package logic stays unchanged.

A stream that ends without completion evidence is re-asked at most twice with
2s/10s backoff. Each re-ask forks the same pre-answer branch (or starts a fresh
session when the arm has no session history), so it never sees partial output;
a completed wrong answer is never retried. Arms with coding tools or any
mutating memory tool are not replayed at all. Judge verdicts get up to two
re-asks (1s/2s), each in a fresh one-shot session; malformed/truncated output is
retryable, while auth, permanent-request, usage/budget and run-limit failures
keep their original code and are never retried. `calls.judge` counts logical
judge requests and `calls.judgeAttempts` counts provider attempts. The report
protocol records retry limits and `maxTurns`; changing either is a new arm, not
a comparable old one.

**Default cost ceiling: 15,000,000 input tokens per suite × configuration**,
including memory workers and both answer and injection judging. Usage is read
from plan 182's loopback wire proxy, including cache-read tokens; raw exchanges
are never recorded. Billing fields are not inferred from character counts.
Live replay uses four independent question sessions at a time (offline uses one). Up to four requests already in flight can cross the ceiling; no following request starts,
and the runner writes a partial report with `status: token-ceiling`. Reports also
include output tokens and model/judge ids. A setup error or missing wire usage
fails the run, never becomes zero billing usage.

The manual `release/memory-bench` row always runs `full`, then `om`, `fabric`, and
`om+fabric`. Its maximum is 60M input tokens across four configs. To trigger it, manually dispatch `.github/workflows/live-matrix.yml`
with filter `release/memory-bench` and a selected `memory_suite`; scheduling cannot
start this job. Local equivalent:

```sh
PRISM_LIVE_MEMORY_BENCH_MANUAL=1 timeout 21000 bun scripts/memory-bench/live.mjs
```

### Fabric configurations (`fabric`, `fabric-hybrid`, `fabric-agentic`)

The `fabric*` configurations isolate retrieval by ingesting the haystack directly into a fresh per-question markdown store (in an OS scratch directory cleaned up after the question finishes), one `episode` note per dialogue round with the source date, session id, and round id. This matches LongMemEval's round-value evaluation design and avoids coupling retrieval evaluation to OM worker promotion:
- **`fabric`**: Lexical (BM25) retrieval over the markdown store. Answers with passive injection on (`inject: { query: "task" }`) and filters out `memory.*` tools from model requests. Ingestion makes zero model calls.
- **`fabric-hybrid`**: Hybrid (BM25 + vector reciprocal rank fusion) retrieval over the markdown store. Requires an embeddings model via `--embeddings <provider/model>` (fails at startup if missing). Ingestion batches embedding calls at 64 items per page; answering uses passive injection with no memory tools.
- **`fabric-agentic`**: Agentic retrieval with passive injection disabled (`inject: false`) and `memory.*` tools enabled, letting the agent search and recall memories dynamically within turn and token budgets.
- **`om+fabric`**: Runs OM background workers over the dated session history **and** ingests the same causal corpus into the disposable fabric store. Both channels see the same pre-question records; passive injection stays on.

## Metrics and comparability

LongMemEval judge templates are copied verbatim into `judge-prompts.json` from
[commit 9e0b455](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py)
under the accompanying MIT license. LoCoMo reports the same judge plus its
[upstream QA F1](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/task_eval/evaluation.py):
Porter stemming, comma-separated sub-answer scoring for multi-hop, first-answer
selection for open-domain, and the upstream phrase-based adversarial metric. The LoCoMo agent is instructed to use the accepted “no information available” phrase when abstaining.
MAB uses normalized substring exact match against any alternative gold answer,
[upstream protocol](https://github.com/HUST-AI-HYZ/MemoryAgentBench/blob/538026089d1a8a8eff05121d0db89b388f360eba/utils/eval_other_utils.py).

Reports keep question ids, per-question scores, per-ability accuracy, token usage,
worker counts, truncation, and injection ids/labels. They exclude original text,
model answers and judge responses. The bench-only package captures memory from
`model.request`. In addition to QA accuracy, reports record retrieval diagnostics:
- **`toolCallsPerQuestion`**: Mean tool invocations per question (informative for `fabric-agentic`).
- **`recallCalls`**: Total memory recall operations across passive injection passes and agentic tool calls.
- **`retrievedSnippetTokens`**: Labeled character-derived token estimates (`ceil(chars/4)`) of memory snippets injected or returned by memory tools.
- **`retrievalRecallAtK`**: Fraction of questions with ground-truth evidence where at least one evidence round ID was present in recalled memory item IDs.

### Final paid acceptance (188.7)

The frozen acceptance manifest is `docs/_evidence/memory-bench/188.7/acceptance-manifest.json`;
it is dry-run only and records the owner-approved 106M input-token cap, the 140-question
confirmatory split (20 per ability, seed 1887, disjoint from the 70-question development set),
12 independent lifecycle personas and every required arm.

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance --manifest
timeout 43200 bun scripts/memory-bench/campaign.mjs --acceptance
timeout 300 bun scripts/memory-bench/acceptance-report.mjs
```

The 2026-10-22 run stopped **incomplete** at 80,067,335 charged tokens: 6 of 56 required jobs
completed, and the missing `om`, `om+fabric`, `fabric-agentic`, full LoCoMo and 12-persona
lifecycle safety arms prevent an acceptance or default-enablement claim. See
`docs/_evidence/memory-bench/188.7/README.md`.

Every attempt reserves its cap plus one-question overshoot in
`docs/_evidence/memory-bench/188.7/spend-journal.json` before the child starts. A crashed or
killed attempt keeps its reservation until its own report reconciles it; prior phase spend is kept
as `priorReservation` rather than refunded by renaming. The acceptance runner allows one extra
whole-arm attempt for acceptance because a harness-only ingestion fix can invalidate an unfinished
arm; that exception is journaled and budgeted, not an open retry loop. No pre-fix fabric arm is
claimed: the fix history is uncommitted, so the outcome matrix marks that question unresolved.

Retrieval failures can be attributed without publishing text:

```sh
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs \
  --failed-report docs/_evidence/memory-bench/task6/v2-rerun-longmemeval-s-fabric.json \
  --output docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json
```

The report replays the lexical fabric through the real package and records ids, ranks, counts and
one stage per failed question: `candidate_gap` (no labelled answer-session round in the candidate
pool), `selection_gap` (candidate exists but the passive budget/topK shows none), `fine_selection_gap`
(the answer session is shown but its labelled message round is not) or `answer_gap` (the labelled
round is visible and the answer is still wrong). Gold stays offline; queries and reports never carry
source text. The generated [retrieval diagnostics](../../docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json)
show 21 `answer_gap`, 13 `fine_selection_gap` and 13 `selection_gap` of 47 failed fabric questions;
the old 70-question arm stays diagnostic/development evidence.

Token allocations use `ceil(characters/4)`; they are labeled estimates and separate from billing.
`used`/`irrelevant` labels are judge decisions, not causal evidence. Cited-id rates require the later citation
instructions and metadata; absence is not proof the model ignored a memory.

## Statistics

```sh
timeout 30 bun scripts/memory-bench/report.mjs --compare baseline.json candidate.json
# One ablation family: every candidate versus baseline, across all abilities.
timeout 30 bun scripts/memory-bench/report.mjs --compare baseline.json candidate-a.json candidate-b.json
timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs scripts/memory-bench/stats.test.mjs
```

The comparison refuses missing, duplicate, differently categorized, unscored or
unpaired question ids, mismatched judges, inconsistent cluster keys, a different
`metricVersion`, and reports from different frozen `protocolHash`/dataset. Each
ability reports the registered metric definition, unit, direction, both raw
means, `diff` (B minus A raw value), `improvementDelta` (direction-adjusted, so
positive always means better), `ci95`, raw `p`, `pHolm`, discordant counts,
cluster unit/count, method and paired-design power. A group is `confirmatory` only
for metric version 2, two completed usage-complete arms, a registered metric and
at least 8 independent clusters; historical or partial reports are descriptive.
Multiple candidates produce an array in CLI argument order; one candidate keeps
the existing object shape. Holm correction covers every candidate × ability
comparison in the supplied family. Declare families before inspecting results;
separate CLI calls constitute separate families. The 95% CIs are pointwise,
without multiplicity adjustment.

`stats.mjs` exports dependency-free pure functions:

- `clusterBootstrap(items, { cluster, metric, iterations, seed })` resamples whole
  clusters with replacement and returns `{ estimate, ci95 }`. `metric(row)` is a
  finite numeric per-item value (default: boolean `correct` converted to 0/1).
  The estimate is the item-weighted mean, including unequal cluster sizes;
  the percentile CI uses linearly interpolated 2.5% and 97.5% quantiles.
- `pairedClusterPermutation(a, b, { cluster, iterations, seed })` pairs raw
  metric values by unique `id`, requiring matching cluster keys, and returns
  `{ diff, ci95, p }`. It flips the sign of every paired difference in a cluster
  together. Up to 16 nonzero clusters use all sign assignments; larger samples
  use Monte Carlo with `(extreme + 1) / (iterations + 1)`. The CI bootstraps paired
  differences by whole cluster. Positive differences favour B on the raw scale;
  use `improvementDelta` when the metric is lower-is-better.
- `holm(pValues)` returns step-down Holm–Bonferroni adjusted p-values in input
  order, with monotone cumulative maxima and a cap of 1.
- `powerForDiff({ baseline, diff, clusters, icc, clusterSize = 1 })` estimates
  two-sided alpha=0.05 normal-approximation power for independent equal-size arms.
  With alternative `q = baseline + diff`, variance is
  `[baseline*(1-baseline) + q*(1-q)] / effectiveN`, where
  `effectiveN = clusters*clusterSize / [1 + (clusterSize-1)*icc]`.
  `clusters` is a positive integer per arm, ICC lies in [0,1], and cluster size
  is the mean items per cluster (default one, where ICC has no effect).
  It is historical only: do not use it to justify a paired claim.
- `pairedPowerSimulation({ baseline, diff, clusters, clusterSize, icc, simulations, seed })`
  simulates paired cluster differences and re-runs the same exact sign-flip test
  that `compare` uses, so the reported power matches the analysis design.
  `powerAssumptions.method` is `paired-cluster-signflip-simulation` and
  `independentArms` is false. With very few clusters the exact test cannot reach
  alpha, and the simulation reports power 0 rather than an optimistic number.
- `compare(a, b, { iterations, seed, icc = 1, simulations = 200 })` preserves exact two-sided
  McNemar only for unclustered Boolean results. If any row has `cluster`, every row
  must have a matching valid key and inference uses cluster sign-flips. Reported
  power is simulated under the same paired design. Observed power does not
  establish that an ablation was adequately powered.
- `compareFamily(baseline, candidates, options)` in `report.mjs` applies Holm
  jointly over the entire supplied family.

Resampling defaults to 10,000 iterations and integer seed 7, using a local PRNG
without global random state. The same ordered data/options produce byte-identical
comparison JSON. Cluster defaults to `row.cluster`; callbacks can instead select
persona/project pairs, for example:

```js
pairedClusterPermutation(armA, armB, {
  cluster: row => `${row.persona}/${row.project}`,
  iterations: 10000,
  seed: 7,
});
```

Clusters must be independent. The lifecycle suite uses the **persona** as its
cluster because its three project stores share one user/agent store; project-level
clusters would manufacture replication. Public questions cluster by shared
haystack session set (LongMemEval), conversation (LoCoMo) or source context
(MemoryAgentBench-CR). Few clusters and all-identical outcomes can produce
discrete p-values or degenerate percentile intervals. Small strata have low
power. Different models/judges, truncated context, synthetic dates and the small
fixed subset limit comparison with published scores. Offline accuracy exercises
wiring only.

Methods: [Field & Welsh (2007), cluster bootstrap](https://doi.org/10.1111/j.1467-9868.2007.00593.x)
and [Holm (1979), sequential multiple testing](https://www.ime.usp.br/~abe/lista/pdf4R8xPVzCnX.pdf).

The default test chain includes `run.test.mjs` as an offline gate smoke; it never downloads datasets or calls a live provider.

## Markdown store scale (offline, opt-in)

```sh
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
```

The runner prints JSON lines (machine metadata, then one result per corpus size).
It seeds synthetic OKF files using the production codec in a fresh OS scratch
directory, measures the production markdown store, and removes the directory in
`finally`. No provider, credentials, download, or embeddings are used. The
200-note subprocess smoke is included in `run.test.mjs`; the full scale run is
not part of `bun run test`. See
[`memory-markdown-scale-0.13.0.md`](../../docs/_evidence/memory-markdown-scale-0.13.0.md)
for the workload, numbers, and filesystem caveats.

## Lifecycle replay

Record once, replay promotion and retention policies through the published fabric
`consolidate`, `maintain`, `recall`, and `recordUses` APIs. Nothing changes package
defaults. The component runner does not run an agent or measure delivery tiers;
end-to-end delivery and default calibration belong to the later lifecycle suite.

```bash
timeout 600 bun scripts/memory-bench/lifecycle/synth.mjs --personas 4 --projects 3 --sessions 8 --seed 7 --out .cache/memory-bench/lifecycle/ledgers
timeout 1200 bun scripts/memory-bench/run.mjs --replay .cache/memory-bench/lifecycle/ledgers --policy scripts/memory-bench/lifecycle/policies/gated.json --offline --output .cache/memory-bench/lifecycle/report.json
# The standalone entry point accepts --ledgers instead of --replay.
timeout 1200 bun scripts/memory-bench/lifecycle/replay.mjs --ledgers .cache/memory-bench/lifecycle/ledgers --policy scripts/memory-bench/lifecycle/policies/no-promotion.json --offline
```

Synthetic values are seeded SHA-256-derived opaque tokens, with no outside
knowledge needed. Each content-addressed JSONL contains a versioned manifest and
session entries (including real OM observation, reflection, and task-state
records). The manifest holds persona/project/session ordering, labels by
construction and later probes. Labels name entry ids, content hashes, expected
kind/scope/key, ephemerality and path globs. Lessons start in project scope and
are labelled for eventual agent scope after replication. Project-specific keys
keep unrelated project facts out of the lesson replication group. Supersession
probes use the value known before that session's new learning. A poisoned tool
result and task-local noise are negative labels.

Consented JSONL session-store export:

```bash
timeout 120 bun scripts/memory-bench/lifecycle/record.mjs --session SESSION_ID --store .prism/sessions --consent --persona PERSONA_ID --project PROJECT_ID --identities .local/identities.json
```

`--identities` is a JSON array of identifying strings (names, handles, repository
paths, etc.) the operator wants replaced everywhere. Email addresses, home
directory usernames and identity/reference fields are hashed automatically;
free-form names require that explicit list. Keep it outside version control.
Use the same `--persona` and `--project` across recorded sessions that share a
scope. Without them, top-level tenant/resource ids are used when available,
otherwise the session is isolated. OM ids retain their required 12-hex format,
and references receive the same pseudonyms.

Export refuses without consent, lists entries through the session store, runs
`redactSessionEntry`, hashes identifying strings, then runs the repository secret
scanner on a private staged file before publishing `ledgers/<sha256>.jsonl`.
CLI redaction uses secret values from environment variables ending in KEY,
TOKEN, SECRET or PASSWORD. Programmatic `recordLedger` accepts the host's actual
session `SecretRedactor` and `SessionStore` for other backends. An unknown secret
caught by the scanner aborts export; it is never published as a ledger. Files
are mode 0600, directories 0700. The default `.cache/memory-bench/lifecycle/`
is ignored by Git; custom output locations must also stay uncommitted.
Recorded ledgers initially have no gold labels or probes; see Gold labels and
human audit below. Promotion accuracy metrics are null without gold.

Policies are JSON validated by `resolveMemoryFabricConfig`, for example
`{"promote":{"minScore":0.45},"lifecycle":{"verifyAfterSessions":2}}`.
The replay applies `promote`, `consolidate`, `retrieval` and `lifecycle` settings;
delivery settings are accepted as fabric config but are not component metrics.
Offline hybrid retrieval uses the existing hash embedder, not live embeddings.

The extractor cache defaults to `.cache/memory-bench/lifecycle/extractor`; override
with `--cache`. Keys hash model id, prompt version, system prompt, input and tool
schema. Existing note ids are canonicalized and rebound on read, so random fabric
ids do not defeat cache reuse. A cold replay makes one extractor call per
nonempty consolidation pass; a warm replay makes none. `--offline` selects the
fixture mock extractor, which reads candidate text without access to gold labels.
For real redacted sessions, call `replayLedgers({ledgers, policy, client, cache})`
with a public `ModelClient`; it streams and caches the real extractor output.
For opt-in live extraction, set `promote.model` to `hyper/<model>` or
`opencode-go/<model>` in the policy. This lazily reuses the benchmark's credential,
provider-catalog, retry and wire-proxy plumbing only on a cache miss. Live input
usage is checked before every request/retry and after the replay, with a default
15M-token ceiling (`--max-input-tokens` overrides it); missing usage or an exceeded
ceiling fails the run. One in-flight call can cross the ceiling. Warm live caches
need no credentials or provider discovery. Without a model reference or injected
client, a cold non-offline replay fails closed. No live calls run in tests.
Cache contents are private working
data and must stay ignored alongside ledgers. Different model ids never share
entries; corrupt cache files and modified ledger hashes are rejected.

Session order comes from manifest timestamps. Public scope counters tick project,
agent and user once per worked session; probes run **before** consolidation and
credit uses only when recall returns the needed content. Procedure probes request
all note kinds explicitly. Metrics include:

- Promotion precision/recall, overall and by source: distinct promoted note
  versions versus distinct labelled content targets per persona/storage scope.
  Repeated identical plantings do not inflate recall. Unmatched predictions count
  against overall precision; an empty denominator is null.
- Scope/type accuracy over labelled promoted versions, including the narrow
  project copies of lessons before widening. These are promotion-history
  measurements rather than a final-state-only score.
- Duplicate rate: excess active copies of identical text in one storage scope.
- Archive regret: distinct archived note versions needed by a strictly later
  probe divided by distinct archived versions, even when recall misses them.
- Graveyard index: active notes with no use in the last K scope sessions (default
  3); never-used notes count. Programmatic `graveyardK` changes this window.
- Active-set growth: active notes and estimated tokens (`ceil(chars/4)`) per scope
  ordinal. Archived and superseded notes do not count.

Reports contain hashes, counts and scores, never candidate text or model output.
The mock is a plumbing check, not evidence for choosing production defaults.

```bash
timeout 300 bun test --timeout=0 scripts/memory-bench/lifecycle/lifecycle.test.mjs scripts/memory-bench/run.test.mjs scripts/memory-bench/stats.test.mjs
```

## Gold labels and human audit

Synthetic labels come from planted facts, with no judge calls. Recorded candidates
use the fabric's candidate gatherer and the versioned lifecycle rubrics in
`judge-prompts.json`. Two independent models, one per provider, label every
candidate. Run after the consented, redacted export described above:

```bash
timeout 3600 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/recorded --judges hyper/MODEL_ID,opencode-go/MODEL_ID --out .cache/labels --seed 7 --max-input-tokens 15000000 --evidence docs/_evidence/memory-lifecycle-0.13.0.md
```

The panel reuses `judge.mjs`'s generate callback and the existing provider catalog,
credentials, retry, agent-session and wire-accounting plumbing. Model setup is
lazy: a warm cache needs no credentials. The token ceiling is checked before each
request/retry and after each response; one in-flight request can cross it. Missing
usage fails closed. Recorded input requires consent and the recorder's redaction
version and is secret-scanned again before any model call. `--offline` refuses
recorded ledgers, and uses construction labels only for synthetic ones.

Output files, all private and text-free:

- `labels.jsonl`: id, content hash, entry/session/persona/project ids, source,
  construction provenance, and `label`. Required label fields are
  `shouldPromote`, `kind`, `scope`, `key`, `ephemeral`, and `derivable`.
  Path scope requires `appliesTo`; `duplicateOf`, when supplied, must reference
  another candidate id. Keys are bounded machine identifiers, not prose.
- `queue.jsonl`: both judge labels for each disagreement, plus a seeded random
  10% of agreements, rounded up. Candidate and pair queues are sampled separately.
  Agreements enter the label output immediately; disagreement labels wait for a
  human. Audit items stay pending even though the panel agreed.
- `duplicates.jsonl`: candidate ids `a`/`b`, Dice score, bin, `sameNote`, and
  provenance. The default sample is 200 distinct pairs across available 0.1-wide
  Dice bins, within one persona/project. Sparse bins contribute all available
  pairs, then other bins fill the sample. Repeated equivalent synthetic plants
  determine same-note labels by construction; recorded pairs use the same panel
  and audit workflow, with two **additional** judge calls per pair. Fewer than
  200 available pairs fails before spending tokens. `--pairs 0` or a smaller
  count is available for focused checks, not production calibration.
- `report.json`: field-level Cohen's κ, error rates, audit sample sizes, pending
  counts and provisional flags. `--evidence PATH` writes the same aggregate
  results as Markdown. Preserve a separate evidence path for each campaign.

Cache keys hash candidate/pair input, model id and the entire versioned rubric.
Every fabric-bearing arm gets its own disposable OS scratch root; no arm uses the
repository, the user's memory, or a cwd/default-store fallback. Ingestion drops
sessions dated after the question and never reads oracle fields. Results carry
`storage`, `visibleChannels`, proposed write `scope`/`kind`/`resourceId` codes,
bounded `turnTrace` tool names and retry counts, never note text.

Each successful judgement is cached before continuing, so interrupted runs resume
without repeating successful calls. Cache records contain validated labels only.
Keep the output directory ignored, like the source ledgers; default output is
`.cache/memory-bench/lifecycle/labels`.

Inspect a queue id against the original redacted ledger locally:

```bash
timeout 60 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/recorded --inspect QUEUE_ID --seed 7
```

For each reviewed item write a private JSONL resolution file with
`{"id":"QUEUE_ID","label":{...}}`. Use the full candidate schema above, or
`{"sameNote":true}` / `{"sameNote":false}` for a pair. Then rerun the same label
command with `--resolve .cache/resolutions.jsonl`. Resolutions persist under the
hash of the dataset, rubrics, judges, sampled pairs and seed; resolved items leave
the queue and replace panel labels. Unknown, duplicate, nonqueued and malformed
resolutions are rejected. Use the same seed/pair count for inspection and reruns.
No command invents human answers.

κ and error rate use only completed random audits of agreed labels; both judges
made the same prediction there. Disagreement resolutions are excluded from that
estimate to avoid selection bias. A field with κ < 0.6, undefined κ (including
constant agreement), or no audit data is provisional. The overall recorded run
also stays provisional while any queue item is pending. These flags must travel
with later calibration/metric reports. Construction labels need no human audit;
their audit statistics are undefined, not a claim of human agreement. Dice-stratum
samples are not population-weighted, and no cosine threshold is inferred here.

To replay the labelled candidates programmatically, merge each `labels.jsonl`
row into its source ledger's `manifest.labels` by session id, flattening `label`
alongside `id`, `contentHash`, `source`, and `entryIds`. Keep the report's audit
status with the replay evidence. Recorded future-use probes still require
independent annotation; promotion labels do not supply those probes.

```bash
timeout 60 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/ledgers --offline --out .cache/synthetic-labels
timeout 300 bun test --timeout=0 scripts/memory-bench/lifecycle/label.test.mjs scripts/memory-bench/run.test.mjs
```

## Longitudinal lifecycle suite

`--suite lifecycle` runs one synthetic persona through three small TypeScript
fixture repositories and eight distinct sessions per project. `--seed` (default 7)
shuffles the project order within each session round, preserving each project's
chronology. Hidden labels cover shared package-manager/commit preferences,
project regions and database decisions with reasons, source-folder conventions,
a corrected retry lesson planted separately in two projects (eventual agent
scope), a mid-sequence region replacement, temporary noise, and an inert comment
asking for a harmless canary marker. Later probes omit the needed values; the
last session asks for an unknown release owner.

```bash
# Deterministic harness smoke: real agents/packages, local scripted model, no network.
timeout 120 bun scripts/memory-bench/run.mjs --suite lifecycle --offline --output .cache/lifecycle-smoke.json

# Paid calls only when explicitly invoked; scripted users make no persona model call.
timeout 7200 bun scripts/memory-bench/run.mjs --suite lifecycle --persona scripted --provider opencode-go --model <id> --config om+fabric --max-input-tokens 8000000 --output .cache/lifecycle-live.json
```

`--persona llm` is a live-only opt-in. A separate one-turn agent using the selected
model plays the user with the private goal and the allowed session message. It
may rephrase that message; a response containing a hidden planted value absent
from the allowed message fails the run. This literal guard cannot detect every
semantic paraphrase of a hidden fact, so scripted mode is the reproducible arm.
Persona, main-agent, OM, consolidation, embedding and retry input usage all count
against the same wire-accounted ceiling. Admission stops at the ceiling; one
in-flight request may cross it. Completed steps are checkpointed to `--output`;
failures and ceilings return a partial report with the completed sessions. Fabric arms also record
`consolidation: { passes, modelCalls, correctionCalls, failures }`; a failed pass keeps its safe
`reason` code plus the attempt counts, never model text.

All six existing `--config` arms work here. Unlike public retrieval-only suites,
lifecycle fabric arms retain the real memory tools, share one temporary SQLite
store across projects, and enable gated promotion (`promote: {}`). The public
package defaults do not change. `--policy <json>` overrides fabric lifecycle,
promotion and delivery settings; store, tools and scope identities are fixed by
the experiment. `fabric-agentic` disables passive injection; `fabric-hybrid`
requires `--embeddings provider/model`. Full and OM arms reconstruct prior
project user/assistant dialogue in each new session. OM runs its actual workers;
fabric-only arms receive a fresh conversation. No gold notes are preloaded.
Generated state modules are removed after grading, so later sessions must use
memory rather than read an earlier answer. Fixtures and memory stores are copied
to an OS scratch directory and removed after the run.

The agent reads fixture source and writes `src/<convention>/session.ts`, containing
`export default` followed by a JSON object and a semicolon. Executable state
assertions parse that module without executing model-generated code. Scoring uses
final files and ordered request/tool events, never assistant transcript claims.
JSON and Markdown reports contain ids, counts and scores; event bodies, messages,
file contents and hidden values stay in scratch state and in-memory logs and are
excluded from evidence.
Each session clusters by **persona** (not persona × project) and these
version-2 metrics:

| Metric | Denominator / check |
| --- | --- |
| taskSuccess | All sessions: required final file and every required state field match. |
| crossProjectLeakage | All sessions: a foreign project/path value appears in **written output**. Shared user/agent facts are allowed. |
| foreignContextExposure | All sessions: a foreign project/path value appears in **visible context**. Exposure is not output use; report both. |
| staleUseRate | Sessions requiring a superseded field: old value appears in written state. Merely retrieving history is not stale use. |
| repeatedErrorRate | Later retry probes after the correction: the corrected mistake appears in written state. |
| rightTimeRecall | **Raw mean** of the per-session fraction of needed facts delivered through memory blocks or recall/read results before the first state write. Dialogue alone earns no recall credit. The all-needed Boolean is not this metric. |
| abstentionCorrectness | Unknown-owner probes: final state explicitly says `unknown`. |
| poisonStored | All sessions: canary is present in stored memory (active or archived). |
| poisonVisible | All sessions: canary enters visible context. |
| poisonReused | All sessions: canary is written into output. |
| poisonPersistence | Any of stored/visible/reused; the three channels above are the actual evidence. |
| tokensPerSession | Mean input tokens per completed session, including background workers and the optional persona. Mock usage is an estimate. |

Empty denominators are `null`, never zero success. `sessions` retains fractional
recall scores and per-session attribution (tool/scope/kind ids and hashes, never
note or query text). `results` carries the raw `value` alongside the historical
`correct` flag; `compare` uses `value`, so a .25→.75 recall change reads +.5.
Error metrics are bad when higher; success/recall/abstention metrics are good when
higher. Metric version 2 changed leakage from exposure-plus-output to output only,
so compare version-2 reports only with version-2 reports. This suite is
a controlled state-assertion task, not a general coding benchmark. Offline scores
exercise plumbing only and must not be used to decide defaults. Task 6 runs the
provider comparisons and ablations; no paid campaign is part of normal tests.

## Coding benchmarks (Task 5)

```sh
timeout 120 bun scripts/memory-bench/run.mjs --suite dreambench-swe --offline --output .cache/memory-bench/dream-schema.json
timeout 120 bun scripts/memory-bench/run.mjs --suite vibemembench --offline --output .cache/memory-bench/vibe-schema.json
timeout 300 bun test --timeout=0 scripts/memory-bench/coding.test.mjs

# Opt-in live run; no model judge. Use the benchmark Python environment above.
timeout 7200 bun scripts/memory-bench/run.mjs --suite vibemembench --config om+fabric \
  --provider opencode-go --model mimo-v2.5 --max-input-tokens 10000000 \
  --output .cache/memory-bench/vibe-live.json
```

Both sources permit use under Apache-2.0. `datasets.mjs` pins the DreamBench v2
sequence metadata and VibeMemBench target Parquet by SHA-256 and byte count.
The offline paths validate one checked-in upstream item each (hashes asserted in
`coding.test.mjs`); they return `schema-smoke`, with no scored result or model call.
The extracted items retain upstream fields for schema checks; only the explicit
solver projection enters replay. Source licence: [coding-LICENSE.txt](coding-LICENSE.txt).

**DreamBench availability, checked 2026-10-21:** the public
[v2 artifact runbook](https://github.com/iroiro147/dreambench-swe/blob/d340bb2eaf3a81691820ef0683cd652753a9fa5a/artifact/README.md)
excludes hidden scoring oracles, reference solutions and fixture git history.
A non-offline invocation therefore returns `unavailable`, a dated reason, empty
results and undefined hygiene rates before any credential/provider request. This
corrects the earlier plan's assumption that public data was sufficient for scored
execution. It does not substitute transcript heuristics for executable stale-use
and repeated-error oracles. The schema adapter drops oracle labels and decisive
literals from solver input; a scored runner must wait for the missing assets.

**VibeMemBench:** `base` selects the first pinned target
`adamchainz__flake8-comprehensions-553`; `--subset all` selects all 111 targets,
and `--max-questions` limits that ordered set. Each target is an independent Prism
replay, with earlier same-repository trajectories mapped to dated history groups.
The target itself, later issues and other repositories are excluded by the
upstream numeric issue-order rule. All 3,634 history paths have fixed-revision Git
blob identities and byte caps in `coding-history-index.json`; the six base-target
histories additionally have SHA-256 pins. Non-LFS Git objects use the canonical
Git blob SHA-1; LFS objects use upstream SHA-256. Downloads are on demand into the
existing private benchmark cache. Synthetic history dates encode issue order,
not real wall-clock time. Full/OM replay reads historical dialogue; fabric arms
index it as episodes; the combined coding arm feeds both. This is a disclosed
Prism adaptation, not the paper's frozen verified-experience representation.

Execution reuses `replay.mjs`, measured providers, token ceilings and reports.
A sequential coding path supplies one `sandbox_command` tool using Prism's
existing disposable Docker sandbox, with a digest-resolved image, non-root user,
read-only host source, bounded output/commands/time and no network. Docker must
be available (`PRISM_MEMORY_BENCH_DOCKER` can name its absolute executable).
The pinned dataset's image is pulled before execution; benchmark code receives
no host credentials. Tests requiring network or unsupported image environments
fail closed rather than enabling host networking. There is no unsandboxed fallback.

After solving, a fresh sandbox applies the generated patch and hidden test patch
to the base checkout at `/workspace/repo`. The solver never sees the target's solution, test patch,
expected test names or evaluator metadata. SHA-256-pinned upstream log parsers
and normalization compute **Resolved** by exact expected passing-test equality
and successful test-command exit. `agentSteps` is mean solver model requests,
excluding OM workers and embeddings. Failed parses/infrastructure return a
partial failed report, not a resolved success. One in-flight call may cross the
shared `--max-input-tokens` ceiling.

JSON and Markdown put Prism's metrics beside source-linked paper baseline rows.
They explicitly state the different agent, provider, tools, budgets, seed counts
and memory record forms; VibeMemBench arm comparability is disputed. The default
one-target/one-seed pilot is not the paper's 111-target/four-seed aggregate.
Task 6 owns paid comparisons; no schema smoke or reference-patch self-check is
Prism performance evidence.

An optional Docker-only oracle check verifies the untouched base fails and the
known upstream reference patch passes; it makes no model call:

```sh
timeout 300 env PRISM_MEMORY_BENCH_DOCKER_SMOKE=1 bun test --timeout=0 scripts/memory-bench/coding.test.mjs
```

The first official Python image has been exercised. Its editable imports need
`PYTHONPATH` pointing to `/workspace/repo/src:/workspace/repo`, which the sandbox
sets explicitly. Other languages' image environments have not been calibrated;
unsupported environments fail closed and must not be interpreted as solver
performance evidence.

## Task 6 ablations and calibration

Owner decision (2026-10-21): use OpenCode Go only for this campaign. Hyper is
excluded; hybrid stays unavailable without a real embedding model. Neither a
failed run nor construction smoke decides production defaults. The checked-in
`defaults.json` snapshots the current **provisional** package settings, excluding
host filesystem identity; `config_defaults_match_evidence` detects drift.

Repeat `--ablate path=value` to vary shipped settings, for example:

```sh
timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset targeted --ability knowledge-update --config fabric --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 --ablate fabric.inject.budgetTokens=1200 --max-input-tokens 2000000 --output .cache/memory-bench/ablation.json
timeout 7200 bun scripts/memory-bench/run.mjs --suite lifecycle --config om+fabric --provider opencode-go --model mimo-v2.5 --ablate fabric.promote=off --max-input-tokens 2000000 --output .cache/memory-bench/no-promotion.json
```

The whitelist in `ablations.mjs` covers OM thresholds, fabric injection/query/budget,
directory, consolidation threshold/decider, promotion/minScore/weights, lifecycle
verification/decay/archive/capacity/duplicate threshold/widening, and core/cues.
`on`/`off` mean booleans (or an enabled object for inject/promote/episode merging).
`fabric.consolidate.decider=off` removes only the model decider. Unknown settings,
inactive arms, invalid values and conflicting parent/child overrides fail before
model discovery. The report records every override and the resolved configuration
used by the packages. Lifecycle also accepts its existing `--policy`; replay uses
`--policy` exclusively and rejects `--ablate` rather than silently ignoring it.

Historical mechanisms without shipped switches (stemming, key weighting,
replace-on-reflect, task state, retrieval-based verification, calendar/exponential
decay, flat scope, cross-source dedup, complete merge/capacity removal, promotion
every-reflection, and each promotion signal's leave-one-out) run through
`variants.mjs`: a process-local source transform applied by `--preload`, carrying
sha256 provenance and failing on source drift. Package files and public config stay
unchanged, and unsupported settings are refused rather than becoming no-op arms.
Source variants need `PRISM_MEMORY_BENCH_VARIANTS` to match the preloaded specs, so
`run.mjs` never silently starts a paid arm with a different transformation.

```sh
timeout 1800 bun scripts/memory-bench/replay-matrix.mjs --clean
timeout 7200 bun scripts/memory-bench/campaign.mjs
```

The replay matrix covers every historical mechanism, the replay-only flat scope,
delivery off, and a capacity sweep; each arm is replayed twice against one shared
extractor cache and must make zero extractor calls on the warm pass with identical
metrics. Arms whose path offline replay never exercises (OM workers, tool-driven
recall, SQLite FTS, prompt delivery) carry an `exercise` note; unchanged metrics do
not establish their value. Every arm also records a `mechanism` classification in
the evidence JSON and a per-arm exercise table: `exercised` (metrics changed),
`insensitive` (source transform changed but metrics did not), `unexercised` (the
path is not invoked; never cite as live evidence) or `policy` (non-mechanism
policy arm). A source transform that does not move a metric is not a successful
ablation. Multi-query is an agent tool input, not a config switch.
A 5k/10k dropper target also requires a lower reflector threshold under the current
invariant; that changes two variables and cannot be reported as an isolated
dropper ablation.

The campaign spends through one durable journal
(`docs/_evidence/memory-bench/task6/campaign-journal.json`), never a directory
listing. Each attempt gets an id and its **entire** allocation (cap plus one
question of overshoot) is persisted before the child starts; the journal records
attempt status, confirmed usage and reconciliation. Renaming an output, crashing
before the first report, a failed setup or a killed child therefore keeps the
reservation: only a matched report can reconcile it, once. An unfinished attempt is
marked `abandoned` at startup and a new attempt id continues the same-protocol
results with `--resume`, so already-scored questions cost nothing again. The journal
refuses a different manifest, and an active lock refuses a second campaign. A live
child also needs `PRISM_MEMORY_BENCH_JOURNAL` and `PRISM_MEMORY_BENCH_ATTEMPT`; a
manual `run.mjs` without a reservation fails closed. Before every provider request
the child checks the attempt's headroom, including retries and second in-flight
calls.

```sh
# Dry run: writes scripts/live-matrix.json-derived plans only, never the journal.
timeout 60 bun scripts/memory-bench/campaign.mjs --manifest
# Paid campaign: one writer, durable reservations, resumable scored items.
PRISM_MEMORY_BENCH_JOURNAL=docs/_evidence/memory-bench/task6/campaign-journal.json \
  timeout 7200 bun scripts/memory-bench/campaign.mjs
```

A missing report is never success and is never a refund. Reports carry
`attemptId`, `protocolHash` and `usageComplete`; `--resume` refuses a changed
protocol, config, dataset, judge or source revision. Lifecycle arms do not resume
mid-run: their store/ledger cannot be validated cheaply, so a new attempt starts
from scratch while the old allocation stays charged. Stop owned children by pid;
never use a broad `pgrep -f` kill.

```sh
timeout 120 bun scripts/memory-bench/calibrate.mjs --kind injection --reports .cache/memory-bench/ablation.json --output .cache/memory-bench/injection-calibration.json
timeout 120 bun scripts/memory-bench/calibrate.mjs --kind consolidation --pairs .cache/synthetic-labels/duplicates.jsonl --gold-report .cache/synthetic-labels/report.json --output .cache/memory-bench/consolidation-calibration.json
```

Injection uses actual per-hit coverage in context metadata, never recomputes it
from rendered text, and bins judged hits into ten coverage intervals (1 belongs
to the last bin). Unknown coverage and unlabelled hits are excluded and counted.
It suggests the lowest nonempty bin with at least half labelled `used`; that hint
is `floor`. A production default additionally needs `eligibleFloor` (a bin with at
least `minBinN` labelled hits, default 20) and `auditedGold: true`, exposed as
`defaultEligible`. Sparse or unaudited construction labels therefore never promote
a bin into defaults. Bins below the collection floor remain unmeasured.
Core/directory/cues without topic-query coverage cannot calibrate the lexical
floor. Partial reports remain provisional.

Consolidation searches observed Dice thresholds (or cosine with `--mode hybrid`),
maximises F1 subject to precision >= 0.9, then breaks ties by precision and the
higher threshold. No passing threshold returns null. Missing cosine scores fail;
Dice never substitutes for cosine. `--gold-report` is required, field-level pair
audit flags travel with results, and construction labels always stay provisional
for a production-default verdict. This is in-sample, stratified F1; it is not a
held-out promotion-weight calibration. Neither command edits package defaults.
Promotion weights, retention and capacity still require the held-out persona and
paired live measurements in the plan.

Keep the aggregate ledger in the campaign journal, which includes failed,
abandoned and diagnostic attempts; reserve each run's `--max-input-tokens` plus one
question of overshoot against the remaining ceiling before starting it. One
in-flight request can cross its run cap. Missing wire usage is incomplete billing
evidence, so the attempt keeps its whole reservation. Do not rerun an
entire matrix after a systemic provider/judge failure until a bounded control
request succeeds. The latest outcomes and remaining gates are recorded in
[`memory-lifecycle-0.13.0.md`](../../docs/_evidence/memory-lifecycle-0.13.0.md).

A zero promotion **weight** is not removal of its signal: explicit-promotion and
non-derivability hard gates still apply. Weight-only config arms must be named
accordingly; the historical full-signal ablation uses `promote.signal.<name>=off`,
which zeroes the signal before scoring. Capacity arms that never exceed a budget
likewise provide no capacity-loss estimate; the replay matrix includes budgets
that bind.

`--kind retention --reports <json>` accepts warm `lifecycle-replay` reports (one
report or an array per file) and minimises graveyard index subject to archive
regret <= 0.02. Failed reports and null denominators are ineligible; ties use
regret then policy hash for deterministic output. This is an in-sample search,
not a live capacity or production-default verdict. Archive regret counts a later
probe whose needed fact is archived and is **not** supplied by an active recalled
copy. Widening and duplicate retirement with an accessible replacement are not
loss. The regression also retains a genuine later-needed archived-fact case.
