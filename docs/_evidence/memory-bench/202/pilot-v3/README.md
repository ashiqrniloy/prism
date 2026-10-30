# Task 4.7 — bounded corrected pilot

This is a completion-enriched development diagnostic, not BFC/Robust acceptance or a lever decision. The owner waived human calibration; this free judge panel is development-only. All primary arms use Nemotron with reasoning disabled and output capped at 8,192 tokens, not the product/acceptance configuration. Prompts and the eight-turn stop stayed fixed.

The pilot accounted for **52/52** requested cells: **42** scored/completion-limited, **0** explicit execution/evaluation failures and ten full-truncated dispositions. 10/10 full-history cells have measured complete-history eligibility with zero removed source messages. Both rubric-oracle rows are diagnostic-only and excluded from paired comparisons and lever rankings.

| Ability | Full binary / graded | Lexical binary / graded | Passive binary / graded | Preset binary / graded | Oracle ceiling binary / graded |
|---|---|---|---|---|---|
| abstention | 1 / n/a | 1 / n/a | 1 / n/a | 1 / n/a | n/a |
| contradiction_resolution | 0 / n/a | 0 / n/a | 0 / n/a | 0 / n/a | n/a |
| event_ordering | 0 / 0.295 | 0 / 0.235 | 0 / 0.150 | 0 / 0.314 | 0 / 0.526 |
| information_extraction | 1 / n/a | 1 / n/a | 1 / n/a | 1 / n/a | n/a |
| instruction_following | 1 / n/a | 1 / n/a | 0 / n/a | 1 / n/a | n/a |
| knowledge_update | 0 / n/a | 0 / n/a | 0 / n/a | 0 / n/a | n/a |
| multi_session_reasoning | 0 / n/a | 0 / n/a | 0 / n/a | 0 / n/a | n/a |
| preference_following | 0 / n/a | 0 / n/a | 0 / n/a | 0 / n/a | n/a |
| summarization | 0 / 0.450 | 0 / 0.250 | 0 / 0.200 | 0 / 0.450 | 0 / 0.800 |
| temporal_reasoning | 0 / n/a | 0 / n/a | 0 / n/a | 1 / n/a | n/a |

Graded is primary for ordering and summarization; binary is secondary. The ability rows each contain one question and one conversation cluster. They cannot discriminate lever effects; retain the Task 4.6 screening limits. Overall comparisons combine unlike abilities and are descriptive. The full development rubric draw itself had only three/four independent clusters (minimum two-sided p=.25/.125); this pilot adds no independent rubric sample. No oracle score enters a product comparison.

| Role | Input tokens | Cache reads | Output tokens | Wire attempts | Cost USD |
|---|---:|---:|---:|---:|---:|
| product | 1730792 | 397440 | 18487 | 59 | 0 |
| evaluation | 84201 | 0 | 154148 | 115 | 0 |

Elapsed wall time: 54.3 minutes. Detailed timing is in final-results.json, priorTiming (v2), timing (new v3 calls), and timing.scoringCompletion (the final rejudge). Quantiles are kept per attempt rather than averaging quantiles across attempts. Input, output and attempt totals reconcile exactly to the role rows. The original allowance was 300 attempts, 8M input, 700K output tokens, two hours and concurrency one; successive manifests reduced the remaining allowance. No broad-grid process was started. The 54.3 minutes above covers v2, continuation and final scoring; superseded v1 adds 19.9 minutes.

| Arm versus complete history | Pairs / independent clusters | Binary difference (arm − full) | Pointwise cluster 95% CI |
|---|---|---|---|
| lexical-topk | 10 / 7 | 0.000 | [0,0] |
| fabric-x | 10 / 7 | -0.100 | [-0.2727272727272727,0] |
| fabric-x-tools | 10 / 7 | 0.100 | [0,0.375] |

Paired differences (including graded ability rows), pointwise cluster intervals, discordant wins/losses and sign-flip p-values are in final-results.json. No significance or lever-opening claim is made; this pilot does not replace the Task 4.6 Holm-adjusted broad-baseline analysis.

Evidence coverage is in evidence-coverage.json. Comparator rows measure labelled rounds present in the chosen history; memory rows measure labelled delivered ids. The replay field candidateGold is a delivered-id proxy, not an exhaustive candidate-store measurement. Neither that proxy nor this small pilot establishes a retrieval-stage lever decision.

The frozen v3 executable entry point is scripts/memory-bench/audit/pilot.mjs. See the bench README for commands and limits. Private pre-judge answer checkpoints and bounded provider traces are under .cache/memory-bench/audit/4.7-v3/. Public JSON carries ids/counts/scores only. The source hashes identify the frozen run; later documentation changes require Task 4.8 to refresh broad-campaign provenance.

## Provenance and operational limits

V1 is preserved at `../pilot/`: it stopped on a judge SSE 502 and exposed an
entry-point cleanup error. V2 reran every primary cell after bounded transient
retry/cleanup/trace repairs. It stopped on an unclassified terminal judge stream.
V3 preserves eleven valid v2 rows under a checked continuation identity and uses
the saved failed answer, then attempts every remaining cell. No v1 score or
answer enters the final comparison. Prompts, generation, panel, criteria,
question set and eight-turn stop stay unchanged. A continuation test rejects
changed product, criteria, questions, answer settings or judges.

The immutable v3 `results.json` ended with 41 complete cells, ten equivalent
rows and one evaluation failure. `rejudge-manifest.json` froze a judge-only
completion (16 attempts, 250k input, 100k output, 30 minutes); it used four
requests to score the same saved full-summary answer. `scoring-completion.json`
retains that result; `final-results.json` joins it without discarding the failed
call's usage. No new answer was generated or selected. The offline join rejects
a different checkpoint or incomplete score and recomputes paired comparisons.

Including superseded v1, **246 wire attempts**, **2,673,235 reported input** and
**254,371 reported output tokens** used **74.2 active attempt minutes**. Each
attempt stayed within its own timer. Elapsed time including engineering,
subscription probing and the pause before continuation was **295.2 minutes**:
this was not one uninterrupted two-hour pilot. Record that wall-time deviation;
do not report the two-hour overall elapsed limit as met.

**Eleven exchanges lack usage.** Token figures are lower bounds, not a fully
reconciled hard-token proof. The existing 250k/request planning bound yields an
input sensitivity envelope of 5,423,235 tokens (output 344,483 with 8,192 per
unknown response), below the original numeric ceilings, but does not recover
provider usage. All incomplete attempts retain their entire durable journal
reservations: aggregate primary reservation charge is **24,028,649**, exceeding
the original token ceiling. No missing usage was refunded. `budget-accounting.json`
contains the per-attempt ledger. The role-table $0 is declared free-route pricing,
not complete wire billing. These limitations must be resolved or explicitly
carried by Task 4.8; this evidence cannot certify readiness or cost acceptance.

`../pilot/completion.json` is the separately frozen historical-model probe. Beam
reproduced eight recall calls/eight turns, receiving result/hit headers in later
requests and repeating identical arguments for the final five recorded calls.
It made no answer retry and never produced a final answer. Retain that genuine
run limit as a failure. The original archive had eight Beam limits versus one
MiniMax limit in forty questions each; MiniMax's historical trace reached eight
turns with 21 tool calls, but its current probe hit a **monthly subscription
quota**. Its present result handling therefore remains unverified. Do not infer
a causal difference between the two model rates from these probes.

Current Nemotron preset cells all finish (one to four turns). One ordering call
violates the advertised four-query maximum, receives the validation error and
corrects its arguments before finishing. This is tool-use behavior, not lost
feedback. `trace-diagnosis.json` contains counts/hashes only. The recall-counter
repair, transient judge retries and trace/cleanup repairs are harness changes;
no product stopping/ranking/prompt improvement shipped and no lever was opened.

Task 4.7 execution is complete. **Task 4.8 and the broad Task 4 remain unchecked.**
There are only seven independent conversations overall and one per ability;
this pilot is neither confirmatory nor human calibrated. Missing usage, elapsed
wall time and the MiniMax quota remain explicit readiness handoff items.
