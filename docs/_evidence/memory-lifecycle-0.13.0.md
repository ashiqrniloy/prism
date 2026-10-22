# Memory lifecycle label evidence

Dataset hash: c9045ed44ac89b18ce9416285eca4e6c2cd0484c9e18822a85ffb529fd0bf5e6. Seed: 7. Provenance: synthetic-construction.

Candidates: 580; accepted labels: 580; duplicate pairs: 200/200; pending human items: 0.
Random agreed-label audits completed: 0; audit error rate: pending/undefined. Provisional: false.

| Field | Audited n | Cohen's κ | Error rate | Provisional |
| --- | ---: | ---: | ---: | --- |
| shouldPromote | 0 | pending/undefined | pending/undefined | true |
| kind | 0 | pending/undefined | pending/undefined | true |
| scope | 0 | pending/undefined | pending/undefined | true |
| key | 0 | pending/undefined | pending/undefined | true |
| appliesTo | 0 | pending/undefined | pending/undefined | true |
| ephemeral | 0 | pending/undefined | pending/undefined | true |
| derivable | 0 | pending/undefined | pending/undefined | true |
| duplicateOf | 0 | pending/undefined | pending/undefined | true |
| pair.sameNote | 0 | pending/undefined | pending/undefined | true |

κ uses only the seeded random audit of agreed labels; both judges made the same prediction on those items. Disagreement resolutions are excluded to avoid selection bias. Constant agreement has undefined κ and remains provisional. Synthetic construction is not a human audit or live-provider validation.

Duplicate pairs are stratified over available Dice bins within persona/project; this sample is not population-weighted. No cosine calibration, live benchmark comparison, or defaults verdict follows from this report.

Executed 2026-10-21: deterministic construction smoke only (4 personas × 3 projects × 8 sessions); zero judge model calls. Human audit and live Hyper/OpenCode Go panel measurements are pending. No production defaults were changed.

## Task 5 — coding benchmarks (2026-10-21)

| Suite | Licence | Executable availability | Prism evidence |
| --- | --- | --- | --- |
| DreamBench-SWE v2 | Apache-2.0 for code/public fixtures | Public metadata available; hidden oracles, reference solutions and fixture history withheld | One pinned-item schema smoke; live path returns dated `unavailable`; no pass/hygiene scores claimed |
| VibeMemBench | Apache-2.0 dataset and benchmark subtree | 111 targets, 3,634 histories, images and evaluator available | One pinned-item schema smoke; real official-image oracle self-check; no provider performance run |

This supersedes plan 188.2 Task 1(i)'s inference that public DreamBench artifacts
were sufficient for scored execution. The [frozen artifact runbook](https://github.com/iroiro147/dreambench-swe/blob/d340bb2eaf3a81691820ef0683cd652753a9fa5a/artifact/README.md)
explicitly excludes the hidden scoring assets and fixture git history. The
availability gate is applied before credentials or model requests. Missing
oracles are not replaced with a judge or transcript heuristic.

VibeMemBench sources: [dataset revision](https://huggingface.co/datasets/Tongyi-ConvAI/VibeMemBench/tree/11164976b4f920cdb0d0cd570ca572e49acea1e8),
[benchmark README](https://github.com/AlibabaResearch/DAMO-ConvAI/blob/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench/README.md),
[benchmark Apache licence](https://github.com/AlibabaResearch/DAMO-ConvAI/blob/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench/LICENSE),
and [upstream evaluator](https://github.com/AlibabaResearch/DAMO-ConvAI/blob/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench/scripts/vendor/eval.py).
The benchmark subtree licence is Apache-2.0 even though the containing repository
was previously described as MIT. Only earlier issue numbers from the same
repository enter memory; target/future/other-repository trajectories are excluded.
Case-insensitive repository matching follows the released identifiers.

| Artifact | SHA-256 |
| --- | --- |
| DreamBench sequence JSONL (329,844 bytes) | `d6573c46aa6a75cee7a8193034b0bf86a1d63422dc7deef8a03e2b81bbcf4d73` |
| Vibe target Parquet (1,104,552 bytes) | `22238743ca143276e3ff4616f569b3921c42945bfee1a6aa8fa376a02feebb98` |
| DreamBench extracted smoke item | `31953d93fe6212f510c6bb02f5257ecd86ceb5de223e7f575c733bde9f7b8e31` |
| Vibe extracted smoke item | `98e1c1f02405830e711bb11e0e645e9eda8f75e53f018285ca6e8defe37bc2cd` |

Both full metadata sources were downloaded, checksum-verified and schema-normalized:
60 DreamBench sequences and 111 Vibe targets. All 3,634 history paths/byte sizes/Git
blob identities are recorded at the fixed HF revision; the six base-item earlier
histories additionally have SHA-256 pins and were downloaded and checked.
Non-LFS histories retain upstream canonical Git blob SHA-1 rather than claiming
unmeasured SHA-256 pins. Three upstream evaluator modules are SHA-256-pinned;
normalization and log parsing use that exact source, not a reimplementation.

The executable self-check target is `adamchainz__flake8-comprehensions-553`.
Its image resolved to
`docker.io/swerebenchv2/adamchainz-flake8-comprehensions@sha256:a64fb6f4cf38ade3e70ac854f3fe6f17bc256b9dc3357cd312913d296a623939`.
The known reference patch passed the official hidden-test parser and command-exit
oracle inside a fresh non-root Prism Docker sandbox with no network. This checks
the runner/evaluator, not a Prism solver. Testing exposed and fixed root-directory
mtime copying, image workspace cache contamination, unreadable direct bind-mount
patches and Python editable imports pointing to the original read-only checkout.
The writable repository now lives at `/workspace/repo`; Python imports prefer
that copied tree; patches use the sandbox's existing tar-import path. No sandbox
isolation, output cap or trust validation was weakened.

Reports contain ids, counts, scores, source hashes and image digests, excluding
problem/history/answer/patch text. Resolved is exact expected passing-test equality
plus test-command exit zero. Agent steps count solver model requests, excluding
memory workers. DreamBench rates stay null while executable assets are absent.
Paper baseline rows are descriptive: different agents, providers, tools, budgets,
seeds and memory record forms prevent direct comparisons; VibeMemBench arm
comparability is disputed. Issue-order history dates are synthetic. Base selects
one target; all selects 111, with one run per target. Only the base image has been
exercised; other language images may need environment calibration and fail closed
when their test environment is unsupported.

No paid provider calls, statistically powered comparison, hygiene measurement,
or production-default verdict was made. Task 6 and whole-plan verification remain
pending. The DreamBench scored path requires upstream executable assets before it
can be enabled.

Validation: `timeout 300s bun test --timeout=0 scripts/memory-bench/` passed 76
tests (one explicit Docker check skipped by default). Enabling
`PRISM_MEMORY_BENCH_DOCKER_SMOKE=1` passed all nine coding tests, including untouched
base rejection and reference acceptance in approximately 30 seconds. Repository
`bun run typecheck` passed for core, workspaces and examples. The original CLI
smoke completed 14 questions; both coding schema CLIs completed with zero model
calls; the non-offline DreamBench CLI returned `unavailable` without credentials.
Targeted Biome checks passed with no warnings/errors (four existing informational
template-literal suggestions). No release gate was needed for script-only exports.

## Task 6 — OpenCode Go campaign, partial (2026-10-21)

Owner decision: **OpenCode Go only**; Hyper is excluded from this campaign.
Solver and judge: `opencode-go/mimo-v2.5`, temperature 0, maximum output 4,096.
The catalogue was checked live; a bounded control request completed with 10 input
and 14 output tokens. This control establishes connectivity, not long-context
reliability. There is no live embedding model configured; hybrid and cosine
calibration remain unavailable. This section does **not** close Task 6.

### Live rerun outcomes (first attempt)

| Suite / arm | Status | Scored | Input tokens | Usage complete | Outcome |
| --- | --- | ---: | ---: | --- | --- |
| LongMemEval-S / full | failed | 0/70 | 357,644 | false | `MemoryBenchAnswerError:failed`; no accuracy or cache-parity claim |
| LongMemEval-S / fabric | failed | 4/70 | 12,378 | true | `MemoryBenchJudgeError:invalidinjectionlabel`; 1/4 correct on the scored partial set |
| Lifecycle / om+fabric | failed | 13/24 sessions | 338,864 | strict wire accounting | `LifecycleConsolidationError`; no complete comparative estimate |

Reports: [full](memory-bench/task6/longmemeval-s-full.json),
[fabric](memory-bench/task6/longmemeval-s-fabric.json), and
[lifecycle](memory-bench/task6/lifecycle-om+fabric.json).
The fabric partial set contains one knowledge-update, multi-session,
single-session-assistant and single-session-user item. These four items are not
an estimate across all abilities. Other public suites/arms and the targeted
30-per-ability families remain pending. Invalid judge output fails closed;
partial sets are neither filtered nor merged to manufacture paired evidence.
The lifecycle partial has task success 0/13, leakage 0/13, stale-use 0 on
eligible sessions, poison persistence 13/13, right-time recall 1 on eligible
sessions, and no repeated-error or abstention denominator. These results describe
this controlled state protocol and this failed arm only; they do not justify
promotion by default. Background calls: 32 observer, zero reflector/dropper/embedding.
The final failed step adds input usage without adding a completed scored session.
A separate 50k-input-bounded [fixture control](memory-bench/task6/format-control.json)
also failed before writing state (1,152 input tokens). It does not establish a
grading-format defect or a performance score. Reported campaign input is
710,048 including both controls; this is a
lower bound because the full-context attempt has incomplete usage. The three
run allocations total 15M tokens (10M full, 3M fabric, 2M lifecycle), plus the
50k bounded fixture control and the tiny connectivity check, within 90M.
Full-context wire usage is incomplete: 357,644 is the reported input count,
not proof of complete billing. Failed attempts still count toward the campaign.

### Calibrations (first attempt; superseded by the second rerun)

| Calibration | Sample / constraint | Suggested value | Verdict |
| --- | --- | ---: | --- |
| Lexical inject coverage floor | 7 labelled hits with known coverage; lowest bin with used rate >= 0.5 | 0.5 | Provisional; failed run, sparse and non-monotone bins; no default change |
| Lexical consolidation Dice | 200 construction pairs, precision >= 0.9, maximise in-sample F1 | 1.0 | Precision/recall/F1 1.0 (40 TP, 0 FP, 0 FN); construction/stratified evidence only |
| Hybrid consolidation / inject cosine | No live embeddings | unavailable | Provisional |
| Promotion minScore / weights | No held-out live-extractor candidate calibration | pending | Defaults retained provisionally |
| Archive / decay | 48 construction policies; regret <= 0.02; minimise graveyard index | See retention table below | Provisional in-sample fit; no production-default verdict |
| Capacity | 10-note arm never forces the active project set over its note cap | pending | No powered live recall-loss estimate |

[Injection bins](memory-bench/task6/injection.json): coverage [0.4,0.5) has 0/1
used, [0.5,0.6) has 2/4, and [0.6,0.7) has 0/2. Six entries are excluded because
coverage or a completed label is absent. Coverage comes from the actual retriever
hit, not from a reconstructed query or rendered source text. Hits below the
collection floor are unmeasured. A passing bin is a suggestion requiring a paired
live test, not a causal benefit or permission to change the floor.

[Consolidation search](memory-bench/task6/consolidation.json) carries the pair
field's audit status: n=0, kappa/error rate undefined, provisional=true. Task 3's
construction report has overall provisional=false, but that does not override
its field-level flags. No recorded sessions, consented live panel or completed
human audit are claimed. The exact-copy synthetic duplicate design and Dice-bin
sampling do not establish population precision. Dice is never used as cosine.

### Warm-cache component ablations

[Replay policies, metrics, counts and growth curves](memory-bench/task6/replays.json)
use the Task 2 construction corpus (seed 7; four personas, three projects, eight
sessions each). Each policy was replayed twice; the second run made **zero**
extractor calls. Gated arms each had 96 cache hits; no-promotion had none. Warm
runs took 125–917 ms on this machine, below the 60-second bound. These are plumbing
and sensitivity measurements, not live extractor or task-success evidence.

| Arm | Promotion precision | Promotion recall | Scope accuracy | Archive regret | Graveyard index |
| --- | ---: | ---: | ---: | ---: | ---: |
| no promotion | null | 0 | null | null | null |
| gated, minScore 0.45 | 1 | 1 | 0.8235 | 0 | 0.4118 |
| correction weight 0 | 1 | 0.8125 | 0.7857 | 0 | 0.5 |
| generality weight 0 | 1 | 0.25 | 1 | null | 0 |
| explicit/outcome/recurrence/ephemerality/derivability weight 0 (five arms) | 1 | 1 | 0.8235 | 0 | 0.4118 |
| verify after 1 or 3 sessions (two arms) | 1 | 1 | 0.8235 | 0 | 0.4118 |
| capacity 10 notes / 1,000 tokens per scope | 1 | 1 | 0.8235 | 0 | 0.4118 |
| duplicate Dice 0.95 | 1 | 1 | 0.8235 | 0 | 0.4118 |

Zeroing a weight does not remove a hard gate: explicit promotion can still bypass
the score threshold, and derivability/ephemerality gates still apply. These seven
arms are **weight** ablations, not the requested complete signal leave-one-out.
The initial regret value of 1.0 was a measurement bug: widening retired project
copies while an active agent copy still supplied the probe. Replay now counts
regret only when no active recalled equivalent supplies that later probe. A
regression initially failed on 1.0 versus 0; the genuine later-needed archived
fact test still passes. All 13 arms were rerun warm after this correction. No
p-values, Holm verdicts or cost non-inferiority claims are computed from these
aggregate construction scores.

### Second rerun: completed lifecycle arms and mechanism ablations (2026-10-21)

The same OpenCode Go protocol was rerun after the capacity eviction comparator
was made deterministic (equal-strength notes now tie-break on content before id,
so a warm replay can reproduce the same evictions). Both arms completed all 24
sessions with strict wire accounting:

| Lifecycle arm | taskSuccess | cross-project leakage | stale use | repeated error | right-time recall | abstention | poison persistence | tokens/session | Input tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full (no memory) | 0.3333 | 0 | 0 | 0 | 0.2625 | 0 | 0.0833 | 3,022.25 | 72,534 |
| fabric (gated promotion on) | 0.625 | 0.9167 | 0.1111 | 0 | 0.9062 | 1 | 0.0417 | 13,231.13 | 317,547 |

[full report](memory-bench/task6/v2-rerun-lifecycle-full.json) and
[fabric report](memory-bench/task6/v2-rerun-lifecycle-fabric.json). The paired
cluster-permutation comparison (clusters = persona x project, n = 24 sessions)
gives task success +0.2917 (95% CI 0 to 0.75, p 0.5), right-time recall +0.75
(CI 0.2 to 1, p 0.25), abstention +1 (CI 1 to 1, p 0.25), and leakage +0.9167
(22 sessions; p 0.25). Every Holm-adjusted p is 1. With three clusters the design
has low power (0.12 for task success), so these are not verdicts: fabric shows a
large point-estimate leakage rise on this scripted protocol, and it costs 4.4x
the tokens per session. Gated promotion therefore stays off by default. The
poison marker was promoted or injected in 4.2% of fabric sessions versus 8.3%
without memory; both are small counts and neither is a safety estimate.

A third arm, `om+fabric`, failed three times before completing session 4: each
failed consolidation pass was rejected (`extraction_failed`) because the live
extractor returned at least one note its own tool schema could not carry (a
segment id that was not shown, and a path-scoped note without globs). The
extractor is fail-closed, so one malformed note discards the pass; the last
attempt used 95,529 input tokens. This arm yields no comparative estimate.
Reports: [attempt 1](memory-bench/task6/abandoned-lifecycle-om+fabric-1.json)
and [attempt 3](memory-bench/task6/v2-rerun-lifecycle-om+fabric.json).

### Mechanism ablations (warm replay)

[The replay matrix](memory-bench/task6/replays-v2.json) runs 35 arms from one
shared extractor cache: source variants for stem, multi-query, snippet budget,
key weight, OM dates/task state/replace-on-reflect, cross-source dedup,
retrieval-based verification, every-reflection promotion, capacity/merge off,
calendar clock, exponential decay and each promotion signal; replay variants for
core and cue injection; and note-limit capacities 2/5/10/20/50/100/200/500.
Every warm run made zero extractor calls and reproduced its first-run metrics
exactly, including the capacity arms that evict notes.

| Arm | Promotion precision | Promotion recall | Scope accuracy | Archive regret | Graveyard index |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline (shipped policy) | 1 | 1 | 0.8235 | 0 | 0.4118 |
| verification by retrieval | 1 | 1 | 0.8235 | 0 | 0.0588 |
| every-reflection promotion | 1 | 0.375 | 0.0392 | 0 | 0.0588 |
| calendar clock | 1 | 1 | 0.8235 | 0 | 0.1765 |
| exponential decay | 1 | 1 | 0.8333 | 0 | 0.4118 |
| capacity 2 | 1 | 1 | 0.6275 | 0.1379 | 0 |
| capacity 5 and above | 1 | 1 | 0.8235 | 0 | 0.4118 |
| correction signal off | 1 | 0.8125 | 0.7857 | 0 | 0.5 |
| generality signal off | 1 | 0.25 | 1 | null | 0 |
| ephemerality signal off | 0.85 | 1 | 0.8529 | 0 | 0.5 |
| flat scope | 1 | 0.625 | 0.8824 | null | 0.25 |

Stem, multi-query, key weight, snippet budget (600/1,200/2,400), OM dates, OM
task state, replace-on-reflect, cross-source dedup, capacity off, merge off, core
off and cues off produced metrics identical to the baseline on this construction
corpus. That is evidence of no construction-corpus sensitivity, not proof that a
mechanism is useless live: each arm's exercise note records which path the
corpus actually exercised. Capacity 2 violates the archive-regret constraint
(>2%) and loses scope accuracy; capacity 5 and above are feasible, so the shipped
200/500 limits are not contradicted. Every-reflection promotion reaches the same
graveyard only by discarding most notes (recall 0.375, scope accuracy 0.0392), so
it is not a win. Retrieval verification keeps precision and recall 1 and scope
accuracy 0.8235 while lowering the graveyard; that is a construction-only signal
without right-time-recall or live safety evidence, so it is not applied to
defaults. No ablation is applied to defaults.

### Calibrations (updated)

[Injection calibration](memory-bench/task6/injection-v2.json) over 108 observed
injected hits from the completed fabric arm finds no bin at or above the 50%
used-rate floor: [0.5,0.6) has 15/49 used (30.6%), [0.6,0.7) has 6/13 (46.2%),
and the higher bins hold only 6 hits. The floor is therefore unmeasured; the
0.35 enabled-object fallback is retained and injection stays off by default. The
earlier 0.5 suggestion came from 7 hits and is superseded.

[Consolidation calibration](memory-bench/task6/consolidation-v2.json) keeps the
lexical Dice threshold at 1.0 (40 TP, 0 FP, 0 FN, precision/recall/F1 1.0,
provisional construction pairs) while the package default remains 0.85.
[Promotion calibration](memory-bench/task6/promotion-v2.json) fits minScore 1
with recurrence and generality at 1, but that is an in-sample coordinate search
on synthetic labels; its held-out persona split (p3) scores precision 1 and
recall 1 against 0.775 for the shipped weights. It is retained as evidence, not
applied, because promotion stays off. [Retention fitting](memory-bench/task6/retention.json)
again selects the feasible policy 21fcdd60 (graveyard 0.2857, regret 0) in
sample; decay and archive defaults are unchanged.

### Provisional archive/decay fit

[Retention search](memory-bench/task6/retention.json) covers 48 policies: fact
decay 0.2/0.4/0.8, retrieval threshold 0/-0.2/-0.5/-1, grace 0/2/4/10,
with storage threshold fixed at 1 and promotion minScore at 0.45. Each policy
ran twice on the same 96 ledgers; every fitted report is warm-cache with zero
extractor calls. Eighteen policies meet the 2% regret limit. Null denominators
and failed runs cannot qualify.

| Arm | Fact decay | Retrieval below | Grace sessions | Archive regret | Graveyard index |
| --- | ---: | ---: | ---: | ---: | ---: |
| Retained provisional baseline | 0.4 | -2 | 10 | 0 | 0.4118 |
| Best feasible construction fit | 0.8 | -1 | 2 | 0 | 0.2857 |

The constrained search rejects lower-graveyard policies that lose later-needed
facts. Ties use regret then policy hash, not a claim of a uniquely optimal
policy. This fit is in-sample on synthetic probes, without paired live success
or safety evidence; it does not change decay/archive defaults. Capacity still
needs its separate powered right-time-recall test. The correction to archive
regret above changes measurement only; it does not change package retention.

### Defaults and unresolved measurement gates

The tested [default snapshot](../../scripts/memory-bench/defaults.json) remains
**provisional**. No package default changed:

| Setting | Retained value |
| --- | --- |
| OM observer / reflector / dropper | 10,000 / 20,000 / 20,000 tokens |
| Retrieval | lexical |
| Topic injection | off by default; enabled-object fallbacks: floor 0.35, query task, budget 600, topK 3 |
| Directory | on; 8 topics / 10 files / 200 tokens |
| Write consolidation | deterministic; threshold 0.85 in either mode; model decider opt-in |
| Session promotion | off; minScore 0.5 |
| Promotion weights | explicit 1, correction 1, outcome/recurrence/generality 0.5; ephemerality/derivability -1, duplicate -0.5 |
| Verification / decay | 2 sessions; episode 0.8, fact/procedure 0.4, preference 0.2 |
| Archive | retrieval below -2 AND storage below 1, grace 10 scope sessions |
| Capacity | user/agent 200 notes / 20k tokens; project 500 / 60k |
| Merging / widening | duplicate Dice 0.8; episodes off; projects/siblings/contradictions each 2 |
| Core / cues | core 600 tokens; cues 300 tokens / 2 per turn |

The switches that were previously unmeasured now have construction-corpus replay
arms (source transforms verified by test): stemming, key weighting, OM
dates/task state/replace-on-reflect, cross-source dedup, retrieval-based
verification, calendar and exponential decay, flat scope, full merge/capacity
removal, core/cues off and every promotion signal. Multi-query is a recall-tool
input, not a configuration switch. A 5k/10k dropper remains invalid with the
shipped 20k reflector threshold, and no omp/dropper arm was run; it would have to
be a joint arm, not an isolated dropper effect. These are construction replays,
not live harness switches: a variant that transforms source without the live run
exercising that path proves no live behavior.

Remaining gates are the complete public-suite paired matrix (full context is
still incomplete; `om`, `om+fabric`, LoCoMo and MemoryAgentBench-CR have no clean
arm), the targeted 30-per-ability families, live harness arms for every historical
mechanism switch, a valid `om+fabric` lifecycle arm, applicable gold audits,
Holm-significant live verdicts and OM/full cache parity. Construction replays,
in-sample calibrations and failed live pilots do not satisfy those gates. LoCoMo
remains comparison only. Provider, judge, budgets, seeds, memory form and solver
differ from the papers; none of these results is directly comparable to published
scores.

### Validation and completion status

The complete plan verification commands were exercised: core build, workspace
and example typecheck, memory-core (51 tests), observational (96), fabric (398;
23 external Postgres skips), Prism Agent (38), docs (64), all benchmark tests
(82; one explicit Docker test skipped), the 14-question offline CLI, and both
memory examples passed. Targeted Biome checks passed without warnings/errors;
existing template-literal suggestions are informational. Evidence secret scans
passed. No dependency, public export move, compatibility baseline or retirement
change was needed.

Release gate remains red on the existing kernel package-size budgets: final
packed size 1,083,677 versus 1,083,479 (+198), unpacked 3,539,166 versus
3,538,715 (+451). The first gate run, before this task's docs/CHANGELOG edits,
already exceeded those limits by 209/466 bytes; this task's final edits reduce
the packed inputs. Budgets were not raised.

Task 6 remains unchecked. Complete live paired arms/families, the targeted
ability families, live mechanism-switch arms, a valid `om+fabric` lifecycle arm,
applicable gold audits and release-gate repair are still needed. Construction
replays, in-sample calibration and failed live pilots do not satisfy those
acceptance criteria.

## Metric semantics correction (plan 188.7 Task 3)

Earlier lifecycle tables compared the Boolean `correct` flag, which for
`rightTimeRecall` means "all needed facts recalled", not the fractional score.
Metric version 2 corrects this without rewriting old JSON:

- **Right-time recall is a raw per-session fraction mean.** The completed pair is
  full 0.2625 vs fabric 0.90625, so the raw mean difference is **+0.64375**, not
  the all-needed Boolean +0.75. `results` keeps both `value` and `correct`;
  comparisons use `value`.
- **Clusters are personas, not persona × project.** The three project stores share
  one user/agent store, so project rows are dependent. The old three "clusters"
  cannot support a confirmatory claim; paired sign-flip power at a .5 effect is 0
  with three clusters, and the frozen protocol requires at least 8 independent
  personas (12 planned). Old reports are descriptive only.
- **Leakage is output use, not exposure.** `crossProjectLeakage` now means a
  foreign project/path value appears in written output; the new
  `foreignContextExposure` reports the context channel. The completed fabric arm's
  +0.9167 leakage point estimate is unchanged on the output channel, but the two
  mechanisms are no longer conflated.
- **Poison channels are separate.** `poisonStored`, `poisonVisible` and
  `poisonReused` replace the single aggregate definition; `poisonPersistence`
  remains the any-channel aggregate. Archived/visible/read-only poison is no longer
  one number.
- **Attribution is ids/hashes only.** Session rows record memory tool calls
  (channel, tool, scope, kind, key/text/target hashes), never note or query text;
  the hidden-label and secret-isolation tests still pass.

The corrected recomputation, report hashes, cluster counts and prospective
protocol are in
[`memory-bench/188.7/metric-corrections.json`](memory-bench/188.7/metric-corrections.json)
and [`memory-bench/188.7/protocol-v1.json`](memory-bench/188.7/protocol-v1.json).
All settings remain provisional; promotion stays off, injection keeps the 0.35
fallback, and the fitted consolidation/promotion/retention values remain
evidence-only.

## Widening and cross-project write path (plan 188.7 Task 4)

No paid calls. The earlier 22/24 leakage was not caused by widening (the suite never runs a full
maintenance pass; project-scoped consolidation skips it), and an offline fabric replay leaks 0. The
confirmed deterministic route is a wider **write**: a model tool could call `memory.insert` with
`scope: "agent"` from a project session. Agent scope is shared by every project, so that note becomes
visible everywhere without replication. Old reports kept no tool-argument lineage, so which scope the
live model chose is not retrospectively provable.

Closed in the product, not the grader:

- `memory.insert` from a project/user scope now fails with `agent_scope_requires_widening`; only the
  widening write (or a trusted host write) creates an agent note.
- Widening itself now requires identical normalized content (numbers/negation preserved), readable
  witnesses in each project, distinct witness origins, and no resource-naming text. One differing
  value blocks the whole subject; keyless Dice matching and multi-glob sibling forgery are gone.
- A wider note is persisted and checked for scope/equality before any project/path copy is archived;
  a failed write preserves every local note and a retry reconciles once.
- The lifecycle harness records proposed tool scope/kind/key/text hashes (no text) so the next paid
  arm can attribute a leak to the write that caused it.

Acceptance remains unproven for live models: Task 8 must show the paid lifecycle leakage point
estimate ≤0.05 and upper 95% CI ≤0.15. Offline zero leakage is a control, not a live result.

## Task 7 lifecycle cost audit (2026-10-21, offline)

The lifecycle report now splits extractor input from everything else:
`cost.extractorInputTokens`, `cost.nonExtractorInputTokens`, extractor/correction
calls, worker calls, embedding calls and gateway retries, all summing to
`inputTokens`. The freeze is taken around the awaited `memory:consolidate`
command, so solver, observer/reflector/dropper and extractor tokens are not
silently merged.

The offline `fabric` arm completed 24 sessions with 360,238 estimated input
tokens: extractor 10,556 (9 calls, 2.9%) and non-extractor 349,682. The old live
fabric arm cost 317,547 input for 24 sessions versus 72,534 for full context, but
it predates the cost split and cannot be reattributed after the fact. The
10,556-token offline extractor share does not support a duplicate-extraction
claim; existing once-only cursor/close-reopen tests already cover an unchanged
tail (`restored_session_catches_up_once`). The remaining cost is solver/context
work, so any call reduction needs Task 8's matched paid measurement, not another
default trigger or extractor change here.

## Plan 188.7 paid lifecycle result (2026-10-22)

One persona (seed 1887) completed full and fabric-promotion-off; no 12-persona safety set exists.
Full context: 24 sessions, task success .292, labelled cross-project leakage 0, 62,019 input.
Fabric promotion off: 24 sessions, task success .708, leakage 0, **foreign-context exposure .542**
(13/24), 303,201 input. Fabric promotion on was abandoned at 9/24 after repeated agent-completion
failure; `om+fabric` failed with `LifecycleObserverError` before one session. All other personas
were not run because the durable campaign stopped under the cap/time budget.

The paid promotion-off exposure is unexplained and blocks the safety gate even though no labelled
value leaked. Deterministic F1/F2 widening fixes and the F3 `agent_scope_requires_widening` guard
remain offline-proven only. Promotion stays off; the paid leakage threshold (point ≤.05, upper 95%
CI ≤.15) still needs a complete 12-persona run. Evidence:
[`memory-bench/188.7/README.md`](memory-bench/188.7/README.md).
