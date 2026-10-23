# Memory benchmark — 0.13.0

## Task 2 baseline (2026-10-18–19)

All three pinned suites and all four configurations were executed or explicitly
recorded as unavailable. LongMemEval and conflict-resolution full context
completed; LoCoMo and the memory configurations have failed outcomes. This is
the pre-Task-3–13 snapshot. No memory defaults changed from these measurements.

The [harness README](../../scripts/memory-bench/README.md) records protocols,
immutable URLs, checksums, licenses, commands and cost. All downloaded artifacts
passed their pinned byte-size and SHA-256 checks.

| Suite | Pinned draw | Verified strata |
| --- | ---: | --- |
| LongMemEval-S cleaned | 70 | 10 each of six ordinary types, plus 10 `_abs` abstentions |
| LoCoMo | 386 | All QA from `conv-47` / `conv-49`: 26 open-domain, 67 temporal, 57 multi-hop, 156 single-hop, 80 adversarial |
| MemoryAgentBench CR | 40 | 20 single-hop / 20 multi-hop `(row, question-index)` pairs across eight context-size rows |

The model and judge are `opencode-go/mimo-v2.5`, temperature 0,
`maxTokens: 4096`. The native model catalog supplies the input cap. Full context
was run first per suite. Each question has an isolated store and distinct
provider session id; source ids and dates are stable. Fact-stream ingestion dates
are synthetic. Source dates appear in the final provider view; workers use the
shipped OM serializer.

OM uses shipped thresholds: observer 10k message tokens, reflector 20k observation
tokens, drop target 10k, compaction 81k estimated tokens, eight recent messages.
Empty-input checkpoint runs trigger normal background work without invented user
instructions. Resolved memory configurations are stored in JSON. Fabric starts
empty and has no automatic write path until Task 13.

## Recorded outcomes

Failed-run scores apply only to scored questions. They are not full-draw estimates.

| Suite | Config | Status | Scored | Correct | Input | Cache read | Cache ratio | Output | Evidence |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| longmemeval-s | full | completed | 70/70 | 56/70 | 8,372,644 | 512 | 0.0001 | 24,898 | [JSON](memory-bench/longmemeval-s-full-opencode-go-mimo-v2.5-baseline.json) |
| longmemeval-s | om | failed: MemoryBenchWorkerError | 0/70 | n/a | 799,325 | 687,616 | 0.8602 | 53,421 | [JSON](memory-bench/longmemeval-s-om-opencode-go-mimo-v2.5-baseline.json) |
| longmemeval-s | fabric | unavailable — no automatic write path | 0/70 | n/a | 0 | 0 | 0.0000 | 0 | [JSON](memory-bench/longmemeval-s-fabric-opencode-go-mimo-v2.5-baseline.json) |
| longmemeval-s | om+fabric | failed: MemoryBenchWorkerError | 2/70 | 1/2 | 1,139,663 | 889,792 | 0.7808 | 63,802 | [JSON](memory-bench/longmemeval-s-om+fabric-opencode-go-mimo-v2.5-baseline.json) |
| locomo | full | failed: MemoryBenchJudgeError:judgemustansweryesorno | 159/386 | 132/159 | 6,939,304 | 6,734,592 | 0.9705 | 42,576 | [JSON](memory-bench/locomo-full-opencode-go-mimo-v2.5-baseline.json) |
| locomo | om | failed: MemoryBenchWorkerError | 3/386 | 1/3 | 1,537,367 | 1,310,464 | 0.8524 | 38,187 | [JSON](memory-bench/locomo-om-opencode-go-mimo-v2.5-baseline.json) |
| locomo | fabric | unavailable — no automatic write path | 0/386 | n/a | 0 | 0 | 0.0000 | 0 | [JSON](memory-bench/locomo-fabric-opencode-go-mimo-v2.5-baseline.json) |
| locomo | om+fabric | failed: MemoryBenchWorkerError | 2/386 | 1/2 | 819,852 | 706,688 | 0.8620 | 34,970 | [JSON](memory-bench/locomo-om+fabric-opencode-go-mimo-v2.5-baseline.json) |
| memoryagentbench-cr | full | completed | 40/40 | 17/40 | 11,032,677 | 9,599,488 | 0.8701 | 6,621 | [JSON](memory-bench/memoryagentbench-cr-full-opencode-go-mimo-v2.5-baseline.json) |
| memoryagentbench-cr | om | failed: MemoryBenchWorkerError | 3/40 | 3/3 | 1,204,597 | 855,104 | 0.7099 | 56,398 | [JSON](memory-bench/memoryagentbench-cr-om-opencode-go-mimo-v2.5-baseline.json) |
| memoryagentbench-cr | fabric | unavailable — no automatic write path | 0/40 | n/a | 0 | 0 | 0.0000 | 0 | [JSON](memory-bench/memoryagentbench-cr-fabric-opencode-go-mimo-v2.5-baseline.json) |
| memoryagentbench-cr | om+fabric | failed: MemoryBenchWorkerError | 3/40 | 3/3 | 1,130,203 | 915,136 | 0.8097 | 54,806 | [JSON](memory-bench/memoryagentbench-cr-om+fabric-opencode-go-mimo-v2.5-baseline.json) |

LongMemEval full context: **56/70 (80%)**, no truncated questions.
Conflict-resolution full context: **17/40 (42.5%)**, with oldest input trimmed on
**10/40** questions to fit the model cap. These are model-specific results.

### Per-ability results

Correct/scored and mean LoCoMo stemmed F1 follow. Failed configurations retain
only abilities actually scored; JSON also retains the finer LongMemEval types.

| Suite | Config | Ability | Correct/scored | Accuracy | Mean F1 |
| --- | --- | --- | ---: | ---: | ---: |
| longmemeval-s | full | knowledge-update | 8/10 | 0.8000 | n/a |
| longmemeval-s | full | multi-session | 8/10 | 0.8000 | n/a |
| longmemeval-s | full | information-extraction | 22/30 | 0.7333 | n/a |
| longmemeval-s | full | temporal-reasoning | 8/10 | 0.8000 | n/a |
| longmemeval-s | full | abstention | 10/10 | 1.0000 | n/a |
| longmemeval-s | om+fabric | multi-session | 0/1 | 0.0000 | n/a |
| longmemeval-s | om+fabric | information-extraction | 1/1 | 1.0000 | n/a |
| locomo | full | open-domain | 8/13 | 0.6154 | 0.0635 |
| locomo | full | temporal | 21/34 | 0.6176 | 0.0992 |
| locomo | full | multi-hop | 16/20 | 0.8000 | 0.2097 |
| locomo | full | single-hop | 81/83 | 0.9759 | 0.1493 |
| locomo | full | adversarial | 6/9 | 0.6667 | 0.1111 |
| locomo | om | open-domain | 0/1 | 0.0000 | 0.0000 |
| locomo | om | temporal | 0/1 | 0.0000 | 0.0000 |
| locomo | om | multi-hop | 1/1 | 1.0000 | 0.1538 |
| locomo | om+fabric | temporal | 0/1 | 0.0000 | 0.0000 |
| locomo | om+fabric | multi-hop | 1/1 | 1.0000 | 0.0467 |
| memoryagentbench-cr | full | conflict-resolution-single-hop | 15/20 | 0.7500 | n/a |
| memoryagentbench-cr | full | conflict-resolution-multi-hop | 2/20 | 0.1000 | n/a |
| memoryagentbench-cr | om | conflict-resolution-single-hop | 3/3 | 1.0000 | n/a |
| memoryagentbench-cr | om+fabric | conflict-resolution-single-hop | 3/3 | 1.0000 | n/a |

### Calls and memory injection

Calls include follow-up worker rounds. Billing is wire usage, including workers
and judging. Injection-token allocations are character estimates, not billing.

| Suite | Config | Observer | Reflector | Dropper | Embedding | Decider | Judge | Gateway retries | Injected tokens/turn | Irrelevant rate | Cited-id rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| longmemeval-s | full | 0 | 0 | 0 | 0 | 0 | 70 | 0 | 0.00 | n/a | n/a |
| longmemeval-s | om | 52 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | n/a | n/a |
| longmemeval-s | fabric | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | n/a | n/a |
| longmemeval-s | om+fabric | 68 | 0 | 0 | 0 | 0 | 4 | 0 | 17.00 | 1 | n/a |
| locomo | full | 0 | 0 | 0 | 0 | 0 | 160 | 0 | 0.00 | n/a | n/a |
| locomo | om | 44 | 0 | 0 | 0 | 0 | 6 | 0 | 17.00 | 1 | n/a |
| locomo | fabric | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | n/a | n/a |
| locomo | om+fabric | 21 | 0 | 0 | 0 | 0 | 6 | 0 | 73.67 | 0.75 | n/a |
| memoryagentbench-cr | full | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0.00 | n/a | n/a |
| memoryagentbench-cr | om | 19 | 0 | 0 | 0 | 0 | 3 | 0 | 17.00 | 1 | n/a |
| memoryagentbench-cr | fabric | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 | n/a | n/a |
| memoryagentbench-cr | om+fabric | 18 | 0 | 0 | 0 | 0 | 3 | 0 | 17.00 | 1 | n/a |

## Failures, retries and comparison limits

- Worker failures are recorded as `MemoryBenchWorkerError`; source/memory text
  and raw messages are absent. No score is inferred for failed replay questions.
  The final conflict-resolution combined attempt also failed with the longer
  call deadline. Later tasks own changes to OM.
- Initial LoCoMo full context scored 307/386 before an answer run limit, using
  12,171,833 input tokens. Its [diagnostic](memory-bench/locomo-full-opencode-go-mimo-v2.5-request-timeout-diagnostic.json)
  is retained. The retry stopped on an invalid judge response after 159/386;
  strict yes/no scoring failed closed. The attempts are not merged.
- Initial conflict-resolution full context scored 4/40 before an answer run
  limit, using 1,049,155 input tokens. Its [diagnostic](memory-bench/memoryagentbench-cr-full-opencode-go-mimo-v2.5-request-timeout-diagnostic.json)
  is retained. The retry completed all 40.
- Initial OM stopped at the original two-minute worker-pass wait before scoring,
  using 587,734 input tokens. Its [diagnostic](memory-bench/longmemeval-s-om-opencode-go-mimo-v2.5-worker-timeout-diagnostic.json)
  is retained. Worker waits became ten minutes. Individual calls and answer runs
  initially retained two-minute deadlines; after the full-context run-limit
  failures those also became ten minutes. Only conflict-resolution combined and
  the two full-context retries used the longer call deadline.
- Every attempt retained the 15M input-token ceiling. In-flight requests can
  cross it; new requests and admissions stop. No recorded final attempt reached
  it. Failed attempts still incurred reported usage. Earlier Qwen flash artifacts
  are failed exploratory runs, not this MiMo baseline.
- No live paired McNemar claim is available: scored question sets differ. The
  command refuses mismatched ids, abilities or judges. Exact binomial behavior is
  verified with deterministic fixture pairs. No partial sets were filtered or
  merged to manufacture a paired comparison.
- Injection accounting is block-level until Tasks 4, 9, 11 and 12 add metadata.
  Block relevance is not item precision or causal evidence; cited-id rates are
  unavailable. Counts can include attempts that failed scoring.
- Combined fabric begins without semantic notes. Embedding/decider counts are
  zero in this pre-promotion setup; fabric-only is explicitly unavailable.
- The judge templates match pinned upstream, but the model differs from the
  papers. Scores are not directly comparable to published results. Small strata
  and partial sets have limited statistical power. Cache reuse depends on
  provider history and sequential order; this is not a cache experiment.

## Verification

- Harness regressions: 19 passed, including checksum/size refusal, ceiling,
  all 14 synthetic ability/type keys, isolation, injection accounting and pairing.
- Offline smoke is in the default gate-test chain; 17 runner checks also passed
  (36 combined). Live benchmarks remain manual-only.
- Native fabric: 153 passed; 19 external Postgres tests skipped.
- Native observational: 64 passed.
- Live matrix, generated documentation and workflow checks: 28 passed.
- Full workspace typecheck and release gate passed.
- Pinned draws and isolated Parquet decoder checked locally; stemmed-F1 protocol
  self-checks passed. No memory-package runtime dependency added.

## Task 14 final run and ablations

Pending Tasks 3–13. Failed memory baselines and incomplete LoCoMo measurement
remain explicit limitations for final evaluation.

## Plan 188.6 Task 6 rerun attempt (2026-10-21)

Owner scope: OpenCode Go only, `mimo-v2.5` solver/judge; Hyper excluded.
LongMemEval-S full failed before scoring (357,644 reported input tokens; usage
incomplete), and fabric stopped at 4/70 scored (1/4 correct; 12,378 input tokens)
on an invalid injection-judge label. These partial, unmatched sets establish no
paired effect, cache-parity verdict or production default. Failed attempts count
toward the 90M campaign ceiling; incomplete usage is not zero billing.

[Lifecycle campaign evidence](memory-lifecycle-0.13.0.md)
records reports, 13 warm-cache construction replay arms, provisional calibration
tables, retained defaults and remaining gates. The measured sparse injection bin
suggests 0.5; construction Dice fitting suggests 1.0, but neither is applied.
The lifecycle combined arm also failed at 13/24 sessions on consolidation
(338,864 input tokens). All settings remain provisional. Different providers, judges, budgets, seeds,
memory representations and solver protocols prevent comparison with paper scores;
LoCoMo is comparison only. Task 6 remains incomplete.

## Plan 188.6 Task 6 campaign, second rerun (2026-10-21)

Owner decision: **OpenCode Go only**; Hyper is excluded. Solver and judge are
`opencode-go/mimo-v2.5`, temperature 0, maximum output 4,096. No live embeddings
model is configured, so `fabric-hybrid` and cosine calibration remain unavailable.
Every call ran through the wire proxy; input tokens are recorded provider usage,
not estimates. Failed attempts remain recorded evidence and count against the 90M
shared ceiling; an arm whose usage evidence is incomplete is reserved at its full
allocation rather than at the undercount.

Per-arm input ceilings were 12M for LongMemEval-S, 5M for LoCoMo and
MemoryAgentBench-CR, and 2M for the lifecycle suite. The four-fold concurrency and
ten-minute per-call deadline are unchanged from the baseline.

### Recorded arms

| Suite | Config | Status | Scored | Correct | Input tokens | Usage complete | Evidence |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| longmemeval-s | full | completed | 70/70 | 58/70 | 8,373,632 | yes | [JSON](memory-bench/task6/v2-rerun-longmemeval-s-full.json) |
| longmemeval-s | fabric | completed | 70/70 | 23/70 | 166,220 | yes | [JSON](memory-bench/task6/v2-rerun-longmemeval-s-fabric.json) |
| longmemeval-s | fabric-agentic | failed: run limit | 8/70 | 5/8 | 363,704 | yes | [JSON](memory-bench/task6/v2-rerun-longmemeval-s-fabric-agentic.json) |
| locomo | full | token-ceiling | 115/386 | 94/115 | 5,162,326 | yes | [JSON](memory-bench/task6/v2-rerun-locomo-full.json) |
| locomo | full (setup retry) | failed: setup | 0/386 | n/a | 173,456 | yes | [JSON](memory-bench/task6/v2-rerun-locomo-full-setup-failure.json) |
| locomo | fabric | stopped by operator | 27/386 | 0/27 | 61,284 | yes | [JSON](memory-bench/task6/v2-rerun-locomo-fabric.json) |
| memoryagentbench-cr | full | token-ceiling | 20/40 | 14/20 | 5,492,799 | yes | [JSON](memory-bench/task6/v2-rerun-memoryagentbench-cr-full.json) |
| memoryagentbench-cr | fabric | failed: answer | 7/40 | 6/7 | 16,271 | no (reserved 5M) | [JSON](memory-bench/task6/v2-rerun-memoryagentbench-cr-fabric.json) |
| lifecycle | full | completed | 24 sessions | n/a | 72,534 | yes | [JSON](memory-bench/task6/v2-rerun-lifecycle-full.json) |
| lifecycle | fabric | completed | 24 sessions | n/a | 317,547 | yes | [JSON](memory-bench/task6/v2-rerun-lifecycle-fabric.json) |
| lifecycle | om+fabric | failed: extraction | 3 sessions | n/a | 95,529 | yes | [JSON](memory-bench/task6/v2-rerun-lifecycle-om+fabric.json) |

LongMemEval-S full context answers 58/70 (82.9%) with no truncated questions and
7,978,688 cache-read tokens. Per ability: knowledge-update 0.8, multi-session 0.9,
single-session-assistant 1.0, single-session-preference 0.4, single-session-user
0.8, temporal-reasoning 1.0, abstention 0.9.

LongMemEval-S fabric answers 23/70 (32.9%) with recall@k 0.557 and 35,467
retrieved snippet tokens. Per ability: knowledge-update 0.1, multi-session 0.1,
single-session-assistant 0.7, single-session-preference 0.2, single-session-user
0.2, temporal-reasoning 0.1, abstention 0.9. Zero questions were truncated and
the arm made no tool calls. These are model-specific scores under a different
judge and protocol from the papers.

The LoCoMo full-context arm reached its 5M ceiling after 115 of 386 questions
(94 correct, mean stemmed F1 0.141). MemoryAgentBench-CR full reached its ceiling
after 20 of 40 (14 correct). Both are partial sets and establish no paired
comparison; LoCoMo remains comparison-only. The fabric-agentic LongMemEval arm
hit the eight-turn run limit at 8/70 and was not retried; the fabric
MemoryAgentBench-CR arm failed on an answer before scoring 7/40. No partial sets
were filtered, merged or scored as estimates.

The paired McNemar comparison of the two completed LongMemEval arms (same 70
questions and judge) gives fabric **-0.5 accuracy**: full-only 38 questions,
fabric-only 3, p = 1.05e-8. Per ability, fabric is lower by 0.7
(knowledge-update), 0.8 (multi-session), 0.3 (single-session-assistant), 0.2
(preference), 0.6 (single-session-user) and 0.9 (temporal-reasoning); abstention
ties. After Holm correction within the seven abilities, the multi-session loss
(pHolm 0.047) and temporal-reasoning loss (pHolm 0.027) are significant. Fabric
uses 8.37M to 166k input tokens (2560 cache reads versus 7.98M), so it is a large
cost reduction with a large accuracy loss on this suite. This compares memory
representations, not a switch ablation, and it does not change a default.

### Defaults decision

Every package default is retained; `defaults.json` keeps `status` containing
"provisional". The completed lifecycle pair does not meet the plan's bar for
turning promotion on: task success rose by 0.29 (Holm p 1) but cross-project
leakage rose by 0.92 (22 of 24 sessions) and cost rose 4.4x per session; with
three clusters the design is underpowered, so this is a retained-default
decision, not a proven harm. LongMemEval now has both completed arms; fabric's
0.5 accuracy loss there is a representation cost, not a promotion verdict, and it
also argues against turning promotion on without a task-success win. Injection
has no bin at the 50% used rate, so `inject` stays off and the 0.35 enabled-object fallback is unchanged. `retrieval` stays
`lexical` because no hybrid arm exists. The construction Dice fit (1.0) and the
promotion fit (minScore 1, recurrence/generality 1) are recorded in
[the lifecycle evidence](memory-lifecycle-0.13.0.md) but not applied.

### Measurement and harness changes

- Capacity eviction now tie-breaks equal-strength notes on content before id, so
  a warm replay reproduces the same evictions. A regression test asserts zero
  warm extractor calls and identical metrics under a notes:2 budget; the fabric
  suite passes 398 tests (23 external Postgres skips).
- The wire proxy keeps the chunks already read when an upstream stream resets,
  records the partial exchange, and settles pending exchanges with `allSettled`
  instead of aborting the run. A regression test reproduces a mid-stream reset.
- A benchmark answer that reached the provider but ended without completion
  evidence is re-asked up to twice at the question level; the partial text is
  never scored. A malformed judge answer is re-asked up to twice and then fails
  closed, so a prose reply is not a verdict. In the public-suite harness, a
  provider response without usage now flags the report (`usageComplete: false`,
  `usageMissingExchanges`) and the arm keeps scoring rather than aborting. All
  three decisions have unit tests.
- The campaign records a missing child report as setup-failure evidence and
  continues; abandoned `running` checkpoints are renamed out of the reservation
  count and rerun.

### Ceiling accounting

The campaign counter includes the 10,358,372-token prior reservation plus every
`v2-`/`control-v2-` report, using recorded input, or the arm's full allocation
when usage is incomplete. That total is **45,799,683**. Renaming an abandoned
checkpoint out of the `v2-` prefix removes it from that counter, so the
abandoned LongMemEval full attempts are counted separately here: with them,
recorded input is **59,891,751** (an undercount, because five attempts have
incomplete usage). Reserving each of those attempts at its 10M/12M allocation
instead reaches **101,740,093**, already past the 90M ceiling. The ceiling is
therefore exhausted under conservative accounting even though reported usage is
lower, and no further paid arms were started after the completed pair. The OM
arm was launched and stopped before its first report; it contributes no
evidence. This is a stop decision, not a claim that the campaign stayed inside
90M.

### Limits

The lifecycle leakage counts and LongMemEval scores come from one synthetic
protocol and one model; they are not estimates for other providers, judges or
budgets. LongMemEval full context, `om`, `om+fabric`, LoCoMo fabric/fabric-agentic
and MemoryAgentBench-CR fabric have no clean complete arm, and the targeted
30-per-ability ablation families were not run. The mechanism ablations in
[the lifecycle evidence](memory-lifecycle-0.13.0.md) are construction replays,
not live arms. Failed attempts consumed the reported tokens and count toward the
90M ceiling. Task 6 remains unchecked.

## Metric semantics correction (plan 188.7 Task 3)

The numbers above were produced before metric versioning. They are historical
receipts, not a new verdict; the corrected read-only recomputation is
[`memory-bench/188.7/metric-corrections.json`](memory-bench/188.7/metric-corrections.json)
(report hashes, raw means, direction, clusters, power). Corrections:

- `accuracy` is judge accuracy and `f1` is token-level F1. They were always
  different metrics; the report now labels them separately instead of implying one
  quality score. LoCoMo token F1 is not a judge verdict.
- `retrievalRecallAtK` was a coarse any-evidence-round Boolean. New reports write
  `answerSessionHitAtK`, `evidenceRoundCoverage`, `evidenceAllRequired`,
  `fineEvidenceRecall` and `fineEvidencePrecision` separately. Fine-gold rates stay
  null when the dataset does not expose usable gold ids; a coarse round hit never
  becomes a fine hit. Historical reports cannot be regraded because recalled hit
  ids were not retained with gold provenance.
- Public questions that share a haystack session set, conversation or source
  context are no longer treated as independent. The corrected LongMemEval
  paired accuracy difference remains -0.5 (58/70 vs 23/70), but old reports are not
  confirmatory (no `metricVersion`/`protocolHash`, unclustered rows). New arms
  cluster by shared haystack session set.
- Power for a paired design is now simulated with the same cluster sign-flip test
  the comparison uses. The old independent-arm approximation is retained only as a
  historical function. Three clusters (the lifecycle's project-level view) yield
  power 0 at a .5 effect; the frozen protocol needs at least 8 independent
  persona clusters, and 12 are planned.

The lifecycle-specific corrections (raw right-time-recall mean +.64375 instead of
the all-needed +.75, persona instead of persona×project clusters, exposure versus
output use, and stored/visible/reused poison) are in
[`memory-lifecycle-0.13.0.md`](memory-lifecycle-0.13.0.md).

## Protocol correction from plan 188.7 Task 6 (2026-10-21)

The earlier `om+fabric` public arm was not a combined-memory arm: OM ingested the
dated history while the fabric store stayed empty. Public `fabric`/`fabric-agentic`
arms also had no session history, and an answer retry re-ran on the same dirty
session. Those arms remain historical receipts; they are not comparable to
corrected combined/retry results.

Current arms ingest the same causal pre-question corpus into OM and a disposable
fabric root, drop future sessions and oracle fields, and retry a truncated answer
from the pre-answer branch (or a fresh session when there is no history). Judge
retries use a fresh one-shot session. Coding or mutating attempts are never
replayed. Reports now record retry counts, `maxTurns`, bounded tool-name traces,
visible channels, and proposed write scope/kind/resource-id codes, never note text.

The old `fabric-agentic` arm exhausted the shared eight-turn answer limit. Task 6
kept that limit rather than raising every arm; the protocol records it explicitly
and a changed limit must be a new arm. No paid result in this document is
relabelled or re-scored by these harness corrections.

## Retrieval stage diagnosis and snippet fix (plan 188.7 Task 7)

The frozen development report (`v2-rerun-longmemeval-s-fabric.json`, 70 questions,
47 failed) was replayed through the real lexical fabric package with the benchmark
prompt, default injection kinds, `topK: 3`, `budgetTokens: 600`, and a 32-item
candidate pool. Gold stayed offline. The artifact is
[`memory-bench/188.7/retrieval-diagnostics.json`](memory-bench/188.7/retrieval-diagnostics.json).

| Stage | Failed questions | Meaning |
| --- | ---: | --- |
| `answer_gap` | 21 | The labelled message round was visible; the answer was still wrong. |
| `fine_selection_gap` | 13 | The answer session was visible, but its labelled message round was not. |
| `selection_gap` | 13 | A labelled answer-session round was in the candidate pool, but passive selection showed none. |
| `candidate_gap` | 0 | No labelled answer-session round reached the candidate pool. |

By ability, preference had 7 of 8 failures at `selection_gap`, multi-session had
3 `selection_gap` and 3 `fine_selection_gap`, and knowledge-update had 6
`answer_gap` plus 3 `fine_selection_gap`. So the old arm is not one retrieval
defect: update questions mostly reached the answer model, preferences were often
not shown at all, and multi-session failures split between which source was shown
and what the model did with it.

One shared-path defect was confirmed and fixed: passive injection dropped every
hit whose rendered line exceeded the remaining snippet budget, so an oversized
top note could hide the only useful source. The best matching note is now always
shown, matching `selectWithScopeRecall`'s existing contract; later notes must fit.
Regression: `the best matching note is injected even when it alone exceeds the
snippet budget`, plus complementary multi-session and temporal current/historical
retrieval tests in `lexical-retrieval.test.ts`.

The 13 `selection_gap` cases remain: they need a different representation,
ranking or explicit snippet-budget change, and this task does not raise defaults
from an offline fit. `retrievalRecallAtK` is a coarse answer-session hit; it is not
the fine message-stage label. The 70-question run is development evidence, not
holdout confirmation.

## Plan 188.7 paid acceptance (2026-10-22)

A fresh owner-approved 106M-token campaign ran the frozen 140-question confirmatory set and the
matching MemoryAgentBench-CR/LoCoMo/lifecycle arms on OpenCode Go `mimo-v2.5`. It is **not** a
completed acceptance: 6 of 56 required jobs completed and the safety/power set is missing.
Full evidence, spend journal and the F1–F13 matrix are in
[`memory-bench/188.7/README.md`](memory-bench/188.7/README.md).

The corrected confirmatory pair is LongMemEval-S full 100/140 versus fabric 62/140, paired diff
-0.2714 (95% CI -0.3643..-0.1786, Holm p 0.0008). Knowledge-update and multi-session lose 0.5,
single-session-user loses 0.45; abstention is unchanged. Fabric uses 329,669 input tokens versus
16,017,060 for full, but both reports have incomplete usage, so no monetary or non-inferiority claim
is made. MemoryAgentBench-CR is 18/40 for both. LoCoMo stopped at a 102/115 budget partial
(81 correct). `om` is a one-question probe; `om+fabric` hit `MemoryBenchWorkerError`;
`fabric-agentic` retains the eight-turn `RunLimitError`.

The only completed lifecycle comparison is persona 1887: full task success .292, fabric promotion
off .708; both have labelled cross-project leakage 0. Fabric promotion off nevertheless exposes
foreign context in 13/24 sessions (.542), promotion-on stopped at 9/24, and `om+fabric` failed with
`LifecycleObserverError` before one session. The 12-persona powered safety gate was not reached.
Promotion and injection stay off; defaults are unchanged and provisional. Task 8 and 188.6 Task 6
remain unchecked.

## Plan 188.10 live held-out v3 acceptance (2026-10-23)

Multi-session recall was the owner's 0.13.0 requirement, and 188.9 had left it unproven (+0.25 on
held-out v2, Holm p 0.19). This plan measured the failure stage, added a partial-selection cue and
instance-safe facts, and screened the cheapest lever on development data before spending the one
fresh draw: passive injection **plus** the `memory.*` read tools over the same exchange store.
Development moved multi-session 8/30 → 22/30 with no ability regression, so Stage B (extraction) was
dropped and the tools arm went to held-out v3 — 100 ids never read before (multi-session 40,
knowledge-update 20, temporal-reasoning 20, single-session-user 14, single-session-assistant 6).

| Arm | Scored | Correct | Input tokens | Tokens/question | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `fabric-x` (passive) | 100/100 | 49/100 | 637,815 | 6,378 | reference, same snapshot |
| `fabric-x-tools` (selected) | 100/100 | **76/100** | 2,966,891 | 29,669 | 152 tool calls, 2% run-limit |
| `full` (whole history) | 100/100 | 69/100 | 11,295,518 | 112,955 | |

All three pre-registered primary criteria hold: **multi-session 28/40** (target 24/40), a paired
**+0.45** against the passive reference (95% CI 0.275..0.625, McNemar p = 2e-4), and no
non-regression (knowledge-update +2, temporal-reasoning +5, single-session-user +1,
single-session-assistant +1; overall +0.27, CI 0.17..0.37). Against full context the selected arm is
**+0.07** (95% CI -0.03..0.17), inside the 3-point margin, so the substitution verdict is
**full-context-substitute**: 76/100 at 26% of full context's input tokens.

Attribution is the tool channel, not a bigger window: `evidenceRoundCoverage` 0.628 → 0.834,
`evidenceAllRequired` 52 → 76, irrelevant injection 0.810 → 0.777, and conditional accuracy 44/52
(85%) → 68/76 (89%) when the needed evidence is visible, 5/42 (12%) → 8/19 (42%) when it is not. No
stage table exists for v3 because the multi-session diagnostic refuses the held-out draw by design;
the plan did not weaken that guard after scoring.

Gate 1 used **23,216,343 of 34,000,000** across Stage A, one aborted held-out attempt whose caps were
sized from spend rather than the kernel's in-flight reservation, and the accepted campaign
(14,923,447). The aborted attempt is kept as reliability evidence in its archived journal. Defaults
stay off: the quality rule is met, but exchange archiving changes what the product stores by
default, and no safety or leakage verdict covers that. `fabric-x-tools` is documented as the
recommended **conversational profile**, opt-in.

## Plan 188.9 held-out acceptance (2026-10-23)

The plan asked whether an **exchange** representation (one completed user turn plus the reply,
archived verbatim) beats 188.8's episode store once delivery is held constant, and 188.8 Task 5's
4,000-token delivery is what the screen had compared. So the baseline is the current tree with 188.8's
delivery rule pinned by variant (`fabric.delivery=188.8`: whole notes, 600 tokens, top 3,
similarity 0.35) and the treatment is the same tree with the exchange archive. Both ran held-out v2
(100 ids) on OpenCode Go `mimo-v2.5`, temperature 0, max output 4,096, harness protocol version 2.
`fabric-xc` is out of scope by owner decision: its write side is unmeasured and 25 of 51 measured
sessions failed consolidation. The full-context reference is reused from 188.8's report; its prompt
is the dataset and the protocol, never the delivery code this plan changed.

| Arm | Scored | Correct | Input tokens | Tokens/question | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| fabric (188.8 delivery pinned) | 100/100 | 51/100 | 215,717 | 2,157 | baseline |
| fabric-x (exchange archive) | 100/100 | 76/100 | 661,681 | 6,617 | screened in on development |
| full (reused) | 100/100 | 79/100 | 11,500,702 | 115,007 | from 188.8 |

Paired improvement `fabric-x` vs the pinned baseline: **+0.25 overall** (95% CI 0.16..0.34),
knowledge-update **+0.5** (Holm p 0.0078). Multi-session +0.25 (Holm p 0.19), temporal-reasoning
+0.25 (Holm p 0.25) and single-session-user +0.15 (Holm p 0.25) are positive but not significant
after Holm. Against full context, `fabric-x` is **-0.03** (95% CI -0.12..0.06): the gap is nearly
closed but the non-inferiority margin (3 points) is missed at the CI's lower bound, so it is an
**opt-in improvement, not a full-context substitute**. F13 stays `unresolved` for the same reason.

Delivery attribution on the exchange store: of 24 failures, partial_evidence 8, candidate_gap 5,
fine_selection_gap 4, answer_gap 5 and 2 without usable gold. Conditional accuracy is 63/68 (93%)
when all needed evidence is visible and 13/30 (43%) when it is not, so the remaining loss is mostly
selection, not synthesis. The baseline has no product-store snapshot, so only the treatment arm has
a stage table.

Full evidence, the reproduced screen correction and the aborted-attempt accounting are in
[`memory-bench/188.9/README.md`](memory-bench/188.9/README.md). Defaults stay off and provisional:
the 188.6 enablement rule needs a full-context-substitute verdict, which this evidence does not give.

## Plan 188.8 held-out acceptance (2026-10-23)

The 140 diagnosed confirmatory ids became **development** data for this plan, so the remediation was
measured on a fresh held-out draw of 100 unused LongMemEval-S ids (20 each of knowledge-update,
multi-session, temporal-reasoning, single-session-user and single-session-assistant; preference and
abstention have no unused ids and stay development-only). A 30M-token campaign under harness protocol
version 2 completed all five arms on OpenCode Go `mimo-v2.5`. Full evidence and the aborted-launch
accounting are in [`memory-bench/188.8/README.md`](memory-bench/188.8/README.md).

| Arm | Held-out v2 | Input | Note |
| --- | ---: | ---: | --- |
| `fabric` pre-fix (product treatment only) | 46/100 | 218,663 | delivery = whole best note |
| `fabric` post-fix | 47/100 | 249,736 | bounded query-centred excerpts |
| `fabric-agentic` post-fix | 38/100 | 5,438,935 | 18% eight-turn run-limit |
| `full` reference | 79/100 | 11,500,702 | |
| `fabric` post-fix, development | 65/140 | 347,040 | preference 5/20, abstention 17/20 |

The predeclared primary family (paired post-fix versus pre-fix fabric, Holm across four abilities) is
flat: +0.05 knowledge-update, +0.05 multi-session, -0.05 temporal-reasoning, -0.05 single-session-user,
all p = 1.0, overall +0.01 (95% CI -0.05..0.07). Question (1) is therefore **inconclusive — no
measurable improvement**; the offline development gains did not transfer. Question (2) is **no**:
post-fix fabric is -0.32 against full context (95% CI -0.42..-0.23, p < 1e-4), agentic -0.41. F13 in
`memory-bench/188.7/findings.json` is updated to **unresolved** with the 188.8 evidence column; the
matrix still validates all 13 rows.

Delivery attribution is unambiguous: the excerpt renderer raises all-needed-visible evidence
(knowledge-update 1/20 → 3/20, single-session-user 17/20 → 19/20) and cuts `fine_selection_gap` from
18 to 15 without moving answers, so `answer_gap` absorbs it (26 of 53 failures). Multi-session
aggregation and the preference vocabulary gap are untouched. One round exceeds the core
64,384-character entry limit and cannot be stored by either fabric arm. No paid process remains;
`inject: false` and `defaults.json` are unchanged.
